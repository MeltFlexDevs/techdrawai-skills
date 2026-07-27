import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { KEY_PREFIX } from "./config.js";
/**
 * Browser-based login over the loopback interface, the same shape as
 * `gh auth login`:
 *
 *   1. Start a throwaway HTTP server on 127.0.0.1:<random port>.
 *   2. Open the browser to <baseUrl>/cli/authorize?port=…&state=…
 *   3. That page signs the user in, mints a `tda_sk_` key from their session,
 *      and redirects the browser to
 *      http://127.0.0.1:<port>/callback?key=…&state=…
 *   4. We verify `state`, capture the key, and return it.
 *
 * The key only ever travels over loopback on this machine. `state` is what
 * stops another local process from posting a key of its own choosing into our
 * listener while we wait.
 */
export async function loginViaBrowser(baseUrl, timeoutMs = 3 * 60 * 1000) {
    const state = randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn) => {
            if (settled)
                return;
            settled = true;
            fn();
        };
        const server = createServer((req, res) => {
            const url = new URL(req.url || "/", "http://127.0.0.1");
            if (url.pathname !== "/callback") {
                res.writeHead(404).end("Not found");
                return;
            }
            const key = url.searchParams.get("key") ?? "";
            const returnedState = url.searchParams.get("state") ?? "";
            const error = url.searchParams.get("error");
            const finish = (ok, message) => {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(resultPage(ok, message));
                // Give the browser a beat to render before tearing the socket down.
                setTimeout(() => server.close(), 250);
            };
            if (error) {
                finish(false, error);
                done(() => reject(new Error(`Authorization failed: ${error}`)));
                return;
            }
            if (returnedState !== state) {
                finish(false, "State mismatch — possible CSRF. Please try again.");
                done(() => reject(new Error("State mismatch during login.")));
                return;
            }
            if (!key.startsWith(KEY_PREFIX)) {
                finish(false, "No valid API key was returned.");
                done(() => reject(new Error("No valid API key returned from the authorize page.")));
                return;
            }
            finish(true, "You are signed in to the TechDraw AI CLI. You can close this tab.");
            done(() => resolve(key));
        });
        server.on("error", (err) => done(() => reject(err)));
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            const authorizeUrl = `${baseUrl.replace(/\/$/, "")}/cli/authorize?port=${port}&state=${state}`;
            // stdout is the MCP JSON-RPC channel — never write anything but protocol
            // there. Human-facing lines always go to stderr.
            console.error("Opening your browser to sign in…");
            console.error(`If it doesn't open, visit:\n  ${authorizeUrl}\n`);
            openBrowser(authorizeUrl);
            const timer = setTimeout(() => {
                server.close();
                done(() => reject(new Error("Login timed out. Run `techdrawai auth login` again.")));
            }, timeoutMs);
            server.on("close", () => clearTimeout(timer));
        });
    });
}
/** Best-effort cross-platform "open this URL in the default browser". */
function openBrowser(url) {
    const command = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "cmd"
            : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", '""', url] : [url];
    try {
        spawn(command, args, { stdio: "ignore", detached: true }).unref();
    }
    catch {
        // Fall back to the URL we already printed.
    }
}
function resultPage(ok, message) {
    const color = ok ? "#16a34a" : "#dc2626";
    const title = ok ? "Authorized" : "Authorization failed";
    const safe = message.replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;");
    return `<!doctype html><html><head><meta charset="utf-8"><title>TechDraw AI CLI</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0c;color:#e5e5e5;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:40px 48px;background:#161617;border-radius:16px;max-width:420px}
h1{color:${color};font-size:20px;margin:0 0 12px}p{color:#a1a1aa;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${safe}</p></div></body></html>`;
}
