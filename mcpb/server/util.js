import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
/** Where results land when the caller does not name a path. */
export const OUTPUT_DIR = "techdrawai-output";
const EXT_MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
};
/** Filesystem-safe timestamp like 2026-07-27_16-02-11. */
export function timestamp() {
    return new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
}
/**
 * Largest image we may inline into a request body. Mirrors
 * MAX_INLINE_IMAGE_BYTES in lib/api-constants.ts, and exists here so an
 * oversized file is caught before it is uploaded: past this the platform
 * rejects the body with a page the client cannot parse, and the user sees a
 * bare "HTTP 413" instead of a sentence telling them what to do.
 */
export const MAX_INLINE_IMAGE_BYTES = Math.floor(3.25 * 1024 * 1024);
/** How long to wait when downloading a source image or a finished asset. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Matches the server's formatting, so the same limit reads as the same number
 *  whether it is caught here or reported by the API. */
function mb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2).replace(/\.?0+$/, "")} MB`;
}
/**
 * Turn any supported image input into the field the API should receive.
 *
 * A local file or a data URL is inlined. An http(s) URL is downloaded and
 * inlined too — deliberately, because that is what makes a URL on a private
 * network or a localhost dev server work at all, which the server could never
 * fetch for itself.
 *
 * The one exception is size. When a downloaded image is too big to inline, the
 * URL is handed to the server instead, which may fetch up to four times as
 * much. That path only works for publicly reachable URLs, and the server says
 * so plainly if it cannot get there.
 */
export async function toImageField(input) {
    const value = input.trim();
    if (/^data:image\//i.test(value)) {
        const bytes = Math.floor(((value.split(",")[1] ?? "").length * 3) / 4);
        if (bytes > MAX_INLINE_IMAGE_BYTES) {
            throw new Error(`That image is ${mb(bytes)}, over the ${mb(MAX_INLINE_IMAGE_BYTES)} limit for an inline image. Save it to a file and resize it, or host it and pass the URL instead.`);
        }
        return { image: value };
    }
    if (/^https?:\/\//i.test(value)) {
        let res;
        try {
            res = await fetch(value, {
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Could not fetch ${value}: ${message}`);
        }
        if (!res.ok) {
            throw new Error(`Could not fetch ${value} (HTTP ${res.status})`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        // Too large to inline — let the server fetch it, which it is allowed to do
        // at a much higher limit.
        if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES)
            return { imageUrl: value };
        const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
        return { image: `data:${mime};base64,${buffer.toString("base64")}` };
    }
    // A local file path. readFileSync throws a clear ENOENT when it is wrong.
    const ext = value.split(".").pop()?.toLowerCase() ?? "png";
    const mime = EXT_MIME[ext] ?? "image/png";
    const buffer = readFileSync(value);
    if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
        throw new Error(`${value} is ${mb(buffer.byteLength)}, over the ${mb(MAX_INLINE_IMAGE_BYTES)} limit for an inline image. Resize it, or host it and pass the URL instead — the server will fetch a URL up to 14 MB.`);
    }
    return { image: `data:${mime};base64,${buffer.toString("base64")}` };
}
/** Decode a `data:image/…;base64,…` URL into bytes plus a file extension. */
export function dataUrlToBuffer(dataUrl) {
    const match = /^data:image\/([\w+.-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
        throw new Error("Unexpected image format (expected a data:image/… URL).");
    }
    return {
        buffer: Buffer.from(match[2], "base64"),
        ext: match[1] === "jpeg" ? "jpg" : match[1],
    };
}
/**
 * Where to write a result. An explicit path wins (relative paths resolve
 * against the working directory); otherwise a timestamped file lands under
 * ./techdrawai-output so nothing is ever silently overwritten.
 */
export function resolveOutputPath(outputPath, prefix, ext) {
    if (outputPath && outputPath.trim()) {
        const value = outputPath.trim();
        return isAbsolute(value) ? value : join(process.cwd(), value);
    }
    return join(process.cwd(), OUTPUT_DIR, `${prefix}-${timestamp()}.${ext}`);
}
/** Write bytes to disk, creating parent directories. Returns the path. */
export function saveBuffer(buffer, outputPath, prefix, ext) {
    const target = resolveOutputPath(outputPath, prefix, ext);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    return target;
}
/** Decode a result image and write it to disk. Returns the path. */
export function saveImage(dataUrl, outputPath, prefix) {
    const { buffer, ext } = dataUrlToBuffer(dataUrl);
    return saveBuffer(buffer, outputPath, prefix, ext);
}
/** Write text (a DXF document) to disk. Returns the path. */
export function saveText(text, outputPath, prefix, ext) {
    return saveBuffer(Buffer.from(text, "utf8"), outputPath, prefix, ext);
}
/** Download a hosted asset (GLB, FBX, …) to disk. Returns the path. */
export async function downloadToFile(url, outputPath, prefix, ext) {
    let res;
    try {
        res = await fetch(url, {
            // A mesh is tens of megabytes, so this is more generous than a source
            // image — but never unbounded: a stalled download must not hang an agent.
            signal: AbortSignal.timeout(3 * DOWNLOAD_TIMEOUT_MS),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not download ${url}: ${message}`);
    }
    if (!res.ok) {
        throw new Error(`Could not download ${url} (HTTP ${res.status})`);
    }
    return saveBuffer(Buffer.from(await res.arrayBuffer()), outputPath, prefix, ext);
}
/**
 * Swap the extension on a path, keeping the directory and base name. Used when
 * one call produces two files (a DXF and its DWG) and the caller named only one.
 */
export function withExtension(path, ext) {
    const dot = path.lastIndexOf(".");
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const base = dot > slash ? path.slice(0, dot) : path;
    return `${base}.${ext}`;
}
