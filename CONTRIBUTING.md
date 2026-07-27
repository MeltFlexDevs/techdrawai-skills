# Contributing

## What lives here

| Path | What it is |
| --- | --- |
| `skills/` | The agent skills. Markdown with YAML frontmatter. |
| `.claude-plugin/` | Claude Code plugin and marketplace manifests. |
| `mcpb/` | The Claude Desktop extension: a manifest plus a self-contained copy of the built server. |
| `server.json` | The MCP registry entry. |
| `setup` | Universal install script. |

The MCP server's TypeScript source is in the TechDraw AI application repository and published to npm as `techdrawai-mcp`. `mcpb/server/` holds the compiled output so the desktop extension is self-contained; it is regenerated from that source rather than edited here.

## Editing a skill

A skill is judgement, not a reference manual. The tool schemas already say what the parameters are. The skill says which one matters and when: ask for a real measurement, use ISO with first-angle for Europe, always offer the DXF because a PNG is a picture of a drawing.

Keep the frontmatter `description` broad enough that an agent recognises the situation from how a person would actually phrase it, including the words they use rather than the words we use.

## Releasing

1. Bump `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `mcpb/manifest.json` and `server.json` together. They are separate files describing one thing, and a mismatch is confusing rather than harmless.
2. Refresh `mcpb/server/` from the built package if the server changed.
3. Tag the release.

## Reporting a problem

Open an issue with the client you are using, the exact config block, and whatever the server wrote to stderr. Most reports turn out to be a config in the wrong file or under the wrong key, and the stderr line says which.
