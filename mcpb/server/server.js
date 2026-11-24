import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, TechDrawAiClient } from "./api.js";
import { DRAWING_COST, MODEL_3D_COST } from "./config.js";
import { describeSaved, saveJobFiles } from "./jobs.js";
import { saveBuffer, saveImage, saveText, withExtension, } from "./util.js";
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
    /* ------------------------------------------------- 3D and CAD jobs -- */
    const jobStarted = (what, jobId, extra, credits, balance) => text(`${what} started. job_id: ${jobId}${extra}\n` +
        `Credits charged: ${credits} (refunded automatically if nothing is built) · Balance: ${balance ?? "unknown"}\n\n` +
        "Call check_job with this job_id about every 30 seconds; when it is done the files are downloaded to disk.");
    const CAD_FILES = "an exact, editable CAD part: a STEP file for CAD programs (Fusion, SolidWorks, FreeCAD, Onshape), an STL for " +
        "3D printing and a 3MF for slicers, modelled by TechDraw AI's AI CAD agent, which writes build123d (OpenCascade) " +
        "code, runs it, measures the result and checks it against the request";
    server.registerTool("text_to_cad", {
        title: "Model a CAD part from a description",
        description: `AI CAD, as on techdrawai.com/app/ai-cad: turn a written description into ${CAD_FILES}. Dimensions are exact, ` +
            "not estimated: put every size the user gave in the prompt. Best for brackets, enclosures, mounts, flanges, " +
            "adapters, spacers, gears and other mechanical parts. Up to three photos, sketches or drawings can go in `images` " +
            "(sizes written on them are used exactly). To change a part already made, pass its project_id with the change. " +
            "Starts a background job (two to eight minutes) and returns a job_id for check_job. " +
            `Costs ${MODEL_3D_COST} credits and requires the Studio plan; refunded if nothing is built.`,
        inputSchema: {
            prompt: z.string().max(8000).describe("The part: what it is, every dimension in mm, holes, fillets, material."),
            images: z
                .array(z.string())
                .max(3)
                .optional()
                .describe("Up to three photos, sketches or drawings: local file paths, http(s) URLs or data:image URLs."),
            project_id: z
                .string()
                .optional()
                .describe("A project_id from an earlier text_to_cad or drawing_to_3d job, to change that part."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const r = await client.aiCad({ prompt: args.prompt, images: args.images, projectId: args.project_id });
            return jobStarted("CAD part", r.jobId, ` · project_id: ${r.projectId}`, r.creditsUsed, r.balance);
        }
        catch (err) {
            return toolError("AI CAD", err);
        }
    });
    server.registerTool("drawing_to_3d", {
        title: "Model a CAD part from a technical drawing",
        description: `Turn a technical drawing or a dimensioned sketch into ${CAD_FILES}. The dimensions written on the drawing ` +
            "are used exactly; `notes` carries anything the sheet leaves out. The same AI CAD agent as text_to_cad. " +
            "Starts a background job (two to eight minutes) and returns a job_id for check_job. " +
            `Costs ${MODEL_3D_COST} credits and requires the Studio plan; refunded if nothing is built.`,
        inputSchema: {
            image: z
                .string()
                .describe("The drawing or sketch (JPG, PNG or WebP): a local file path, an http(s) URL, or a data:image URL."),
            notes: z.string().max(8000).optional().describe("What the part is, and any size the drawing leaves out, in mm."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const r = await client.drawingTo3d({ image: args.image, notes: args.notes });
            return jobStarted("CAD part", r.jobId, ` · project_id: ${r.projectId}`, r.creditsUsed, r.balance);
        }
        catch (err) {
            return toolError("Drawing to 3D", err);
        }
    });
    server.registerTool("cad_to_drawing", {
        title: "Draw an AI CAD part as a technical drawing",
        description: "Make a dimensioned technical drawing of a finished AI CAD part (a project_id from text_to_cad or " +
            "drawing_to_3d): the exact model drawn from every side with its measured sizes, holes and radii, drafted as an " +
            "ISO A3 sheet. One to two minutes; the PNG is saved to disk and its path returned, and the drawing is saved to " +
            `the user's TechDraw AI projects for editing. Costs ${DRAWING_COST} credits and requires the Studio plan.`,
        inputSchema: {
            project_id: z.string().describe("The CAD part's project_id."),
            output_path: z
                .string()
                .optional()
                .describe("Where to save the PNG. Defaults to ./techdrawai-output/cad-drawing-<timestamp>.png."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const r = await client.cadDrawing(args.project_id);
            const path = saveImage(r.image, args.output_path, "cad-drawing");
            return text(`Technical drawing of ${r.title} saved to:\n  ${path}\n\nEdit it at ${r.editUrl}\n` +
                `Credits used: ${r.creditsUsed} · Balance: ${r.balance ?? "unknown"}`);
        }
        catch (err) {
            return toolError("CAD drawing", err);
        }
    });
    server.registerTool("photo_to_3d", {
        title: "Reconstruct a textured 3D model from a photo",
        description: "Turn a photo of one real object (furniture, a product) into a textured 3D mesh, as Photo to 3D CAD on " +
            "techdrawai.com: GLB, STL, OBJ, FBX and USDZ. It follows the photo's shape and colours, not exact dimensions; " +
            "for a part with real sizes use text_to_cad. Starts a background job (usually one to five minutes) and returns " +
            `a job_id for check_job. Costs ${MODEL_3D_COST} credits and requires the Studio plan; refunded if it fails.`,
        inputSchema: {
            image: z
                .string()
                .describe("The photo (JPG, PNG or WebP): a local file path, an http(s) URL, or a data:image URL."),
            detail: z.enum(["draft", "standard", "high"]).optional().describe("Mesh density. Default standard."),
            textured: z.boolean().optional().describe("Colour textures from the photo. Default true."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const r = await client.model3d({ image: args.image, detail: args.detail, textured: args.textured });
            return jobStarted("3D model", r.jobId, "", r.creditsUsed, r.balance);
        }
        catch (err) {
            return toolError("3D reconstruction", err);
        }
    });
    server.registerTool("check_job", {
        title: "Check a 3D or CAD job",
        description: "Report on a job started by text_to_cad, drawing_to_3d or photo_to_3d. While it runs, says so; when it is done, " +
            "downloads every file (STEP, STL, 3MF for a CAD part; GLB, STL, OBJ, FBX, USDZ for a photo model) to disk and " +
            "returns the paths. Free. Poll about every 30 seconds.",
        inputSchema: {
            job_id: z.string().describe("The job_id the tool returned."),
            output_dir: z.string().optional().describe("Folder for the files. Defaults to ./techdrawai-output."),
        },
    }, async (args) => {
        try {
            const client = TechDrawAiClient.fromConfig();
            const job = await client.job(args.job_id);
            if (job.status === "running") {
                const pct = job.progress != null ? ` (${job.progress}%)` : "";
                return text(`Still building${pct}. Check again in 30 seconds.`);
            }
            if (job.status === "failed") {
                return {
                    isError: true,
                    content: [{ type: "text", text: `${job.error ?? "The job failed."}${job.refunded ? " The credits were refunded." : ""}` }],
                };
            }
            if (job.status === "needs_input") {
                const asked = (job.questions ?? [])
                    .map((q) => `- ${q.question} Options: ${q.options.map((o) => o.label).join("; ")}`)
                    .join("\n");
                return text(`The CAD agent needs answers before it can model this part. Nothing was charged.\n${asked}\n` +
                    `Ask the user, then call text_to_cad again with their answers and project_id: ${job.projectId}.`);
            }
            const prefix = job.kind === "model-3d" ? "model" : "part";
            const saved = await saveJobFiles(job, args.output_dir, prefix);
            return text(`${job.kind === "model-3d" ? "3D model" : "CAD part"} ready:\n${describeSaved(saved, job)}\n` +
                (job.summary ? `\nWhat the CAD agent built:\n${job.summary}\n` : "") +
                (job.projectId
                    ? `\nproject_id: ${job.projectId} (text_to_cad changes it; cad_to_drawing draws it).\n`
                    : "") +
                `Credits used: ${job.creditsUsed ?? 0}`);
        }
        catch (err) {
            return toolError("Job check", err);
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
