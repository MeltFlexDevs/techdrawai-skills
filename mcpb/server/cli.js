#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";
import { ApiError, TechDrawAiClient, } from "./api.js";
import { clearApiKey, loadConfig, saveApiKey, CONFIG_PATH, DEFAULT_BASE_URL, KEY_PREFIX, DRAWING_COST, MODEL_3D_COST, } from "./config.js";
import { loginViaBrowser } from "./auth-login.js";
import { downloadToFile, saveBuffer, saveImage, saveText, withExtension, } from "./util.js";
const USAGE = `TechDraw AI — photo to technical drawing, CAD geometry, 3D model or render.

Usage:
  techdrawai                        Start the MCP server over stdio (used by AI agents)
  techdrawai auth login             Sign in via your browser (recommended)
  techdrawai auth ${KEY_PREFIX}…         Save an existing API key manually
  techdrawai auth logout            Forget the stored key
  techdrawai whoami                 Show authentication status
  techdrawai credits                Show your balance, plan and per-operation costs
  techdrawai draw [options]         Photo -> 2D technical drawing (${DRAWING_COST} credits)
  techdrawai text "<part>" [opts]   Description -> 2D technical drawing (${DRAWING_COST} credits)
  techdrawai render [options]       Technical drawing -> photoreal render (${DRAWING_COST} credits)
  techdrawai dxf [options]          Image -> DXF (and DWG) CAD geometry (free)
  techdrawai stl [options]          Image -> 3D printable STL, extruded (free)
  techdrawai model3d [options]      Photo -> 3D mesh, GLB (${MODEL_3D_COST} credits, Studio plan)
  techdrawai drawing3d [options]    Drawing -> 3D mesh, GLB (${MODEL_3D_COST} credits, Studio plan)
  techdrawai identify -i <image>    Name the object in a photo (free)

draw options:
  -i, --image <path|url>            Product photo                                   [required]
  -n, --name <text>                 What the object is, e.g. "oak dining chair"
  -m, --measure <value:where>       A real measurement, e.g. 420:overall-width
                                    (repeatable; anchors the whole drawing to real sizes)
  -u, --units <mm|cm|m|in>          Primary unit (default mm)
  -s, --standard <ISO|ANSI>         Drafting standard (default ISO)
  -p, --paper <A4..A0|ANSI A..E>    Sheet size (default A3 / ANSI B)
      --projection <first-angle|third-angle>   Projection angle (default first-angle)
  -t, --type <working|assembly|as-fitted|patent>  Drawing type (default working)
  -v, --views <front,top,side,isometric>   Views to include (default front,top,side)
      --notes <text>                Extra instructions for the drawing
  -o, --out <path>                  Where to save (default ./techdrawai-output/)

text options:
  "<part>"                          What the part is and its sizes, in quotes        [required]
  -u, --units <mm|in>               Units of bare numbers (default: read from the text)
  -s, --standard <ISO|ANSI>         Drafting standard (default ISO)
  -p, --paper <A4|A3|A2|A1>         ISO sheet (default A3; ANSI is always ANSI B)
      --projection <first-angle|third-angle>   (default first-angle, third-angle on ANSI)
  -o, --out <path>                  Where to save (default ./techdrawai-output/)

render options:
  -i, --image <path|url>            The technical drawing                           [required]
  -n, --name <text>                 What the object is
      --style <photoreal|studio|clay|lifestyle>   Look (default photoreal)
      --background <white|gradient|scene>         Backdrop (default white)
      --angle <front|three-quarter|top|isometric> Camera (default three-quarter)
      --material <text>             Material and finish
      --notes <text>                Anything else to emphasise
  -o, --out <path>                  Where to save (default ./techdrawai-output/)

dxf options:
  -i, --image <path|url>            Image to trace                                  [required]
      --threshold <0-255|auto>      Ink/paper cut-off (default auto)
      --invert                      Trace light lines on a dark background
      --smoothing <number>          1 keeps detail, higher smooths (default 1)
      --width-mm <number>           Real-world width in millimetres
      --dwg                         Also write a .dwg beside the .dxf
  -o, --out <path>                  Where to save the .dxf (default ./techdrawai-output/)

stl options:
  -i, --image <path|url>            Image to trace and extrude                      [required]
      --threshold <0-255|auto>      Ink/paper cut-off (default auto)
      --invert                      Trace light lines on a dark background
      --smoothing <number>          1 keeps detail, higher smooths (default 1)
      --max-dim <pixels>            Longest traced side (default 1600)
      --thickness-mm <number>       Extrusion height (default 3)
      --size-mm <number>            Longest side of the model (default 100)
      --min-feature-mm <number>     Drop detail finer than this (default 0.3)
  -o, --out <path>                  Where to save the .stl (default ./techdrawai-output/)

model3d options:
  -i, --image <path|url>            Product photo, JPG or PNG                       [required]
  -d, --detail <draft|standard|high>  Mesh density (default standard)
      --no-texture                  Skip colour textures
  -o, --out <path>                  Where to save the .glb (default ./techdrawai-output/)

drawing3d options:
  -i, --image <path|url>            Technical drawing, JPG, PNG or WebP             [required]
  -n, --name <text>                 What the drawing depicts, e.g. "wall bracket"
      --style <photoreal|studio|clay|lifestyle>  The render it is built from
                                    (default photoreal; clay gives the cleanest geometry)
  -d, --detail <draft|standard|high>  Mesh density (default standard)
      --no-texture                  Skip colour textures
  -o, --out <path>                  Where to save the .glb (default ./techdrawai-output/)

Create an API key in Settings at ${DEFAULT_BASE_URL}/app?view=settings (an active plan is required).
Config file: ${CONFIG_PATH}
Environment: TECHDRAWAI_API_KEY, TECHDRAWAI_BASE_URL
`;
const ALIASES = {
    "-i": "image", "--image": "image",
    "-n": "name", "--name": "name",
    "-m": "measure", "--measure": "measure",
    "-u": "units", "--units": "units",
    "-s": "standard", "--standard": "standard",
    "-p": "paper", "--paper": "paper",
    "-t": "type", "--type": "type",
    "-v": "views", "--views": "views",
    "-d": "detail", "--detail": "detail",
    "-o": "out", "--out": "out",
    "--projection": "projection",
    "--notes": "notes",
    "--style": "style",
    "--background": "background",
    "--angle": "angle",
    "--material": "material",
    "--threshold": "threshold",
    "--invert": "invert",
    "--smoothing": "smoothing",
    "--width-mm": "widthMm",
    "--dwg": "dwg",
    "--no-texture": "noTexture",
    "--max-dim": "maxDim",
    "--thickness-mm": "thicknessMm",
    "--size-mm": "sizeMm",
    "--min-feature-mm": "minFeatureMm",
};
/** Flags that take no value. */
const BOOLEANS = new Set(["invert", "dwg", "noTexture"]);
/** Flags that may be repeated and collect into an array. */
const REPEATABLE = new Set(["measure"]);
function parseFlags(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const key = ALIASES[argv[i]];
        if (!key) {
            fail(`Unknown option: ${argv[i]}`);
        }
        if (BOOLEANS.has(key)) {
            out[key] = true;
            continue;
        }
        const value = argv[++i];
        if (value === undefined)
            fail(`Option ${argv[i - 1]} needs a value.`);
        if (REPEATABLE.has(key)) {
            const list = out[key] ?? [];
            list.push(value);
            out[key] = list;
        }
        else {
            out[key] = value;
        }
    }
    return out;
}
function fail(message) {
    console.error(`Error: ${message}\n`);
    console.error("Run `techdrawai help` for usage.");
    process.exit(1);
}
function str(flags, key) {
    const value = flags[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function required(flags, key, flag) {
    const value = str(flags, key);
    if (!value)
        fail(`${flag} is required.`);
    return value;
}
/** Validate against a fixed set, or exit with the accepted values listed. */
function choice(value, allowed, flag) {
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        fail(`${flag} must be one of: ${allowed.join(", ")}`);
    }
    return value;
}
function number(flags, key, flag) {
    const value = str(flags, key);
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        fail(`${flag} must be a number.`);
    return parsed;
}
/**
 * `-m 420:overall width` — the measured value, then optionally where it was
 * taken. Orientation is inferred from the position wording, which is what a
 * person actually types ("overall width" is horizontal, "height" is vertical).
 */
function parseMeasurements(flags, units) {
    const raw = flags.measure;
    if (!Array.isArray(raw))
        return [];
    return raw.map((entry) => {
        const [value, ...rest] = entry.split(":");
        const position = rest.join(":").trim() || "overall";
        if (!value.trim() || !Number.isFinite(Number(value))) {
            fail(`--measure expects a number first, e.g. --measure 420:overall width (got "${entry}").`);
        }
        const lowered = position.toLowerCase();
        const orientation = /height|tall|depth\b/.test(lowered)
            ? "vertical"
            : /diagonal|across/.test(lowered)
                ? "diagonal"
                : "horizontal";
        return { value: value.trim(), unit: units, orientation, position };
    });
}
/* ---------------------------------------------------------- commands -- */
async function runServer() {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    // stdout is the JSON-RPC channel — only ever log to stderr.
    console.error(`[techdrawai] MCP server ${VERSION} running on stdio`);
}
async function cmdDraw(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const units = choice(str(flags, "units"), ["mm", "cm", "m", "in"], "--units");
    const measurements = parseMeasurements(flags, units);
    const views = str(flags, "views")
        ?.split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    for (const view of views ?? []) {
        choice(view, ["front", "top", "side", "isometric"], "--views");
    }
    const client = TechDrawAiClient.fromConfig();
    console.error(measurements.length
        ? `Generating a technical drawing from ${measurements.length} measurement${measurements.length > 1 ? "s" : ""}…`
        : "Generating a technical drawing (dimensions estimated)…");
    const result = await client.drawing({
        image,
        productName: str(flags, "name"),
        units,
        measurements: measurements.length ? measurements : undefined,
        estimateDimensions: measurements.length === 0,
        standard: choice(str(flags, "standard"), ["ISO", "ANSI"], "--standard"),
        paperSize: str(flags, "paper"),
        projection: choice(str(flags, "projection"), ["first-angle", "third-angle"], "--projection"),
        drawingType: choice(str(flags, "type"), ["working", "assembly", "as-fitted", "patent"], "--type"),
        views: views,
        notes: str(flags, "notes"),
    });
    const target = saveImage(result.image, str(flags, "out"), "drawing");
    console.log(`Saved to ${target}`);
    if (result.notes)
        console.log(`Notes: ${result.notes}`);
    console.log(`Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
}
async function cmdText(argv) {
    // The description is the one positional argument: `techdrawai text "…" -u mm`.
    const at = argv.findIndex((a) => !a.startsWith("-"));
    const isValue = at > 0 && ALIASES[argv[at - 1]] !== undefined && !BOOLEANS.has(ALIASES[argv[at - 1]]);
    if (at === -1 || isValue)
        fail('Describe the part in quotes, e.g. techdrawai text "Steel plate 120 x 80 x 6 mm, four 9 mm holes 10 mm from each edge".');
    const prompt = argv[at].trim();
    const flags = parseFlags([...argv.slice(0, at), ...argv.slice(at + 1)]);
    // Validated before anything is printed or sent.
    const params = {
        prompt,
        units: choice(str(flags, "units"), ["mm", "in"], "--units"),
        standard: choice(str(flags, "standard"), ["ISO", "ANSI"], "--standard"),
        paperSize: choice(str(flags, "paper"), ["A4", "A3", "A2", "A1"], "--paper"),
        projection: choice(str(flags, "projection"), ["first-angle", "third-angle"], "--projection"),
    };
    const client = TechDrawAiClient.fromConfig();
    console.error("Drawing the part from its description…");
    const result = await client.textDrawing(params);
    const target = saveImage(result.image, str(flags, "out"), "text-drawing");
    console.log(`Saved to ${target}`);
    console.log(`Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
}
async function cmdRender(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const client = TechDrawAiClient.fromConfig();
    console.error("Rendering the product…");
    const result = await client.render({
        image,
        productName: str(flags, "name"),
        style: choice(str(flags, "style"), ["photoreal", "studio", "clay", "lifestyle"], "--style"),
        background: choice(str(flags, "background"), ["white", "gradient", "scene"], "--background"),
        angle: choice(str(flags, "angle"), ["front", "three-quarter", "top", "isometric"], "--angle"),
        material: str(flags, "material"),
        notes: str(flags, "notes"),
    });
    const target = saveImage(result.image, str(flags, "out"), "render");
    console.log(`Saved to ${target}`);
    if (result.notes)
        console.log(`Notes: ${result.notes}`);
    console.log(`Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
}
/** `--threshold`, shared by the two tracing commands: a number, or "auto". */
function traceThreshold(flags) {
    const raw = str(flags, "threshold");
    if (raw === undefined)
        return undefined;
    if (raw === "auto")
        return "auto";
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
        fail("--threshold must be a number between 0 and 255, or auto.");
    }
    return parsed;
}
async function cmdDxf(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const threshold = traceThreshold(flags);
    const client = TechDrawAiClient.fromConfig();
    console.error("Tracing to CAD geometry…");
    const result = await client.dxf({
        image,
        threshold,
        invert: flags.invert === true,
        smoothing: number(flags, "smoothing", "--smoothing"),
        widthMm: number(flags, "widthMm", "--width-mm"),
        dwg: flags.dwg === true,
    });
    const dxfPath = saveText(result.dxf, str(flags, "out"), "drawing", "dxf");
    console.log(`Saved to ${dxfPath}`);
    if (flags.dwg === true) {
        if (result.dwg) {
            const dwgPath = saveBuffer(Buffer.from(result.dwg, "base64"), withExtension(dxfPath, "dwg"), "drawing", "dwg");
            console.log(`Saved to ${dwgPath}`);
        }
        else {
            console.error(`DWG was not produced: ${result.dwgError ?? "conversion unavailable"}. The DXF above is unaffected.`);
        }
    }
    console.log(`${result.contours} contours · ${result.width.toFixed(1)} × ${result.height.toFixed(1)} units · threshold ${result.threshold} · no credits used`);
}
async function cmdStl(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const threshold = traceThreshold(flags);
    const client = TechDrawAiClient.fromConfig();
    console.error("Tracing and extruding to STL…");
    const result = await client.stl({
        image,
        threshold,
        invert: flags.invert === true,
        smoothing: number(flags, "smoothing", "--smoothing"),
        maxDim: number(flags, "maxDim", "--max-dim"),
        thicknessMm: number(flags, "thicknessMm", "--thickness-mm"),
        sizeMm: number(flags, "sizeMm", "--size-mm"),
        minFeatureMm: number(flags, "minFeatureMm", "--min-feature-mm"),
    });
    const path = saveBuffer(Buffer.from(result.stl, "base64"), str(flags, "out"), "model", "stl");
    console.log(`Saved to ${path}`);
    console.log(`${result.triangles} triangles · ${result.widthMm} × ${result.heightMm} × ${result.thicknessMm} mm · threshold ${result.threshold} · no credits used`);
}
/**
 * Drawing → 3D, in one call.
 *
 * Deliberately not `render` piped into `model3d`: the server does both halves
 * behind a single charge, and doing it by hand costs twice for the same mesh.
 */
async function cmdDrawing3d(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const client = TechDrawAiClient.fromConfig();
    console.error("Picturing the object, then reconstructing it… (this usually takes 1–3 minutes)");
    const result = await client.drawingTo3d({
        image,
        productName: str(flags, "name"),
        style: choice(str(flags, "style"), ["photoreal", "studio", "clay", "lifestyle"], "--style"),
        detail: choice(str(flags, "detail"), ["draft", "standard", "high"], "--detail"),
        textured: flags.noTexture === true ? false : undefined,
    });
    if (!result.modelUrls.glb)
        throw new Error("The server returned no GLB model.");
    const target = await downloadToFile(result.modelUrls.glb, str(flags, "out"), "model", "glb");
    console.log(`Saved to ${target}`);
    console.log(`${result.polycount.toLocaleString()} triangles · ${result.textured ? "textured" : "untextured"} · detail ${result.detail} · ${result.style} render`);
    console.log("It follows the proportions of the drawing, not its dimensions.");
    console.log(`Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
}
async function cmdModel3d(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const client = TechDrawAiClient.fromConfig();
    console.error("Reconstructing a 3D model… (this usually takes 1–3 minutes)");
    const result = await client.model3d({
        image,
        detail: choice(str(flags, "detail"), ["draft", "standard", "high"], "--detail"),
        textured: flags.noTexture === true ? false : undefined,
    });
    if (!result.modelUrls.glb)
        throw new Error("The server returned no GLB model.");
    const target = await downloadToFile(result.modelUrls.glb, str(flags, "out"), "model", "glb");
    console.log(`Saved to ${target}`);
    console.log(`${result.polycount.toLocaleString()} triangles · ${result.textured ? "textured" : "untextured"} · detail ${result.detail}`);
    console.log(`Credits used: ${result.creditsUsed} · Balance: ${result.balance}`);
}
async function cmdIdentify(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const client = TechDrawAiClient.fromConfig();
    console.log((await client.identify(image)).name);
}
async function cmdCredits() {
    const client = TechDrawAiClient.fromConfig();
    const credits = await client.credits();
    console.log(`TechDraw AI${credits.email ? ` (${credits.email})` : ""}`);
    console.log(`Plan: ${credits.plan ?? "none"}`);
    console.log(`Balance: ${credits.balance ?? "unknown"} credits`);
    console.log("Cost per operation:");
    for (const [operation, cost] of Object.entries(credits.costs ?? {})) {
        console.log(`  • ${operation}: ${cost === 0 ? "free" : `${cost} credits`}`);
    }
}
async function cmdAuth(argv) {
    const argument = argv[0]?.trim();
    if (argument === "logout") {
        console.log(clearApiKey()
            ? `Signed out. Key removed from ${CONFIG_PATH}`
            : "No stored API key to remove.");
        return;
    }
    // Browser-based login (the recommended path) — no copying keys by hand.
    if (!argument || argument === "login") {
        const { baseUrl } = loadConfig();
        const key = await loginViaBrowser(baseUrl || DEFAULT_BASE_URL);
        console.log(`Signed in. API key saved to ${saveApiKey(key)}`);
        return;
    }
    if (!argument.startsWith(KEY_PREFIX)) {
        fail(`An API key starts with \`${KEY_PREFIX}\`. Use \`techdrawai auth login\` to sign in through your browser instead.`);
    }
    console.log(`API key saved to ${saveApiKey(argument)}`);
}
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    switch (command) {
        case undefined:
        case "serve":
        case "mcp":
            return runServer();
        case "auth":
            return cmdAuth(rest);
        case "whoami": {
            const { apiKey, baseUrl } = loadConfig();
            if (!apiKey) {
                console.log("Not authenticated. Run: techdrawai auth login");
                return;
            }
            console.log(`Authenticated (key ${apiKey.slice(0, 15)}…) → ${baseUrl}`);
            // A stored key can still be revoked server-side, so confirm it live.
            try {
                const credits = await TechDrawAiClient.fromConfig().credits();
                console.log(`Account: ${credits.email ?? "unknown"} · plan ${credits.plan ?? "none"} · ${credits.balance ?? "?"} credits`);
            }
            catch (err) {
                console.log(`The key did not verify: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        case "credits":
            return cmdCredits();
        case "draw":
        case "drawing":
            return cmdDraw(rest);
        case "text":
            return cmdText(rest);
        case "render":
            return cmdRender(rest);
        case "dxf":
        case "vectorize":
            return cmdDxf(rest);
        case "stl":
        case "extrude":
            return cmdStl(rest);
        case "drawing3d":
            return cmdDrawing3d(rest);
        case "model3d":
        case "3d":
            return cmdModel3d(rest);
        case "identify":
            return cmdIdentify(rest);
        case "version":
        case "--version":
        case "-V":
            console.log(VERSION);
            return;
        case "help":
        case "--help":
        case "-h":
            console.log(USAGE);
            return;
        default:
            console.error(`Unknown command: ${command}\n`);
            console.log(USAGE);
            process.exit(1);
    }
}
main().catch((err) => {
    if (err instanceof ApiError) {
        console.error(`[techdrawai] ${err.message}`);
        process.exit(err.status === 402 || err.status === 403 ? 2 : 1);
    }
    console.error(`[techdrawai] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
