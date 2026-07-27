# Cookbook

Worked examples. Everything here is a real sequence of tool calls or CLI commands, not pseudocode.

## Photo to a laser-ready DXF

The one most people want first.

> "Here is a bracket, `~/photos/bracket.jpg`. It is 120 mm across. I need a DXF for the laser cutter."

```
[identify_product]  image: ~/photos/bracket.jpg
→ "steel wall bracket"

[generate_technical_drawing]
  image: ~/photos/bracket.jpg
  product_name: "steel wall bracket"
  measurements: [{ value: "120", unit: "mm", position: "overall width" }]
  standard: ISO · paper_size: A3 · drawing_type: working
→ ./techdrawai-output/drawing-2026-07-27_15-04-11.png    3 credits

[image_to_dxf]
  image: ./techdrawai-output/drawing-2026-07-27_15-04-11.png
  width_mm: 120
  dwg: true
→ .dxf and .dwg, 34 contours, free
```

The `width_mm` is the step people skip. Without it the geometry lands at one unit per pixel and has to be rescaled by hand in CAD.

Same thing from the shell:

```bash
techdrawai draw -i bracket.jpg --name "steel wall bracket" \
  --measure 120:"overall width" --paper A3 --out out/bracket.png
techdrawai dxf -i out/bracket.png --width-mm 120 --dwg
```

## A folder of parts, documented in one pass

```bash
#!/usr/bin/env bash
set -euo pipefail

for photo in photos/*.jpg; do
  base=$(basename "$photo" .jpg)

  # Free, and it makes the title block and the estimates far better.
  name=$(techdrawai identify -i "$photo")

  techdrawai draw -i "$photo" --name "$name" \
    --paper A3 --type working --out "out/$base.png"

  techdrawai dxf -i "out/$base.png" --width-mm 120 --out "out/$base.dxf"

  echo "$base → $name"
done
```

At 3 credits a drawing, a folder of 40 parts is 120 credits, which is a Starter month. Call `check_credits` first if the folder is large.

## An assembly drawing with a parts list

```
[generate_technical_drawing]
  image: ~/photos/gearbox.jpg
  product_name: "two-stage gearbox"
  drawing_type: assembly
  standard: ANSI
  projection: third-angle
  paper_size: "ANSI B"
  views: ["front", "top", "isometric"]
```

`assembly` adds numbered balloons and a bill of materials keyed to them. Give it a sheet with room; a parts list on A4 crowds everything.

## A patent figure

```
[generate_technical_drawing]
  image: ~/photos/mechanism.jpg
  drawing_type: patent
  views: ["front", "isometric"]
  notes: "Label the pivot, the spring and the release catch."
```

Patent style means black line work only, reference numerals with leader lines, a figure number, and no dimensions at all. Do not also ask for dimensions; the two conventions contradict each other.

## Drawing to product shot

Useful for a catalogue, a quote or a pitch deck, from a drawing you already have.

```
[render_product]
  image: ./out/bracket.png
  style: studio
  background: white
  material: "brushed aluminium, matte black fasteners"
```

The geometry is reconstructed from the views, so the render follows the drawing rather than inventing a new object.

## Photo to a printable 3D model

```
[photo_to_3d]
  image: ~/photos/knob.jpg
  detail: high
  textured: false
```

Turn textures off when the user only wants geometry to print or to check clearance. It takes one to three minutes and blocks until it is done, so say it is running. The photo has to show **one** object; a cluttered bench reconstructs the clutter.

## A trace that comes back empty

`image_to_dxf` returning `no_contours`, or one enormous blob, means the ink and paper cut-off is wrong for that image.

```
threshold: 150        # try 100 to 180 for photographs
invert: true          # white lines on a dark background
smoothing: 2          # noisy scan, cleaner contour
```

A plain black-on-white drawing traces best. A photograph of a part traces its silhouette, which is often what you want for a flat profile and never what you want for a dimensioned drawing.

## Checking the balance before a batch

```bash
techdrawai credits
```

```
TechDraw AI (you@example.com)
Plan: studio
Balance: 747 credits
Cost per operation:
  • drawing: 3 credits
  • render: 3 credits
  • model-3d: 3 credits
  • dxf: free
  • dwg: free
  • identify: free
```

## In CI

With the key in the environment there is no interactive step:

```yaml
- name: Generate drawings for new parts
  env:
    TECHDRAWAI_API_KEY: ${{ secrets.TECHDRAWAI_API_KEY }}
  run: |
    npx -y techdrawai-mcp draw -i parts/new-bracket.jpg \
      --measure 120:"overall width" --out artifacts/bracket.png
    npx -y techdrawai-mcp dxf -i artifacts/bracket.png \
      --width-mm 120 --out artifacts/bracket.dxf
```

Exit codes: `0` success, `2` out of credits or the wrong plan, `1` everything else.
