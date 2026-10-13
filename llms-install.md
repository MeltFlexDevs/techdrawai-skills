# Installing the TechDraw AI MCP server (for Cline and other agents)

TechDraw AI is a **local (stdio)** MCP server distributed on npm as `techdrawai-mcp`. No build or clone is required, because it runs through `npx`.

## Prerequisites

- **Node.js 18+** (for `npx`).
- A **TechDraw AI API key** (`tda_sk_...`), which requires an active **Studio** plan. Create one at <https://techdrawai.com/app?view=settings>. Ask the user for their key. Do not invent one.

## Install (add to the MCP settings)

Add this entry to the Cline MCP settings file (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "techdrawai": {
      "command": "npx",
      "args": ["-y", "techdrawai-mcp"],
      "env": {
        "TECHDRAWAI_API_KEY": "USER_PROVIDED_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Replace `USER_PROVIDED_KEY` with the user's `tda_sk_...` key.

## Verify

Ask the server for the account's balance by calling the `check_credits` tool. It returns the plan and the per-operation costs. If it reports a missing key, the `env` block did not reach the server. If it reports that access is part of the Studio plan, the account is on the wrong tier and no amount of retrying will help.

## Tools

| Tool | Cost |
| --- | --- |
| `generate_technical_drawing` | 5 credits |
| `text_to_technical_drawing` | 5 credits |
| `image_to_dxf` | free |
| `image_to_stl` | free |
| `render_product` | 5 credits |
| `photo_to_3d` | 80 credits |
| `drawing_to_3d` | 80 credits |
| `identify_product` | free |
| `check_credits` | free |

Every tool writes its result to `./techdrawai-output/` (or `output_path`) and returns the file path. Failed generations are refunded automatically.

Full documentation: <https://techdrawai.com/mcp>
