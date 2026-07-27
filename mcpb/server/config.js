import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from "node:fs";
const CONFIG_DIR = join(homedir(), ".techdrawai");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const DEFAULT_BASE_URL = "https://techdrawai.com";
/** What a TechDraw AI secret key looks like. Mirrors lib/api-key.ts server-side. */
export const KEY_PREFIX = "tda_sk_";
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
/** Persist the API key to ~/.techdrawai/config.json with owner-only perms. */
export function saveApiKey(apiKey) {
    if (!existsSync(CONFIG_DIR))
        mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...readFile(), apiKey }, null, 2));
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
    writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2));
    return true;
}
