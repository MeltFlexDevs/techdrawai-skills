# TechDraw AI for Claude Code

Model exact CAD parts, draft technical drawings and make CAD and print files from Claude Code. Everything runs on TechDraw AI's servers under your own TechDraw AI account, so there is no CAD kernel to install, no API key to copy, and nothing runs on your machine but `curl`.

## Install

```
/plugin marketplace add MeltFlexDevs/techdrawai-skills
/plugin install techdrawai@techdrawai
```

The first time Claude uses a TechDraw AI tool, Claude Code opens your browser. Sign in to TechDraw AI and select **Allow access**. You can also do this ahead of time from `/mcp` → `techdrawai` → Authenticate.

## What you can ask for

- "Model a NEMA 17 motor mount: 3 mm plate, 31 mm hole pattern, 22 mm centre bore, two slots for M5 bolts. Save the STEP here."
- "Here is `sketch.jpg` with the sizes written on it. Make it a STEP and an STL."
- "Draw `bracket.jpg` as an ISO working drawing. It is 120 mm wide. Then give me a DXF for the laser."
- "Turn `logo.png` into a 4 mm thick STL, 80 mm across."

## Skills

| Skill | Covers |
| --- | --- |
| `/techdrawai:cad-part` | `text_to_cad`: an exact part as STEP and STL, from a description, a dimensioned sketch or a photo, and follow-up changes to it |
| `/techdrawai:drafting` | A dimensioned technical drawing from a photo or a description: standard, projection, sheet and the one measurement that sets the scale |
| `/techdrawai:cad` | DXF and DWG at true size, printable STL from artwork, and textured 3D models from a photo or a drawing |

Claude picks the right skill from your request. The slash commands are there if you want one explicitly.

## Tools and costs

| Tool | What it does | Credits |
| --- | --- | --- |
| `text_to_cad` | Description, sketch or photo → exact CAD part (STEP + STL) | 80, Studio plan |
| `generate_technical_drawing` | Photo → dimensioned technical drawing | 5 |
| `text_to_technical_drawing` | Description → dimensioned technical drawing | 5 |
| `image_to_dxf` | Image → DXF and DWG contours | free |
| `image_to_stl` | Flat artwork → printable STL | free |
| `photo_to_3d` | Photo → textured 3D model (GLB + STL) | 80, Studio plan |
| `drawing_to_3d` | Technical drawing → textured 3D model | 80, Studio plan |
| `check_job` | Progress and files of a 3D or CAD job | free |
| `identify_product` | Name the object in a photo | free |
| `get_credits` | Balance, plan and costs | free |
| `upload_file` | Upload link for a local image (used with `curl`) | free |

Generations that fail, or build nothing, are refunded automatically. Plans: <https://techdrawai.com/app/subscription>.

## Privacy

The plugin talks only to `techdrawai.com`. Images you upload and the files TechDraw AI makes are stored in your TechDraw AI account. A CAD part also appears in your AI CAD projects at <https://techdrawai.com/app/ai-cad>. To disconnect, remove the server's authentication in `/mcp`, or uninstall the plugin.

Server documentation: <https://techdrawai.com/mcp>.
