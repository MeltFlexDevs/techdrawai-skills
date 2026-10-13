import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, TechDrawAiClient } from "./api.js";
import { DRAWING_COST, MODEL_3D_COST } from "./config.js";
import { downloadToFile, saveBuffer, saveImage, saveText, withExtension, } from "./util.js";
/**
 * Read from package.json rather than written out here. A hardcoded copy is a
 * third place to remember on every release — and the one that goes stale
 * silently, because nothing fails when the number an MCP client is told
 * disagrees with the version it actually installed.
 */
export const VERSION = createRequire(import.meta.url)("./package.json").version;
/**
 * MCP surface for TechDraw AI.
 *
 * Every tool writes its result to disk and returns the path rather than the
 * bytes: a drawing is a megabyte-scale image, and pushing that through the
 * JSON-RPC channel would burn the agent's context for something it can read
 * back on demand — and usually only needs to hand to the next tool anyway.
 * Chaining is the point: `generate_technical_drawing` → `image_to_dxf` gets you
 * from a photograph to CAD geometry in two calls.
 */
/**
 * Turn any thrown value into the error content block MCP expects.
 *
 * An ApiError already carries the server's own sentence — written for a person,
 * complete on its own, and often naming the fix. Prefixing it produces
 * "Product identification failed: Product identification failed: …", which
 * reads like a bug because it is one. Local failures (a missing file, a
 * timeout, an unparseable reply) carry no such context, so those keep the
 * prefix that says which tool they came from.
 */
