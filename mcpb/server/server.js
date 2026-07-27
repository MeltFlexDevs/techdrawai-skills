import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TechDrawAiClient } from "./api.js";
import { downloadToFile, saveBuffer, saveImage, saveText, withExtension, } from "./util.js";
export const VERSION = "0.1.0";
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
/** Turn any thrown value into the error content block MCP expects. */
function toolError(action, err) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: `${action} failed: ${err instanceof Error ? err.message : String(err)}`,
            },
        ],
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
            "Costs 3 credits. The drawing image is saved to disk and its path returned — feed that path to `image_to_dxf` for CAD geometry, or to `render_product` for a photoreal render.",
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
    /* -------------------------------------------------- product render -- */
    server.registerTool("render_product", {
        title: "Render a product from a technical drawing",
        description: "The reverse of drafting: take a 2D technical drawing and produce a photorealistic image of the finished, manufactured product. " +
            "The geometry is reconstructed from the views in the drawing, so the render matches the design rather than inventing a new one. " +
            "Choose the look (photoreal, studio, matte clay, lifestyle), the background, the camera angle and the material/finish. " +
            "Costs 3 credits. The render is saved to disk and its path returned.",
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
    /* ---------------------------------------------------- photo → 3D -- */
    server.registerTool("photo_to_3d", {
        title: "Reconstruct a 3D model from a photo",
        description: "Turn a photograph of a single object into a textured 3D mesh, downloadable as GLB (and FBX, OBJ, USDZ, STL). " +
            "Reconstruction is asynchronous on the server and typically takes one to three minutes — the call blocks until the mesh is ready. " +
            "Needs a clear photo of one object, as JPG or PNG. " +
            "Costs 3 credits and requires the Studio plan. The GLB is downloaded to disk and its path returned.",
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
