---
name: techdrawai-cad
description: Turn drawings and photos into CAD files and 3D models with TechDraw AI. Use when the user wants a DXF or DWG for CAD, CNC, laser cutting or plasma cutting; wants to import geometry into Fusion 360, SolidWorks, Onshape, FreeCAD, AutoCAD, Rhino, Blender or LightBurn; wants a 3D model or STL reconstructed from a photograph; wants to check clearance or print a part; or wants a photorealistic product render made from a technical drawing.
---

# TechDraw AI: CAD files, 3D models and renders

Everything downstream of a drawing. If the user needs the drawing itself first, use the `techdrawai-drafting` skill and come back here with what it wrote.

## Setup (once)

```bash
npx -y techdrawai-mcp auth login      # browser sign-in, no key to copy
```

Requires an active **Studio** plan. If a tool reports a plan error, say so plainly and point at <https://techdrawai.com/app?view=subscription> rather than retrying. Keys can also be created in Settings and passed as `TECHDRAWAI_API_KEY`.

## Tools

### `image_to_dxf`
Any raster image becomes real CAD vector contours in a DXF file. **Free.**

- `image` (required): a generated drawing, a scan, a sketch, a logo, a photo of a flat part.
- `width_mm`: **pass this whenever the real size is known.** Without it the geometry arrives at one DXF unit per pixel and the user has to rescale by hand in CAD, which is exactly the annoying step they came here to avoid.
- `threshold`: `"auto"` (default) or a number 0 to 255 to force the ink and paper cut-off.
- `invert`: for light lines on a dark background.
- `smoothing`: 1 keeps detail, higher smooths the contours.
- `dwg`: also write AutoCAD's native `.dwg` beside the `.dxf`.
- `output_path`: defaults to `./techdrawai-output/`.

The DXF is ASCII R2000 and opens in AutoCAD, Fusion 360, SolidWorks, Onshape, FreeCAD, LibreCAD, Rhino, Inkscape and the common laser and CNC tools such as LightBurn.

### `text_to_cad`
AI CAD: a description, optionally with up to three photos or sketches, becomes an exact, editable CAD part: a STEP for CAD programs, an STL for printing and a 3MF for slicers. **80 credits, Studio plan**, refunded if nothing is built. Starts a job (two to eight minutes) and returns a `job_id` and a `project_id`.

- `prompt` (required): what the part is and every size, in mm.
- `images`: up to three photos, sketches or drawings; sizes written on them are used exactly.
- `project_id`: change a part made before ("make the wall 6 mm").

### `drawing_to_3d`
A technical drawing or dimensioned sketch becomes the same exact CAD part, with the dimensions on the sheet used as written. **80 credits, Studio plan**, refunded if nothing is built. `notes` carries anything the sheet leaves out. Returns a `job_id`.

### `cad_to_drawing`
A finished CAD part (its `project_id`) becomes a dimensioned technical drawing made from the exact model, ISO A3. **5 credits, Studio plan**, one to two minutes.

### `photo_to_3d`
A photo of one real object becomes a textured 3D mesh: GLB, STL, OBJ, FBX and USDZ. **80 credits, Studio plan**, refunded if it fails. It follows the photo's shape and colours, not exact dimensions, so it suits furniture, products and AR, not a part to machine. Returns a `job_id` (one to five minutes).

- `image` (required): a clear photo of a **single** object.
- `detail`: `draft`, `standard` (default) or `high`. `textured`: defaults to true.

### `check_job`
Poll a `job_id` about every 30 seconds. When the job is done the files are saved to `./techdrawai-output/` (or `output_dir`) and their paths returned. If the CAD agent needs answers first, nothing was charged: ask the user and call `text_to_cad` with the answers and the `project_id`. **Free.**

### `image_to_stl`
Flat artwork becomes a solid, watertight STL to slice and print. **Free.** The same trace as `image_to_dxf`, extruded: a logo, stencil, sign or line drawing given a thickness. A photograph of an object comes out as its outline in relief, not the object; use `photo_to_3d` for that.

- `image` (required), `size_mm` (longest side, default 100), `thickness_mm` (default 3), `min_feature_mm` (default 0.3), plus `threshold`, `invert`, `smoothing`, `max_dim`, `output_path`.
- `stl_too_large` means the trace is too detailed for one reply: `smoothing: 3` or `max_dim: 800` each roughly halve it.

### `render_product`
A technical drawing becomes a photorealistic image of the finished product. **5 credits.** The geometry is reconstructed from the views, so the render matches the design rather than inventing a new one.

- `image` (required): the technical drawing.
- `style`: `photoreal` (default), `studio`, `clay`, `lifestyle`.
- `background`: `white` (default), `gradient`, `scene`.
- `angle`: `three-quarter` (default), `front`, `top`, `isometric`.
- `material`: for example "brushed aluminium, matte black".

### `check_credits`
Balance, plan and per-operation costs. Worth calling before a batch.

## How to work with the user

1. **Ask what the file is for.** It changes the answer. Laser or plasma cutting wants a DXF of the flat profile at true size. Modelling in CAD wants a DXF to trace as a sketch. 3D printing wants `image_to_stl` for flat artwork and `photo_to_3d` for a real object, not a DXF at all.
2. **Always set `width_mm` when you know the size.** If the user said the part is 120 mm across, pass 120. If they have not said, ask. Geometry at the wrong scale is worse than no geometry, because it looks fine until something is cut wrong.
3. **A DXF is contours, not a solid.** Say so. In CAD the user imports it as sketch geometry and then extrudes or revolves it. It is not a parametric model and it will not arrive with a feature tree.
4. **`photo_to_3d` needs one object.** A photo of a cluttered bench reconstructs the clutter. Ask for a clean shot against a plain background if the first attempt is poor.
5. **Try `threshold` and `invert` before giving up.** If a trace comes back with almost no contours, or with one huge blob, the cut-off is wrong for that image. A number between 100 and 180 fixes most photographs, and `invert: true` fixes white lines on a dark background.
6. **Report the path and the credits used**, and offer the obvious next step: a DWG alongside the DXF, a heavier mesh, a different render angle.
7. **Failures are refunded.** If a generation fails, the credits come back automatically. Say that rather than leaving the user wondering.

## Example

> User: "Here is a drawing I made earlier, `./out/bracket.png`. The bracket is 120 mm wide. Get me something I can cut on the laser."

1. `image_to_dxf` with `image: "./out/bracket.png"`, `width_mm: 120`, `dwg: true`.
2. Report both paths and the contour count, and say the DXF is at true size so it goes straight to the cutter without rescaling.
3. Mention that if the cut line looks noisy, `smoothing: 2` cleans it up, and that a plain black-on-white drawing traces best.
