# The Face context menu is 23 items long, starts with selection, and hides the face

Found by the `house-walkthrough` demo, 2026-10-16 (window 1 is made from this menu). Rank: **minor**.

## What happens

Right-clicking a face in face mode opens one flat list of every operator whose `contextMenu` includes
`face` (`plugins/modelling-editor/src/ui/ContextMenuProvider.tsx:67-77`): Select All, Select None,
Select Linked, Select Edge Loop, Move, Rotate, Scale, Extrude, Duplicate, Split, Merge, Inset Faces,
Delete, Separate Selection, Bridge Edge Loops, Dissolve Faces, Limited Dissolve, Subdivide, Knife,
Bisect, Frame Selected. It is ~600 px tall at 1280x720, so Blueprint shifts it up over the face that
was clicked.

## Expected

Blender's face context menu (`VIEW3D_MT_edit_mesh_context_menu`, face branch in `space_view3d.py`)
leads with what you do to faces: Extrude Faces, Extrude Faces Along Normals, Extrude Individual Faces,
Inset Faces, Poke, Triangulate, Tris to Quads, Solidify, Wireframe, ... then Shade Smooth / Flat,
then Delete. Selection and view operators are not in it. Figma's context menu is similarly short and
grouped with separators.

## Suggested fix

Context-menu definitions per select mode in the engine (the same way the Ctrl+V/E/F menus are defined),
ordered like Blender's, with separators; selection and view operators left to their menus.
