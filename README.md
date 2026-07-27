# TechDraw AI Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-3b82f6.svg)](./VERSION)
[![Skills](https://img.shields.io/badge/skills-2-8b5cf6.svg)](#skills)
[![npm](https://img.shields.io/badge/npm-techdrawai--mcp-cb3837.svg)](https://www.npmjs.com/package/techdrawai-mcp)
[![Website](https://img.shields.io/badge/techdrawai.com-f97316.svg)](https://techdrawai.com)

AI agent skills for **turning a photograph of a physical part into engineering documentation** with TechDraw AI. Draft a dimensioned 2D technical drawing, trace it into CAD-ready DXF and DWG, reconstruct the part as a 3D mesh, or render it as a finished product shot. Works with Claude Code, Claude Desktop, Cursor, Codex, VS Code, Windsurf and anything else that loads Markdown skills or speaks MCP.

Each user authenticates with their **own** TechDraw AI API key, and every generation is billed to their account credits. The skills call the public [TechDraw AI API](https://techdrawai.com/api) directly, so there is nothing extra to install and no CAD kernel to build.

<p align="center">
  <img src="https://techdrawai.com/app/pairs/valve-photo.webp" width="30%" alt="Photograph of an industrial brass ball valve" />
  <img src="https://techdrawai.com/app/pairs/valve-drawing.webp" width="30%" alt="Dimensioned technical drawing of the same valve" />
  <img src="https://techdrawai.com/app/pairs/valve-cad.webp" width="30%" alt="Shaded 3D CAD model of the same valve" />
</p>

<p align="center"><sub>One photograph, three outputs: a dimensioned drawing, CAD geometry, and a 3D model.</sub></p>

## Install

Pick one. Each method sets the skills up for your agent.

### `npx skills` (recommended, cross-agent)

```bash
npx skills add MeltFlexDevs/techdrawai-skills
```

### GitHub CLI (v2.90+)

```bash
gh skill install MeltFlexDevs/techdrawai-skills
```

### Claude Code marketplace

Inside Claude Code:

```
/plugin marketplace add MeltFlexDevs/techdrawai-skills
/plugin install techdrawai@techdrawai
```

### MCP server only

If you want the tools without the skills, add the MCP server directly:

```bash
claude mcp add techdrawai -- npx -y techdrawai-mcp
```

Configuration for Cursor, Claude Desktop, Codex, VS Code and Windsurf is on the [MCP page](https://techdrawai.com/mcp).

### Setup script

Universal fallback:

```bash
git clone --depth 1 https://github.com/MeltFlexDevs/techdrawai-skills.git
cd techdrawai-skills
./setup
```

More options in [INSTALL.md](./INSTALL.md). Agent-driven install, to paste into your agent: [INSTALL_FOR_AGENTS.md](./INSTALL_FOR_AGENTS.md).

## Authenticate

Programmatic access is part of the **Studio** plan. Once you are subscribed, the simplest way to sign in is the browser flow, which mints a key from your session and hands it back over loopback so you never copy or paste a secret:

```bash
npx -y techdrawai-mcp auth login
```

Or create one by hand at **[techdrawai.com/app](https://techdrawai.com/app?view=settings) → Settings → API keys** and export it:

```bash
export TECHDRAWAI_API_KEY="tda_sk_..."
```

The key is shown exactly once at creation. Only its SHA-256 is stored, so nobody can recover it afterwards, including us. An account may hold five live keys and revoking one takes effect on the next request.

## Skills

| Skill | Invoke | What it covers |
| --- | --- | --- |
| [`techdrawai-drafting`](./skills/techdrawai-drafting/SKILL.md) | `/techdrawai:drafting` | Photo to dimensioned technical drawing. Drafting standard, sheet size, projection angle, drawing type, views, and the measurements that anchor the scale. |
| [`techdrawai-cad`](./skills/techdrawai-cad/SKILL.md) | `/techdrawai:cad` | Everything downstream of the drawing: DXF and DWG at true size, 3D reconstruction, and product renders. |

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `generate_technical_drawing` | Photo to a dimensioned, standards-compliant technical drawing | 3 credits |
| `image_to_dxf` | Any image to real CAD contours as DXF, optionally DWG | Free |
| `render_product` | Technical drawing to a photorealistic product render | 3 credits |
| `photo_to_3d` | Photo to a textured 3D mesh, GLB plus FBX, OBJ, USDZ, STL | 3 credits |
| `identify_product` | Name the object in a photo | Free |
| `check_credits` | Balance, plan, and what each operation costs | Free |

Failed generations are refunded automatically, so an agent that retries a bad prompt does not quietly drain the balance.

Every tool writes its result to disk (`./techdrawai-output/` unless you pass `output_path`) and returns the path rather than the bytes. A technical drawing is a megabyte-scale image, and pushing that through the protocol would burn the agent's context on something it usually just hands to the next tool.

## What it looks like in practice

> **You:** Here is a bracket, `~/photos/bracket.jpg`. It is 120 mm across. I need a DXF for the laser cutter.

```
[identify_product]  → "steel wall bracket"

[generate_technical_drawing]
  product_name: "steel wall bracket"
  measurements: [{ value: "120", unit: "mm", position: "overall width" }]
  standard: ISO · paper_size: A3 · drawing_type: working
→ ./techdrawai-output/drawing-2026-07-27_15-04-11.png   3 credits

[image_to_dxf]  width_mm: 120
→ ./techdrawai-output/drawing-2026-07-27_15-04-11.dxf   34 contours, free
```

The DXF arrives at true size, so it goes straight to the cutter without rescaling. More patterns in [COOKBOOK.md](./COOKBOOK.md).

## One measurement changes everything

Without a real measurement the dimensions are the model's best estimate and are marked nominal. With even one, every other feature is scaled proportionally from it and the whole drawing becomes internally consistent and manufacturable. If a user has not given one, ask for it. It is the single biggest quality lever in the whole workflow.

## The CLI

The same package is a command-line tool when you run it with arguments instead of letting an agent speak MCP to it:

```bash
techdrawai draw -i bracket.jpg --measure 120:"overall width" --paper A3
techdrawai dxf  -i drawing.png --width-mm 120 --dwg
techdrawai model3d -i bracket.jpg --detail high
```

Full reference at [techdrawai.com/cli](https://techdrawai.com/cli).

## Documentation

- [API reference](https://techdrawai.com/api): every endpoint, request and response
- [CLI](https://techdrawai.com/cli): every command and flag
- [MCP](https://techdrawai.com/mcp): client-by-client setup
- [COOKBOOK.md](./COOKBOOK.md): worked examples
- [CONTRIBUTING.md](./CONTRIBUTING.md)

## Licence

MIT. See [LICENSE](./LICENSE).
