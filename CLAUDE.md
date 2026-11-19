# Notes for agents working in this repository

This repository distributes the TechDraw AI skills and the packaging around them. It is not the MCP server's source; that lives in the TechDraw AI application repository and ships to npm as `techdrawai-mcp`.

## Layout

- `skills/techdrawai-drafting/SKILL.md`: photo to dimensioned technical drawing
- `skills/techdrawai-cad/SKILL.md`: DXF, DWG, 3D reconstruction, product renders
- `.claude-plugin/marketplace.json`: the Claude Code marketplace; it lists one plugin, `plugins/techdrawai`
- `plugins/techdrawai/`: the Claude Code plugin. Its `.mcp.json` points at the hosted server `https://techdrawai.com/api/mcp/code` (OAuth, no API key), and its skills are written for that server's tools (image URLs, `upload_file`, `text_to_cad`, `check_job`), not the npm server's file paths. The root `skills/` are for every other agent and the npm server.
- `mcpb/`: Claude Desktop extension manifest plus a compiled copy of the server
- `server.json`: MCP registry entry

## Rules

- **Version numbers move together, in two groups.** The npm server's: `VERSION`, `mcpb/manifest.json` and `server.json`. The Claude Code plugin's: `plugins/techdrawai/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`. Change one in a group, change the group.
- **Validate the plugin before pushing:** `claude plugin validate .claude-plugin/marketplace.json` and `claude plugin validate plugins/techdrawai --profile directory --strict`.
- **Do not edit `mcpb/server/*.js` by hand.** It is build output, copied from the npm package's `dist/`. Fix the TypeScript source instead and recopy. The one change the copy needs: `server.js` reads its version from `../package.json`, which is the npm package root there but does not exist here, so point it at `./package.json` (`mcpb/server/package.json`, whose version moves with the others).
- **Credit costs appear in several files.** They are enforced server-side in the application. If a cost changes there, update the README table, both skills and `mcpb/manifest.json`.
- **The skills carry judgement, not schemas.** Do not turn a SKILL.md into a parameter list. That is what the tool definitions and <https://techdrawai.com/api> are for.
