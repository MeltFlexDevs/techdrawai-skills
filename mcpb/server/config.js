import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from "node:fs";
const CONFIG_DIR = join(homedir(), ".techdrawai");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const DEFAULT_BASE_URL = "https://techdrawai.com";
/** What a TechDraw AI secret key looks like. Mirrors lib/api-key.ts server-side. */
export const KEY_PREFIX = "tda_sk_";
/**
 * What the generators cost, for the tool descriptions and the help text.
 *
 * Mirrors API_CREDIT_COSTS in the web app (lib/api-constants.ts), which is the
 * authority: the server charges its own number whatever this says. These exist
 * because an MCP tool description and `--help` have to carry a figure before any
 * request is made, and `check_credits` / `techdrawai credits` report the live
 * costs straight from the server for anything that has to be exact.
 *
 * A mesh costs many times a drawing because a reconstruction runs for minutes
 * on a GPU while a drawing is one pass through an image model.
 */
export const DRAWING_COST = 5;
export const MODEL_3D_COST = 80;
function readFile() {
    if (!existsSync(CONFIG_PATH))
        return {};
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    }
    catch {
        // A corrupt config should not stop an env-configured run.
        return {};
    }
}
/**
 * Resolve configuration. Environment variables win over the on-disk file so a
 * hosted or CI setup — an `env` block in an MCP client's config, a container,
 * a GitHub Action — works without an interactive `techdrawai auth login`.
 */
export function loadConfig() {
    const file = readFile();
    return {
        apiKey: process.env.TECHDRAWAI_API_KEY || file.apiKey,
        baseUrl: process.env.TECHDRAWAI_BASE_URL || file.baseUrl || DEFAULT_BASE_URL,
    };
}
/**
 * Persist the API key to ~/.techdrawai/config.json with owner-only perms.
 *
 * The mode is passed to the write rather than applied afterwards: chmod-ing a
 * file that already exists on disk leaves a window, however brief, where a
 * secret sits there readable by every account on the machine. `mode` only
 * applies when the file is created, so the chmod stays for the case where the
 * config was already there.
 */
export function saveApiKey(apiKey) {
    if (!existsSync(CONFIG_DIR))
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...readFile(), apiKey }, null, 2), {
        mode: 0o600,
    });
    try {
        chmodSync(CONFIG_PATH, 0o600);
    }
    catch {
        // Best-effort on platforms without POSIX permissions.
    }
    return CONFIG_PATH;
}
/** Forget the stored key. Returns false when there was nothing to forget. */
export function clearApiKey() {
    const file = readFile();
    if (!file.apiKey)
        return false;
    delete file.apiKey;
    writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
    return true;
}
