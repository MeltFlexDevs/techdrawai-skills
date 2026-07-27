# Notes for agents working in this repository

This repository distributes the TechDraw AI skills and the packaging around them. It is not the MCP server's source; that lives in the TechDraw AI application repository and ships to npm as `techdrawai-mcp`.

## Layout

- `skills/techdrawai-drafting/SKILL.md`: photo to dimensioned technical drawing
- `skills/techdrawai-cad/SKILL.md`: DXF, DWG, 3D reconstruction, product renders
- `.claude-plugin/`: Claude Code plugin and marketplace manifests
- `mcpb/`: Claude Desktop extension manifest plus a compiled copy of the server
- `server.json`: MCP registry entry

## Rules

- **Version numbers move together.** `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `mcpb/manifest.json` and `server.json` all carry one. Change one, change all of them.
- **Do not edit `mcpb/server/*.js` by hand.** It is build output, copied from the npm package. Fix the TypeScript source instead and recopy.
- **Credit costs appear in several files.** They are enforced server-side in the application. If a cost changes there, update the README table, both skills and `mcpb/manifest.json`.
- **The skills carry judgement, not schemas.** Do not turn a SKILL.md into a parameter list. That is what the tool definitions and <https://techdrawai.com/api> are for.
