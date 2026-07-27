# Install

Two separate things live in this repo, and you can take either or both.

- **Skills** are Markdown files that teach an agent how to use TechDraw AI well: when to ask for a measurement, which drafting standard suits which audience, when a DXF beats a PNG. They carry the judgement the tool schemas cannot.
- **The MCP server** is the actual command channel, published on npm as [`techdrawai-mcp`](https://www.npmjs.com/package/techdrawai-mcp). It gives the agent six tools.

Most people want both. The skills alone still work: they teach the agent to drive the CLI or the REST API instead.

## Skills

### `npx skills` (recommended, cross-agent)

```bash
npx skills add MeltFlexDevs/techdrawai-skills
```

Detects your agent and installs into the right place.

### GitHub CLI (v2.90+)

```bash
gh skill install MeltFlexDevs/techdrawai-skills
```

### Claude Code marketplace

```
/plugin marketplace add MeltFlexDevs/techdrawai-skills
/plugin install techdrawai@techdrawai
```

Then `/techdrawai:drafting` or `/techdrawai:cad`.

### By hand

Copy the skill folders into wherever your agent reads skills from:

```bash
git clone --depth 1 https://github.com/MeltFlexDevs/techdrawai-skills.git
cp -r techdrawai-skills/skills/* ~/.claude/skills/          # Claude Code
```

## MCP server

### Claude Code

```bash
claude mcp add techdrawai -- npx -y techdrawai-mcp
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "techdrawai": {
      "command": "npx",
      "args": ["-y", "techdrawai-mcp"],
      "env": { "TECHDRAWAI_API_KEY": "tda_sk_..." }
    }
  }
}
```

### Claude Desktop

Settings, Developer, Edit Config, then the same block in `claude_desktop_config.json`. Restart the app afterwards.

You can also install the packaged extension: build it with `npx @anthropic-ai/mcpb pack mcpb` and double-click the resulting `.mcpb`, which prompts for the API key rather than making you edit JSON.

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.techdrawai]
command = "npx"
args = ["-y", "techdrawai-mcp"]
env = { TECHDRAWAI_API_KEY = "tda_sk_..." }
```

### VS Code

`.vscode/mcp.json` in your workspace. Note the `servers` key rather than `mcpServers`:

```json
{
  "servers": {
    "techdrawai": {
      "command": "npx",
      "args": ["-y", "techdrawai-mcp"],
      "env": { "TECHDRAWAI_API_KEY": "tda_sk_..." }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same shape as Cursor. Then Cascade panel, MCP servers, Refresh.

### Cline and other agents

See [llms-install.md](./llms-install.md), written to be handed straight to the agent.

## Authenticate

Programmatic access is part of the **Studio** plan.

```bash
npx -y techdrawai-mcp auth login
```

That opens your browser, mints a key from your signed-in session and hands it back to the terminal over the loopback interface. Nothing is copied or pasted, so the key never reaches your shell history. It is stored at `~/.techdrawai/config.json` with owner-only permissions.

If you would rather manage it yourself, create a key at [techdrawai.com/app](https://techdrawai.com/app?view=settings) under Settings, API keys, and set `TECHDRAWAI_API_KEY`. An environment variable always beats the stored config, which is how CI jobs and containers avoid an interactive login.

Check it worked:

```bash
npx -y techdrawai-mcp whoami
npx -y techdrawai-mcp credits
```

## Troubleshooting

**"No TechDraw AI API key configured"**: run `techdrawai auth login`, or check the `env` block in your client config.

**"API, CLI and MCP access is part of the Studio plan"**: the account is on Starter or the free tier. Programmatic access is Studio only.

**The server does not appear in the client**: each client reads a different file with a slightly different key. VS Code wants `servers`, everyone else wants `mcpServers`, and Codex wants TOML. Check you edited the right one. The server writes its diagnostics to stderr, which most clients surface under the server's logs.

**`npx` cannot find the package**: you need Node 18 or newer. Check with `node -v`.
