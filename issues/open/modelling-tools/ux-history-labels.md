# Undo history labels are inconsistent: "Inset cube", "Extrude", "Scale", "Select cube"

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor**.

## What happens

Document commands are labelled with the object name (`Inset cube`, `Delete cube`) and mesh-edit
operators are not (`Extrude`, `Scale`, `Move`, `Loop Cut and Slide`); the object-mode click is a step
(`Select cube`). The History tab after the house build reads `Move, Inset cube, Extrude, Inset cube,
Extrude, ...`, so it is hard to tell which inset was the door and which a window.

## Expected

Blender's Undo History lists operator names only (`Inset Faces`, `Extrude Region and Move`), one per
step; the object is implied by the mode. Figma names layer operations by the layer.

## Suggested fix

Use the operator label for every step (`Inset Faces`, `Extrude`) and, if the object is worth showing,
show it in a second, dimmer column of the History list for every step alike.
