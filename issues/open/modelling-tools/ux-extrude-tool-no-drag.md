# The Extrude tool on the shelf barely follows the mouse; the depth has to be typed in the panel

Found by the `house-walkthrough` demo, 2026-10-18 (window 3, step `window-toolbar`). Rank: **major** for
Figma/Tinkercad users, who model with the shelf and the mouse.

## What happens

With a face selected, clicking Extrude on the tool shelf starts the extrude modal at once
(`plugins/editor-engine/src/tools/tools.ts`, `mesh.extrude` tool: `oneShot(() => engine.run('mesh.extrude'))`)
while the pointer is on the shelf. Moving over the face and clicking gave an extrude depth of 0.0005
(`run-*.json`, step `window-toolbar`, `extrudeByMouse`), so the demo sets -0.05 in the redo panel.
The modal's reference is wherever the pointer was when the shelf button was clicked.

## Expected

Blender's Extrude Region tool (`builtin.extrude_region`) shows a gizmo arrow on the selection; dragging
the arrow (or a left drag on the selection) extrudes along the normal, release confirms. Tinkercad and
SketchUp's Push/Pull: press on the face, drag, release.

## Suggested fix

Make the shelf Extrude a press-drag-release tool like the Inset Faces / Bevel tools now are
(`PropDragModal` waits for the press in the viewport when started from the shelf), or give it Blender's
extrude gizmo arrow.
