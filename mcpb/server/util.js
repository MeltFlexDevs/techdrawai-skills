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
 * Normalise any supported image input into a `data:image/…;base64,…` URL.
 * Accepts an existing data URL, an http(s) URL (fetched here), or a local file
 * path.
 *
 * Everything is converted client-side on purpose: the server would otherwise
 * have to fetch the caller's URL itself, and a local path — which is what an
 * agent or a shell almost always has — could not be sent at all.
 */
export async function toDataUrl(input) {
    const value = input.trim();
    if (/^data:image\//i.test(value))
        return value;
    if (/^https?:\/\//i.test(value)) {
        const res = await fetch(value);
        if (!res.ok) {
            throw new Error(`Could not fetch ${value} (HTTP ${res.status})`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
        return `data:${mime};base64,${buffer.toString("base64")}`;
    }
    // A local file path. readFileSync throws a clear ENOENT when it is wrong.
    const ext = value.split(".").pop()?.toLowerCase() ?? "png";
    const mime = EXT_MIME[ext] ?? "image/png";
    return `data:${mime};base64,${readFileSync(value).toString("base64")}`;
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
    const res = await fetch(url);
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
