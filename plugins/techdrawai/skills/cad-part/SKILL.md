---
name: cad-part
description: Model a mechanical part as exact, editable CAD (a STEP file plus an STL) with TechDraw AI's CAD agent, from a written description, a dimensioned sketch or a photo. Use when the user wants a real CAD model, a STEP or STP file, a part to open in Fusion 360, SolidWorks, FreeCAD, Onshape or another CAD program, a part to 3D print or machine with exact dimensions, or wants to change a part made this way.
---

# TechDraw AI: an exact CAD part from a description or a sketch

`text_to_cad` hands the request to TechDraw AI's CAD agent. It writes and runs build123d (OpenCascade) code, measures the solid it built, checks it against the request and returns a **STEP** (exact B-rep, opens in any CAD program) and an **STL** (for slicers). Dimensions are exact, not estimated from a picture. That is what separates it from `photo_to_3d` and `drawing_to_3d`, which build a textured mesh that follows proportions only.

It costs **80 credits** and needs the TechDraw AI **Studio** plan. If nothing gets built, the credits come back automatically. Because every call is a real charge, get the request right before sending it.

## Before calling

1. **Collect every size the user gave, across all their messages, into one prompt.** Give each one as a number in mm with what it measures: "L bracket, legs 60 and 40 mm, 30 wide, 4 thick, 3 mm inside bend radius, two Ø5 through-holes per leg centred on the width." The agent chooses sensible values for anything left open and says which. If a size that decides whether the part fits is missing (a bore for a bearing, a hole pattern that must match something), ask for it first.
2. **Say what the part is for** when the user told you: "mounts a NEMA 17 motor", "prints in PETG", "machined from 6 mm aluminium". The agent designs for it.
3. **A sketch or drawing makes the best input.** Sizes written on it are used exactly. A photo needs one known size to scale from. Pass up to three images in `images`.
   - Images are URLs, not file paths. **With a shell** (Claude Code, Cowork): call `upload_file` once and run the curl command it returns for each file. The command prints `{"url": ...}`, and that URL goes in `images`. Shrink anything over 4 MB first: `sips -Z 2048 in.jpg --out small.jpg` on macOS, or `magick in.jpg -resize 2048x2048 small.jpg`.
   - **In a chat with no shell** (Claude on the web, Desktop or mobile): call `upload_photo`. It shows a file picker, and the uploaded file's URL arrives in the chat.

## While it runs

`text_to_cad` returns a `job_id` and a `project_id` at once. A part takes from under a minute to about eight minutes. In Claude's apps a card shows the progress and finishes by itself. Where there is no card, call `check_job` with the `job_id` every 30 seconds, and tell the user it is modelling rather than leaving them watching a silent prompt. Polling is free.

## When it finishes

- **Files.** `check_job` returns STEP and STL links. They are permanent and do not need a sign-in to download. When the user is working in a project and you have a shell, save the files there:
  ```bash
  curl -sSL -o bracket.step "<step url>"
  curl -sSL -o bracket.stl  "<stl url>"
  ```
- **What was built.** Pass on the agent's summary: overall size, the main features, and especially **the values it chose itself**. The user needs to check those before cutting metal.
- **Questions instead of a part.** Sometimes the description is too ambiguous to model. Then `check_job` returns the agent's questions and nothing is charged. Put them to the user, then call `text_to_cad` again with the answers and the same `project_id`.
- **Changes.** To change the part ("make the holes M5 clearance", "add a 2 mm fillet on the outer edges"), call `text_to_cad` with the change as the prompt and the part's `project_id`. The agent edits that model instead of starting over. Each change is another 80 credits, so batch several changes into one prompt.
- The part also appears in the user's AI CAD projects at <https://techdrawai.com/app/ai-cad>. They can rotate it there, keep changing it, or make a technical drawing of it.

## Which tool, briefly

| The user has | Wants | Use |
| --- | --- | --- |
| Sizes, a sketch or a drawing | An exact part to make or edit in CAD | `text_to_cad` |
| A photo of an object | A textured 3D look-alike (GLB) | `photo_to_3d` |
| A technical drawing or dimensioned sketch | The exact part it describes | `drawing_to_3d` (same agent and files as `text_to_cad`) |
| A CAD part already made | Its dimensioned technical drawing | `cad_to_drawing` with the `project_id` (5 credits) |
| Flat artwork, a logo | Something to print | `image_to_stl` (free) |

If the user has no Studio plan, the tool says so and charges nothing. Tell them, name the account, and point at <https://techdrawai.com/app/subscription>. Do not retry.