function toolError(action, err) {
    const message = err instanceof ApiError
        ? err.message
        : `${action} failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
        isError: true,
        content: [{ type: "text", text: message }],
    };
}
function text(body) {
    return { content: [{ type: "text", text: body }] };
}
export function createServer() {
    const server = new McpServer({ name: "techdrawai", version: VERSION });
    /* ----------------------------------------------- technical drawing -- */
    server.registerTool("generate_technical_drawing", {
        title: "Generate a 2D technical drawing",
        description: "Turn a photograph of a physical object into a dimensioned, standards-compliant 2D technical drawing (orthographic views, dimension lines, projection symbol). " +
            "Supply the photo as a local file path, an http(s) URL or a data URL. " +
            "Either let the model estimate real-world dimensions, or pass measurements you actually took so the drawing is anchored to real sizes. " +
            "Choose the drafting standard (ISO/ANSI), sheet size, projection angle, drawing type and which views to include. " +
            `Costs ${DRAWING_COST} credits. The drawing image is saved to disk and its path returned — feed that path to \`image_to_dxf\` for CAD geometry, or to \`render_product\` for a photoreal render.`,
        inputSchema: {
            image: z
                .string()
                .describe("The product photo: a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
            product_name: z
                .string()
                .optional()
                .describe('What the object is, e.g. "oak dining chair". Improves the title block and the estimated dimensions. Use `identify_product` first if you do not know.'),
            estimate_dimensions: z
                .boolean()
                .optional()
                .describe("Let the model infer realistic real-world dimensions. Defaults to true when no measurements are given, false when they are."),
            units: z
                .enum(["mm", "cm", "m", "in"])
                .optional()
                .describe("Primary drawing unit. Defaults to mm."),
            measurements: z
                .array(z.object({
                value: z
                    .string()
                    .describe('The measured length as a number, e.g. "120" or "4.5".'),
                unit: z.enum(["mm", "cm", "m", "in"]).optional(),
                orientation: z
                    .enum(["horizontal", "vertical", "diagonal"])
                    .optional(),
                position: z
                    .string()
                    .optional()
                    .describe('Where on the object it was taken, e.g. "overall width", "seat height".'),
            }))
                .optional()
                .describe("Dimensions actually measured on the object. Every other feature is scaled proportionally from these, so one accurate measurement makes the whole drawing accurate."),
            standard: z
                .enum(["ISO", "ANSI"])
                .optional()
                .describe("Drafting standard. ISO (default) or ANSI."),
            paper_size: z
                .string()
                .optional()
                .describe('Sheet size: A4/A3/A2/A1/A0 for ISO (default A3), or "ANSI A"…"ANSI E" for ANSI (default "ANSI B").'),
            projection: z
                .enum(["first-angle", "third-angle"])
                .optional()
                .describe("Projection angle. first-angle (default, ISO/Europe) or third-angle (ANSI/North America)."),
            drawing_type: z
                .enum(["working", "assembly", "as-fitted", "patent"])
                .optional()
                .describe("working = fully dimensioned production drawing (default); assembly = numbered balloons + parts list; as-fitted = record of the item as built; patent = numbered figure, no dimensions."),
            views: z
                .array(z.enum(["front", "top", "side", "isometric"]))
                .optional()
                .describe("Which views to include. Defaults to front, top and side."),
            notes: z
                .string()
                .optional()
                .describe("Anything else to state on the drawing (material, finish, tolerances)."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the drawing. Defaults to ./techdrawai-output/drawing-<timestamp>.png."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.drawing({
                image: args.image,
                productName: args.product_name,
                estimateDimensions: args.estimate_dimensions,
                units: args.units,
                measurements: args.measurements,
                standard: args.standard,
                paperSize: args.paper_size,
                projection: args.projection,
                drawingType: args.drawing_type,
                views: args.views,
                notes: args.notes,
            });
            const target = saveImage(result.image, args.output_path, "drawing");
            return text(`Technical drawing saved to:\n  ${target}\n\n` +
                (result.notes ? `Model notes: ${result.notes}\n` : "") +
                `Credits used: ${result.creditsUsed} · Balance: ${result.balance}\n` +
                "Next: `image_to_dxf` on this file for CAD geometry, or `render_product` for a photoreal render.");
        }
        catch (err) {
            return toolError("Technical drawing generation", err);
        }
    });
    /* --------------------------------------------- text to drawing -- */
    server.registerTool("text_to_technical_drawing", {
        title: "Draw a part from a written description",
        description: "Turn a description of a part, with its sizes, into a dimensioned 2D technical drawing: orthographic views plus an isometric, dimension lines, centre lines and the projection symbol. No photo needed. " +
            "Every number in the prompt is drawn as given; sizes the prompt leaves out are estimated and the sheet says UNSTATED DIMENSIONS NOMINAL. So put every size you know in the prompt. " +
            "The image is the views only, with no border or title block. It is a picture, not CAD geometry: the drawn lines are not to exact scale. " +
            `Costs ${DRAWING_COST} credits and takes about 30 to 60 seconds. The drawing is saved to disk and its path returned.`,
        inputSchema: {
            prompt: z
                .string()
                .min(1)
                .max(1000)
                .describe('What the part is and every size you know, e.g. "Steel L bracket, legs 80 and 60 mm, 40 wide, 5 thick, two 8.5 mm holes in each leg". Name materials and tolerances here too if they belong on the drawing.'),
            standard: z
                .enum(["ISO", "ANSI"])
                .optional()
                .describe("Drafting standard. ISO (default) or ANSI (ASME, drawn for an ANSI B sheet)."),
            projection: z
                .enum(["first-angle", "third-angle"])
                .optional()
                .describe("Projection angle. Defaults to first-angle on ISO, third-angle on ANSI."),
            paper_size: z
                .enum(["A4", "A3", "A2", "A1"])
                .optional()
                .describe("ISO sheet the views are proportioned for. Defaults to A3."),
            units: z
                .enum(["mm", "in"])
                .optional()
                .describe('Units of the bare numbers in the prompt. Omit to read them from the prompt (an inch mark or "in" means inches, otherwise mm).'),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the drawing. Defaults to ./techdrawai-output/text-drawing-<timestamp>.png."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.textDrawing({
                prompt: args.prompt,
                standard: args.standard,
                projection: args.projection,
                paperSize: args.paper_size,
                units: args.units,
            });
            const target = saveImage(result.image, args.output_path, "text-drawing");
            const o = result.options;
            return text(`Technical drawing saved to:\n  ${target}\n\n` +
                `${o.standard} · ${o.projection} · ${o.paperSize} · ${o.units}\n` +
                `Credits used: ${result.creditsUsed} · Balance: ${result.balance}\n` +
                "Next: `render_product` on this file for a photoreal render, or `drawing_to_3d` for a mesh.");
        }
        catch (err) {
            return toolError("Text to drawing", err);
        }
    });
    /* -------------------------------------------------- product render -- */
    server.registerTool("render_product", {
        title: "Render a product from a technical drawing",
        description: "The reverse of drafting: take a 2D technical drawing and produce a photorealistic image of the finished, manufactured product. " +
            "The geometry is reconstructed from the views in the drawing, so the render matches the design rather than inventing a new one. " +
            "Choose the look (photoreal, studio, matte clay, lifestyle), the background, the camera angle and the material/finish. " +
            `Costs ${DRAWING_COST} credits. The render is saved to disk and its path returned.`,
        inputSchema: {
            image: z
                .string()
                .describe("The technical drawing: a local file path, an http(s) URL, or a data:image/…;base64,… URL. The output of `generate_technical_drawing` works directly."),
            product_name: z
                .string()
                .optional()
                .describe('What the object is, e.g. "wall bracket". Helps the reconstruction.'),
            style: z
                .enum(["photoreal", "studio", "clay", "lifestyle"])
                .optional()
                .describe("photoreal = a convincing real photo (default); studio = catalogue lighting on a seamless backdrop; clay = neutral grey to read form; lifestyle = the product in a real setting."),
            background: z
                .enum(["white", "gradient", "scene"])
                .optional()
                .describe("white (default), gradient, or scene (in context)."),
            angle: z
                .enum(["front", "three-quarter", "top", "isometric"])
                .optional()
                .describe("Camera angle. Defaults to three-quarter."),
            material: z
                .string()
                .optional()
                .describe('Material and finish, e.g. "brushed aluminium, matte black".'),
            notes: z.string().optional().describe("Anything else to emphasise."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the render. Defaults to ./techdrawai-output/render-<timestamp>.png."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.render({
                image: args.image,
                productName: args.product_name,
                style: args.style,
                background: args.background,
                angle: args.angle,
                material: args.material,
                notes: args.notes,
            });
            const target = saveImage(result.image, args.output_path, "render");
            return text(`Product render saved to:\n  ${target}\n\n` +
                (result.notes ? `Model notes: ${result.notes}\n` : "") +
                `Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
        }
        catch (err) {
            return toolError("Product render", err);
        }
    });
    /* -------------------------------------------------------- image→DXF -- */
    server.registerTool("image_to_dxf", {
        title: "Convert an image to CAD vector geometry (DXF/DWG)",
        description: "Trace a raster image — a generated technical drawing, a scan, a sketch, a logo — into real CAD vector contours and write a DXF file. " +
            "The DXF opens in AutoCAD, Fusion 360, SolidWorks, Onshape, FreeCAD, LibreCAD, Inkscape and the common laser/CNC tools. " +
            "Set `width_mm` to bring the geometry in at a real-world size instead of one unit per pixel. " +
            "Set `dwg: true` to also get AutoCAD's native DWG. " +
            "Free — no credits. Returns the paths of the files written.",
        inputSchema: {
            image: z
                .string()
                .describe("The image to trace: a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
            threshold: z
                .union([z.number().min(0).max(255), z.literal("auto")])
                .optional()
                .describe('Luminance cut-off between ink and paper. "auto" (default) picks it from the image, which is what photos and shaded renders need. Give a number to force it.'),
            invert: z
                .boolean()
                .optional()
                .describe("Trace light lines on a dark background."),
            smoothing: z
                .number()
                .optional()
                .describe("1 (default) keeps detail; higher values smooth the contours."),
            width_mm: z
                .number()
                .optional()
                .describe("Real-world width of the result in millimetres. Omit to get one DXF unit per traced pixel."),
            dwg: z
                .boolean()
                .optional()
                .describe("Also convert to DWG (AutoCAD's native format)."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the .dxf. Defaults to ./techdrawai-output/drawing-<timestamp>.dxf. Any DWG is written beside it."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.dxf({
                image: args.image,
                threshold: args.threshold,
                invert: args.invert,
                smoothing: args.smoothing,
                widthMm: args.width_mm,
                dwg: args.dwg,
            });
            const dxfPath = saveText(result.dxf, args.output_path, "drawing", "dxf");
            const lines = [`DXF saved to:\n  ${dxfPath}`];
            if (args.dwg) {
                if (result.dwg) {
                    const dwgPath = saveBuffer(Buffer.from(result.dwg, "base64"), withExtension(dxfPath, "dwg"), "drawing", "dwg");
                    lines.push(`DWG saved to:\n  ${dwgPath}`);
                }
                else {
                    lines.push(`DWG was not produced: ${result.dwgError ?? "conversion unavailable"}. The DXF above is unaffected.`);
                }
            }
            lines.push(`\n${result.contours} contours · ${result.width.toFixed(1)} × ${result.height.toFixed(1)} units · threshold ${result.threshold} · no credits used`);
            return text(lines.join("\n"));
        }
        catch (err) {
            return toolError("DXF conversion", err);
        }
    });
    /* -------------------------------------------------------- image→STL -- */
    server.registerTool("image_to_stl", {
        title: "Convert an image to a 3D printable STL",
        description: "Trace a raster image — a logo, a sign, a stencil, a line drawing — and extrude it into a solid, watertight binary STL ready to slice and print. " +
            "The shape is flattened artwork given a thickness, not a reconstruction of a real object: use `photo_to_3d` for that. " +
            "`size_mm` sets the longest side of the finished model and `thickness_mm` how tall it stands. " +
            "Free — no credits. Returns the path of the .stl written.",
        inputSchema: {
            image: z
                .string()
                .describe("The image to trace: a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
            threshold: z
                .union([z.number().min(0).max(255), z.literal("auto")])
                .optional()
                .describe('Luminance cut-off between ink and paper. "auto" (default) picks it from the image. Give a number to force it.'),
            invert: z
                .boolean()
                .optional()
                .describe("Trace light lines on a dark background."),
            smoothing: z
                .number()
                .optional()
                .describe("1 (default) keeps detail; higher values smooth the contours, and this is the fastest way to shrink an oversized mesh."),
            max_dim: z
                .number()
                .optional()
                .describe("Longest traced side in pixels (default 1600). Lowering it is the other way to cut the triangle count."),
            thickness_mm: z
                .number()
                .optional()
                .describe("How tall the extrusion stands, in millimetres (default 3)."),
            size_mm: z
                .number()
                .optional()
                .describe("Longest side of the finished model, in millimetres (default 100). The other side follows the artwork's aspect ratio."),
            min_feature_mm: z
                .number()
                .optional()
                .describe("Discard detail finer than this, in millimetres (default 0.3, about a nozzle width). Clears the speckle a traced photograph throws off."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the .stl. Defaults to ./techdrawai-output/model-<timestamp>.stl."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.stl({
                image: args.image,
                threshold: args.threshold,
                invert: args.invert,
                smoothing: args.smoothing,
                maxDim: args.max_dim,
                thicknessMm: args.thickness_mm,
                sizeMm: args.size_mm,
                minFeatureMm: args.min_feature_mm,
            });
            const path = saveBuffer(Buffer.from(result.stl, "base64"), args.output_path, "model", "stl");
            return text(`STL saved to:\n  ${path}\n\n${result.triangles} triangles · ${result.widthMm} × ${result.heightMm} × ${result.thicknessMm} mm · ${result.contours} contours · threshold ${result.threshold} · no credits used`);
        }
        catch (err) {
            return toolError("STL conversion", err);
        }
    });
    /* ---------------------------------------------------- photo → 3D -- */
    server.registerTool("photo_to_3d", {
        title: "Reconstruct a 3D model from a photo",
        description: "Turn a photograph of a single object into a textured 3D mesh, downloadable as GLB (and FBX, OBJ, USDZ, STL). " +
            "Reconstruction is asynchronous on the server and typically takes one to three minutes — the call blocks until the mesh is ready. " +
            "Needs a clear photo of one object, as JPG or PNG. " +
            `Costs ${MODEL_3D_COST} credits and requires the Studio plan. The GLB is downloaded to disk and its path returned.`,
        inputSchema: {
            image: z
                .string()
                .describe("The product photo (JPG or PNG): a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
            detail: z
                .enum(["draft", "standard", "high"])
                .optional()
                .describe("Mesh density: draft (12k triangles), standard (40k, default) or high (80k). Barely affects generation time."),
            textured: z
                .boolean()
                .optional()
                .describe("Generate colour textures. Defaults to true."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the .glb. Defaults to ./techdrawai-output/model-<timestamp>.glb."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.model3d({
                image: args.image,
                detail: args.detail,
                textured: args.textured,
            });
            if (!result.modelUrls.glb) {
                throw new Error("The server returned no GLB model.");
            }
            const target = await downloadToFile(result.modelUrls.glb, args.output_path, "model", "glb");
            const others = Object.entries(result.modelUrls)
                .filter(([format, url]) => format !== "glb" && url)
                .map(([format]) => format);
            return text(`3D model saved to:\n  ${target}\n\n` +
                `${result.polycount.toLocaleString()} triangles · ${result.textured ? "textured" : "untextured"} · detail ${result.detail}\n` +
                (others.length
                    ? `Also available from the server as: ${others.join(", ")} (links expire shortly).\n`
                    : "") +
                `Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
        }
        catch (err) {
            return toolError("3D reconstruction", err);
        }
    });
    /* -------------------------------------------------- drawing → 3D -- */
    server.registerTool("drawing_to_3d", {
        title: "Reconstruct a 3D model from a technical drawing",
        description: "Turn a technical drawing — orthographic views, the kind `generate_technical_drawing` produces — into a textured 3D mesh, downloadable as GLB (and FBX, OBJ, USDZ, STL). " +
            "A drawing is line art and nothing reconstructs 3D from line art, so the server first renders the object the views describe and reconstructs that render; both happen in one call and are charged once. " +
            `Chaining \`render_product\` into \`photo_to_3d\` yourself does the same work and pays for the render on top — ${DRAWING_COST + MODEL_3D_COST} credits instead of ${MODEL_3D_COST}, because here the render is a step of the reconstruction rather than a second purchase. ` +
            "The model follows the proportions of the drawing, not its dimensions — for a mesh that honours the numbers, the drawing has to be modelled in CAD. " +
            "Typically one to three minutes; the call blocks until the mesh is ready. " +
            `Costs ${MODEL_3D_COST} credits and requires the Studio plan. The GLB is downloaded to disk and its path returned.`,
        inputSchema: {
            image: z
                .string()
                .describe("The technical drawing (JPG, PNG or WebP): a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
            product_name: z
                .string()
                .optional()
                .describe('What the drawing depicts, e.g. "wall bracket". Grounds the render, which is what the mesh follows.'),
            style: z
                .enum(["photoreal", "studio", "clay", "lifestyle"])
                .optional()
                .describe("The render the mesh is built from. photoreal (default) keeps materials and colour; clay is matte grey and reconstructs the cleanest geometry, because a specular surface gives the depth estimate nothing to lock onto."),
            detail: z
                .enum(["draft", "standard", "high"])
                .optional()
                .describe("Mesh density: draft (12k triangles), standard (40k, default) or high (80k)."),
            textured: z
                .boolean()
                .optional()
                .describe("Generate colour textures. Defaults to true."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the .glb. Defaults to ./techdrawai-output/model-<timestamp>.glb."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.drawingTo3d({
                image: args.image,
                productName: args.product_name,
                style: args.style,
                detail: args.detail,
                textured: args.textured,
            });
            if (!result.modelUrls.glb) {
                throw new Error("The server returned no GLB model.");
            }
            const target = await downloadToFile(result.modelUrls.glb, args.output_path, "model", "glb");
            const others = Object.entries(result.modelUrls)
                .filter(([format, url]) => format !== "glb" && url)
                .map(([format]) => format);
            return text(`3D model saved to:\n  ${target}\n\n` +
                `${result.polycount.toLocaleString()} triangles · ${result.textured ? "textured" : "untextured"} · detail ${result.detail} · ${result.style} render\n` +
                (others.length
                    ? `Also available from the server as: ${others.join(", ")} (links expire shortly).\n`
                    : "") +
                `It follows the proportions of the drawing, not its dimensions.\n` +
                `Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
        }
        catch (err) {
            return toolError("Drawing to 3D", err);
        }
    });
    /* -------------------------------------------------- identify object -- */
    server.registerTool("identify_product", {
        title: "Identify the object in a photo",
        description: "Name the main object in a photo with a short, specific label (e.g. \"L-shaped wall bracket\"). " +
            "Free — no credits. Use it to fill in `product_name` before generating a drawing, which improves both the title block and the estimated dimensions.",
        inputSchema: {
            image: z
                .string()
                .describe("The photo: a local file path, an http(s) URL, or a data:image/…;base64,… URL."),
        },
    }, async ({ image }) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const result = await client.identify(image);
            return text(result.name);
        }
        catch (err) {
            return toolError("Product identification", err);
        }
    });
    /* --------------------------------------------------------- credits -- */
    server.registerTool("check_credits", {
        title: "Check TechDraw AI credits",
        description: "The authenticated account's credit balance, plan, and what each operation costs. Call it before a batch so you know how far the balance goes.",
        inputSchema: {},
    }, async () => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const credits = await client.credits();
            const costs = Object.entries(credits.costs ?? {})
                .map(([operation, cost]) => `  • ${operation}: ${cost === 0 ? "free" : `${cost} credits`}`)
                .join("\n");
            return text(`TechDraw AI${credits.email ? ` (${credits.email})` : ""}\n` +
                `Plan: ${credits.plan ?? "none"}\n` +
                `Balance: ${credits.balance ?? "unknown"} credits\n\n` +
                `Cost per operation:\n${costs}`);
        }
        catch (err) {
            return toolError("Credit check", err);
        }
    });
    return server;
}
