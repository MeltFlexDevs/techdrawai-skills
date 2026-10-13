import { KEY_PREFIX, loadConfig } from "./config.js";
import { toImageField } from "./util.js";
/**
 * Per-operation client deadlines, each set a little above the matching
 * `maxDuration` on the server so the server always gets the chance to answer
 * (and to refund) before the client gives up on it.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Server maxDuration 120s for drawing, render, dxf and dwg. */
const GENERATION_TIMEOUT_MS = 150_000;
/** The server gives the image call 150 s and still has to answer after it. */
const TEXT_DRAWING_TIMEOUT_MS = 200_000;
/** Server maxDuration 300s: 3D reconstruction genuinely takes minutes. */
const MODEL_3D_TIMEOUT_MS = 330_000;
/** Thrown for every non-OK reply, carrying the server's machine-readable code. */
export class ApiError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "ApiError";
    }
}
export class TechDrawAiClient {
    apiKey;
    baseUrl;
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    static fromConfig() {
        const { apiKey, baseUrl } = loadConfig();
        if (!apiKey) {
            throw new Error(`No TechDraw AI API key configured. Run \`techdrawai auth login\`, or set TECHDRAWAI_API_KEY. Keys are created in Settings at ${DEFAULT_SETTINGS_URL} (an active plan is required).`);
        }
        if (!apiKey.startsWith(KEY_PREFIX)) {
            throw new Error(`That API key does not look right — TechDraw AI keys start with \`${KEY_PREFIX}\`. Run \`techdrawai auth login\` to replace it.`);
        }
        return new TechDrawAiClient(apiKey, baseUrl.replace(/\/$/, ""));
    }
    async request(path, init) {
        let res;
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method: init.method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
                // Never unbounded. Without this a stalled connection hangs the CLI, or
                // worse, wedges the agent's MCP session with no way to tell why.
                signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === "TimeoutError") {
                throw new Error(`${this.baseUrl}${path} did not answer within ${Math.round((init.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s. Nothing was charged unless the server completed the work.`);
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Could not reach ${this.baseUrl}: ${message}`);
        }
        const json = (await res.json().catch(() => null));
        if (!res.ok || json?.success !== true) {
            // A body we could not parse means the reply did not come from the API
            // itself — a platform error page, a proxy, a captive portal. Say so,
            // because "Request failed (HTTP 413)" tells the user nothing.
            if (json === null) {
                throw new ApiError(res.status === 413
                    ? "That request was too large for the server to accept. Send a smaller image."
                    : `The server returned HTTP ${res.status} with no JSON body — this did not come from the TechDraw AI API.`, "http_error", res.status);
            }
            throw new ApiError(json.message || json.error || `Request failed (HTTP ${res.status}).`, json.error ?? "http_error", res.status);
        }
        return json;
    }
    /** Product photo → dimensioned 2D technical drawing. */
    async drawing(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/drawing", {
            method: "POST",
            body: { ...(await toImageField(image)), ...rest },
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
    }
    /** Written description → dimensioned 2D technical drawing. */
    async textDrawing(params) {
        return this.request("/api/v1/text-to-drawing", {
            method: "POST",
            body: params,
            timeoutMs: TEXT_DRAWING_TIMEOUT_MS,
        });
    }
    /** Technical drawing → photorealistic product render. */
    async render(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/render", {
            method: "POST",
            body: { ...(await toImageField(image)), ...rest },
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
    }
    /** Product photo → 3D mesh. Studio plan only. */
    async model3d(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/model-3d", {
            method: "POST",
            body: { ...(await toImageField(image)), ...rest },
            timeoutMs: MODEL_3D_TIMEOUT_MS,
        });
    }
    /**
     * Technical drawing → 3D mesh, as one call and one charge. Studio plan only.
     *
     * The server renders the drawing and reconstructs that render. Chaining
     * `render()` and `model3d()` by hand does the same work and pays for the
     * render on top, because here the render is a step of the reconstruction
     * rather than a second purchase.
     */
    async drawingTo3d(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/drawing-to-3d", {
            method: "POST",
            body: { ...(await toImageField(image)), ...rest },
            timeoutMs: MODEL_3D_TIMEOUT_MS,
        });
    }
    /** Raster image → DXF (optionally DWG too). Free. */
    async dxf(params) {
        const { image, dwg, ...rest } = params;
        return this.request("/api/v1/dxf", {
            method: "POST",
            body: {
                ...(await toImageField(image)),
                ...rest,
                ...(dwg ? { format: "dwg" } : {}),
            },
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
    }
    /** Raster image → 3D printable binary STL (base64). Free. */
    async stl(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/stl", {
            method: "POST",
            body: { ...(await toImageField(image)), ...rest },
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
    }
    /** Existing DXF document → DWG bytes (base64). Free. */
    async dwg(dxf, filename) {
        return this.request("/api/v1/dwg", {
            method: "POST",
            body: { dxf, filename },
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
    }
    /** Name the object in a photo. Free. */
    async identify(image) {
        return this.request("/api/v1/identify", {
            method: "POST",
            body: await toImageField(image),
        });
    }
    /** Credit balance, plan and per-operation costs. */
    async credits() {
        return this.request("/api/v1/credits", {
            method: "GET",
            timeoutMs: 30_000,
        });
    }
}
const DEFAULT_SETTINGS_URL = "https://techdrawai.com/app?view=settings";
