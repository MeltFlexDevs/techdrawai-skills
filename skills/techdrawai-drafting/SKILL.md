---
name: techdrawai-drafting
description: Draft real technical drawings from photographs, or from a written description of a part, with TechDraw AI. Use when the user wants an engineering, working, production or shop drawing; an assembly drawing with a parts list; an as-built or as-fitted record; a patent figure; orthographic views of a part; a dimensioned drawing of something they photographed; or a drawing they can hand to a machinist, a fabricator or a manufacturer.
---

# TechDraw AI: drafting from a photograph or a description

Turns a photograph of a physical object, or a sentence describing a part and its sizes, into a dimensioned, standards-compliant 2D technical drawing. For DXF and DWG export, 3D reconstruction and product renders, use the `techdrawai-cad` skill on whatever this one writes.

## Setup (once)

```bash
npx -y techdrawai-mcp auth login      # browser sign-in, no key to copy
```

Requires an active **Studio** plan. If a tool reports a plan error, say so plainly and point at <https://techdrawai.com/app?view=subscription> rather than retrying. Keys can also be created in Settings and passed as `TECHDRAWAI_API_KEY`.

## Tools

### `generate_technical_drawing`
Photo to dimensioned technical drawing. **5 credits.**

- `image` (required): the photo, as a local file path, an http(s) URL or a data URL.
- `product_name`: what the object is. Improves the title block and, when dimensions are estimated, the estimates themselves. Run `identify_product` first if you do not know.
- `measurements`: dimensions the user actually measured, each `{ value, unit?, orientation?, position? }`. **The single biggest quality lever.** See below.
- `estimate_dimensions`: let the model infer sizes. Defaults to true when no measurements are given.
- `units`: `mm` (default), `cm`, `m`, `in`.
- `standard`: `ISO` (default) or `ANSI`.
- `paper_size`: `A4` to `A0` for ISO (default `A3`), `ANSI A` to `ANSI E` for ANSI (default `ANSI B`).
- `projection`: `first-angle` (default, ISO and Europe) or `third-angle` (ANSI and North America).
- `drawing_type`: `working` (default, fully dimensioned production drawing), `assembly` (numbered balloons plus a parts list), `as-fitted` (a record of the item as built), `patent` (numbered figure, no dimensions).
- `views`: any of `front`, `top`, `side`, `isometric`. Defaults to front, top and side.
- `notes`: material, finish, tolerances, anything else to state on the sheet.
- `output_path`: defaults to `./techdrawai-output/drawing-<timestamp>.png`.

### `text_to_technical_drawing`
A written description to a dimensioned technical drawing, no photo. **5 credits**, about 30 to 60 seconds.

- `prompt` (required, up to 1,000 characters): what the part is and every size the user gave, in one sentence. "Steel L bracket, legs 80 and 60 mm, 40 wide, 5 thick, two 8.5 mm holes in each leg."
- `standard`, `projection`, `paper_size` (`A4` to `A1`, ANSI always draws for ANSI B), `units` (`mm` or `in`, read from the prompt when omitted), `output_path`.

### `identify_product`
Names the main object in a photo in two or three words. **Free.** Cheap groundwork: an agent that knows it is looking at a "cast-iron wall bracket" writes a much better title block and estimates far better dimensions than one working from "product".

### `check_credits`
Balance, plan and per-operation costs. Worth calling before a batch.

## One measurement changes everything

This is the difference between a picture of a drawing and a drawing someone can manufacture from.

- **With no measurements**, the model infers realistic sizes from the photo and its proportions, and the sheet marks the values as nominal. Fine for a concept, not for a workshop.
- **With one real measurement**, every other feature is scaled proportionally from it and the whole drawing becomes internally consistent.

So if the user has not given one, ask:

> "Do you have one real measurement of it, say the overall width or the height? Everything else gets scaled from that."

Pass what they say as a measurement, with `position` describing where it was taken ("overall width", "seat height", "bore diameter"). That wording is not decoration; it tells the drafter which edge the number belongs to.

If they genuinely have none, go ahead with `estimate_dimensions` and tell them plainly that the dimensions are nominal and should be checked before anything is cut.

## How to work with the user

1. **Photo or description, pick by what exists.** An object on the bench: ask for a photo and use `generate_technical_drawing`. A part that does not exist yet, or one easier to describe than to photograph: `text_to_technical_drawing`. Collect every size the user mentioned, across all their messages, into that one prompt: stated numbers are drawn as given, anything left out is estimated and the sheet says `UNSTATED DIMENSIONS NOMINAL`. If a size that matters is missing, ask before spending the credits.
   The text drawing is the views and dimensions only, no title block, and a picture rather than CAD geometry: its lines are not to exact scale, and the view arrangement occasionally disagrees with the projection symbol. Check that before saying it is ready for a shop.
2. **Pick the drawing type from what they said.** "For the workshop" or "to get it made" is `working`. "How it goes together" is `assembly`. "For a patent application" is `patent`. "A record of what we built" is `as-fitted`.
3. **Match the standard to the audience.** Europe and most of the world use ISO with first-angle projection. North America uses ANSI with third-angle. When unsure, ask which they use. Get it wrong and the projection symbol on the sheet is actively misleading.
4. **Sheet size follows the part.** A small machined part is fine on A4. A cabinet, or an assembly with a parts list, wants A3 or A2, or the dimensions crowd each other.
5. **Always offer the DXF.** A PNG is a picture of a drawing. The DXF is the drawing. Hand the result to `image_to_dxf` with `width_mm` set from the measurement they gave.
6. **Report the saved path and the credits used**, then offer to iterate: a different sheet size, an extra view, notes on the material.
7. **Failures are refunded automatically.** If a generation fails, say so and say the credits came back.
8. **Out of credits?** The error says so. Report the balance and point at <https://techdrawai.com/app?view=subscription>.

## Example

> User: "Here is a bracket I need made, `/Users/me/bracket.jpg`. It is 120 mm across. I need a DXF for the laser cutter."

1. `identify_product` with `image: "/Users/me/bracket.jpg"`, giving "steel wall bracket".
2. `generate_technical_drawing` with
   - `image`: `/Users/me/bracket.jpg`
   - `product_name`: `steel wall bracket`
   - `measurements`: `[{ value: "120", unit: "mm", orientation: "horizontal", position: "overall width" }]`
   - `drawing_type`: `working`, `standard`: `ISO`, `paper_size`: `A3`, `views`: `["front", "top", "side"]`
3. Hand the file it wrote to `image_to_dxf` with `width_mm: 120` and `dwg: true` (see the `techdrawai-cad` skill).
4. Report both paths, the 5 credits used, and that the DXF is at true size for the cutter.
