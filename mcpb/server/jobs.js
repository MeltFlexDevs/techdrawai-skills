import { join, isAbsolute } from "node:path";
import { OUTPUT_DIR, downloadToFile, timestamp } from "./util.js";
/**
 * 3D and CAD jobs: started by one call, finished minutes later. The MCP tools
 * return the job id and let the agent poll check_job (a chat will not hold one
 * tool call open for eight minutes); the CLI waits here with `waitForJob`.
 */
/** The order files are listed and downloaded in: the editable format first. */
const FILE_ORDER = ["step", "stl", "3mf", "glb", "obj", "fbx", "usdz"];
/**
 * Download every file of a finished job into `dir` (default
 * ./techdrawai-output), named `<prefix>-<timestamp>.<ext>`. Returns the paths,
 * by format. A file that fails to download is reported, not fatal: the links
 * are permanent, so it can be fetched again.
 */
export async function saveJobFiles(job, dir, prefix) {
    const base = dir && dir.trim() ? (isAbsolute(dir.trim()) ? dir.trim() : join(process.cwd(), dir.trim())) : join(process.cwd(), OUTPUT_DIR);
    const stamp = timestamp();
    const saved = {};
    const failed = {};
    const files = Object.entries(job.files ?? {}).sort(([a], [b]) => FILE_ORDER.indexOf(a) - FILE_ORDER.indexOf(b));
    for (const [format, url] of files) {
        try {
            saved[format] = await downloadToFile(url, join(base, `${prefix}-${stamp}.${format}`), prefix, format);
        }
        catch (err) {
            failed[format] = err instanceof Error ? err.message : String(err);
        }
    }
    return { saved, failed };
}
/** One line per downloaded file, for a tool reply or the terminal. */
export function describeSaved(result, job) {
    const lines = Object.entries(result.saved).map(([format, path]) => `  • ${format.toUpperCase()}: ${path}`);
    const failed = Object.entries(result.failed).map(([format, why]) => `  • ${format.toUpperCase()} not saved (${why}); link: ${job.files?.[format]}`);
    return [...lines, ...failed].join("\n");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Poll a job until it leaves "running". AI CAD parts take two to eight minutes
 * and a Meshy model one to five (its queue has held tasks far longer), so the
 * ceiling is generous; the server refunds a job that never finishes either way.
 */
export async function waitForJob(client, jobId, opts = {}) {
    const interval = opts.intervalMs ?? 15_000;
    const deadline = Date.now() + (opts.timeoutMs ?? 65 * 60_000);
    for (;;) {
        let job = null;
        try {
            job = await client.job(jobId);
        }
        catch (err) {
            // A dropped poll is not a failed job; give up only at the deadline.
            if (Date.now() > deadline)
                throw err;
        }
        if (job) {
            opts.onTick?.(job);
            if (job.status !== "running")
                return job;
        }
        if (Date.now() > deadline) {
            throw new Error(`Job ${jobId} is still running. Check it later with \`techdrawai job ${jobId}\`.`);
        }
        await sleep(interval);
    }
}
