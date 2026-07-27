import { KEY_PREFIX, loadConfig } from "./config.js";
import { toDataUrl } from "./util.js";
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
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Could not reach ${this.baseUrl}: ${message}`);
        }
        const json = (await res.json().catch(() => null));
        if (!res.ok || json?.success !== true) {
            throw new ApiError(json?.message || json?.error || `Request failed (HTTP ${res.status}).`, json?.error ?? "http_error", res.status);
        }
        return json;
    }
    /** Product photo → dimensioned 2D technical drawing. */
    async drawing(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/drawing", {
            method: "POST",
            body: { image: await toDataUrl(image), ...rest },
        });
    }
    /** Technical drawing → photorealistic product render. */
    async render(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/render", {
            method: "POST",
            body: { image: await toDataUrl(image), ...rest },
        });
    }
    /** Product photo → 3D mesh. Studio plan only. */
    async model3d(params) {
        const { image, ...rest } = params;
        return this.request("/api/v1/model-3d", {
            method: "POST",
            body: { image: await toDataUrl(image), ...rest },
        });
    }
    /** Raster image → DXF (optionally DWG too). Free. */
    async dxf(params) {
        const { image, dwg, ...rest } = params;
        return this.request("/api/v1/dxf", {
            method: "POST",
            body: {
                image: await toDataUrl(image),
                ...rest,
                ...(dwg ? { format: "dwg" } : {}),
            },
        });
    }
    /** Existing DXF document → DWG bytes (base64). Free. */
    async dwg(dxf, filename) {
        return this.request("/api/v1/dwg", {
            method: "POST",
            body: { dxf, filename },
        });
    }
    /** Name the object in a photo. Free. */
    async identify(image) {
        return this.request("/api/v1/identify", {
            method: "POST",
            body: { image: await toDataUrl(image) },
        });
    }
    /** Credit balance, plan and per-operation costs. */
    async credits() {
        return this.request("/api/v1/credits", { method: "GET" });
    }
}
const DEFAULT_SETTINGS_URL = "https://techdrawai.com/app?view=settings";
