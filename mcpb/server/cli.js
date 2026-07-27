#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";
import { ApiError, TechDrawAiClient, } from "./api.js";
import { clearApiKey, loadConfig, saveApiKey, CONFIG_PATH, DEFAULT_BASE_URL, KEY_PREFIX, } from "./config.js";
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
  techdrawai draw [options]         Photo -> 2D technical drawing (3 credits)
  techdrawai render [options]       Technical drawing -> photoreal render (3 credits)
  techdrawai dxf [options]          Image -> DXF (and DWG) CAD geometry (free)
  techdrawai model3d [options]      Photo -> 3D mesh, GLB (3 credits, Studio plan)
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

model3d options:
  -i, --image <path|url>            Product photo, JPG or PNG                       [required]
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
async function cmdDxf(argv) {
    const flags = parseFlags(argv);
    const image = required(flags, "image", "--image");
    const rawThreshold = str(flags, "threshold");
    let threshold;
    if (rawThreshold !== undefined) {
        if (rawThreshold === "auto") {
            threshold = "auto";
        }
        else {
            const parsed = Number(rawThreshold);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
                fail("--threshold must be a number between 0 and 255, or auto.");
            }
            threshold = parsed;
        }
    }
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
        case "render":
            return cmdRender(rest);
        case "dxf":
        case "vectorize":
            return cmdDxf(rest);
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
