---
name: drafting
description: Draft a dimensioned 2D technical drawing with TechDraw AI from a photo of an object or from a written description of a part. Use when the user wants an engineering, working, shop or production drawing; orthographic views; an assembly drawing with a parts list; an as-built record; a patent figure; or a drawing to hand to a machinist, fabricator or manufacturer.
---

# TechDraw AI: drafting from a photo or a description

Two tools make the drawing, and each costs **5 credits**:

- `generate_technical_drawing` drafts from a **photo** of a real object.
- `text_to_technical_drawing` drafts from a **description** with sizes, for a part that does not exist yet or is easier to describe than to photograph. Takes about 30 to 60 seconds.

`identify_product` names the object in a photo, for free. The name improves the title block and the size estimates, so use it when you do not know what the object is.

## Getting a local photo in

Tools take image URLs, not file paths. For a file on this machine:

1. Call `upload_file` once. It returns a curl command with a 30-minute link.
2. Run that command for each file. It prints `{"url": ...}`, and that URL is the `image`.
3. Shrink anything over 4 MB first: `sips -Z 2048 in.jpg --out small.jpg` on macOS, or `magick in.jpg -resize 2048x2048 small.jpg`.

A public https image link, or any earlier TechDraw AI result, works as `image` directly.

## One real measurement changes everything

- **No measurement:** the sizes are the model's estimates, and the sheet marks them nominal. Fine for a concept, not for a workshop.
- **One real measurement:** everything else is scaled from it, and the drawing becomes internally consistent.

So if the user has not given one, ask:

> "Do you have one real measurement of it, say the overall width or the height? Everything else gets scaled from that."

Pass it in `measurements` with `position` naming where it was taken, for example "overall width" or "bore diameter". That wording tells the drafter which edge the number belongs to.

For `text_to_technical_drawing`, put every size the user gave, across all their messages, into the one `prompt`. Stated numbers are drawn as given, and anything left out is marked nominal.

## Choosing the sheet

- **`drawing_type`** follows from what the user said:
  - "to get it made" → `working`
  - "how it goes together" → `assembly`
  - "for a patent" → `patent`
  - "record of what we built" → `as-fitted`
- **`standard`:**
  - Europe and most of the world: ISO, first-angle.
  - North America: ANSI, third-angle.
  - Ask when unsure. A wrong projection symbol actively misleads.
- **Sheet size follows the part.** A4 suits a small part. A cabinet, or an assembly with a parts list, wants A3 or A2.
- **`trade`** (furniture, machine-parts, sheet-metal, woodworking, 3d-printing, clothes) adds that trade's drafting conventions.

## After the drawing

- The result is a PNG link. When the user works in a project, save it: `curl -sSL -o bracket-drawing.png "<url>"`.
- **Offer the DXF.** A PNG is a picture of a drawing, and the DXF is the drawing. Pass the drawing's URL to `image_to_dxf` with `width_mm` set from the user's measurement. The `cad` skill covers that step.
- **When they need the part itself in CAD rather than a drawing of it,** `text_to_cad` models it exactly as STEP and STL. The `cad-part` skill covers that.
- Report the credits used. Failed generations are refunded automatically, so say so if one fails.
- **Out of credits:** say so, name the TechDraw AI account, and point at <https://techdrawai.com/app/subscription>. Do not retry.
