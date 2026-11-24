---
name: cad
description: Turn drawings, sketches, logos and photos into CAD and print files with TechDraw AI. Use when the user wants a DXF or DWG for CAD, CNC, laser or plasma cutting, or to import into Fusion 360, SolidWorks, Onshape, FreeCAD, AutoCAD, Rhino or LightBurn. Also use when they want a printable STL from flat artwork, or a textured 3D model (GLB) reconstructed from a photo or a drawing.
---

# TechDraw AI: DXF, DWG, STL and 3D models

These tools work on what is already drawn or photographed. For a drawing, use the `drafting` skill first. For an exact part modelled from sizes, use the `cad-part` skill (`text_to_cad`).

Inputs are image URLs. A local file goes in through `upload_file` and its curl command where there is a shell, or through `upload_photo`'s file picker in a chat, as the other skills describe. Any earlier TechDraw AI result can be passed straight on.

## The tools

- **`image_to_dxf`** (free) traces an image into real CAD contours, as a DXF plus a DWG.
  - **Pass `width_mm` whenever the real size is known.** Without it, the geometry arrives at one unit per pixel, and the user has to rescale it by hand.
  - A DXF is sketch geometry, not a solid. In CAD it is imported as a sketch and then extruded or revolved. Say so.
- **`image_to_stl`** (free) extrudes flat artwork into a watertight STL: a logo, a sign, a stencil or line art.
  - `size_mm` sets the longest side and `thickness_mm` sets the height.
  - A photo of an object comes out as its outline in relief, not as the object.
- **`photo_to_3d`** (80 credits, Studio plan) reconstructs a textured mesh (GLB plus STL) from a photo of **one** object.
  - A cluttered photo reconstructs the clutter. Ask for a clean shot against a plain background.
  - It follows the photo's shape and colours, not exact dimensions: right for furniture, products and AR, wrong for a part to machine.
- **`drawing_to_3d`** (80 credits, Studio plan) models the part a technical drawing or dimensioned sketch describes as exact CAD (STEP, STL, 3MF), with the dimensions on the sheet used as written. It is the same AI CAD agent as `text_to_cad`.
- **`cad_to_drawing`** (5 credits, Studio plan) draws a finished CAD part (its `project_id`) as a dimensioned technical drawing made from the exact model.
- **`check_job`** (free) reports on a 3D or CAD job: still building, or the finished files.
  - The 3D tools return a `job_id`. In Claude's apps the card polls by itself. Elsewhere, call `check_job` every 30 seconds until the files are ready: one to five minutes for a photo model, two to eight for a CAD part.
- **`get_credits`** (free) shows the balance, the plan and what each operation costs. Call it before a batch.

## How to work

1. **Ask what the file is for.** It decides the tool:
   - A laser or plasma cutter wants a DXF of the flat profile at true size.
   - CAD modelling wants a DXF to trace as a sketch, or `text_to_cad` for the whole part.
   - Printing artwork wants `image_to_stl`.
   - Printing a real object wants `text_to_cad` (exact) or `photo_to_3d` (a look-alike).
2. **A trace with almost no contours, or one big blob, means the cut-off is wrong.** Set `threshold` to a number between 100 and 180. Use `invert: true` for light lines on a dark background. A noisy outline cleans up with `smoothing: 2` or `3`.
3. **With a shell, save the results where the user works:** `curl -sSL -o part.dxf "<url>"`. Report the file names and the credits used.
4. **Failures are refunded automatically.** Say that, rather than leaving the user wondering.
5. **No Studio plan, or out of credits:** the tool says so and charges nothing. Tell the user, name the account, and point at <https://techdrawai.com/app/subscription>. Do not retry.
