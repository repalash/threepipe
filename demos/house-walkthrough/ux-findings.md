# House walkthrough: UX findings

A newcomer (one Blender tutorial, or Figma only) builds a low-poly house in the modelling editor with
real keyboard and mouse input, Blender keymap then Design keymap (`drive.mjs`). Ranked: blocking, major,
minor. Each finding: what was tried, what happened, what Blender / Figma / Tinkercad do, a screenshot,
and where in the editor it comes from. The report page is `index.html` (`/demos/house-walkthrough/`).

## Blocking

### B1. The mouse wheel and trackpad pinch do not zoom

- **Tried:** Scrolled the wheel over the viewport to get closer to the cube (Blender, Figma, Tinkercad: wheel or pinch zooms).
- **Happened:** Nothing: the camera distance stays 7.51. Frame Selected / Frame All are the only zoom, and there are no zoom commands or keys either.
- **Elsewhere:** Blender: wheel, Ctrl+MMB drag, Numpad +/-, View > Navigation. Figma: pinch, Ctrl+wheel, Ctrl +/-. Tinkercad: wheel and +/- buttons on the view cube.
- **Where:** three-modded examples/jsm/controls/OrbitControls.js:422 multiplies the dolly by (enableDamping ? dampingFactor : 0); the editor turns damping off at plugins/modelling-editor/src/EditorViewportPlugin.ts:141. No zoom operators: plugins/modelling-editor/src/ops/viewOps.ts.
- **Issue:** [issues/open/modelling-tools/ux-wheel-zoom-dead.md](../../issues/open/modelling-tools/ux-wheel-zoom-dead.md), [issues/open/modelling-tools/ux-no-zoom-commands.md](../../issues/open/modelling-tools/ux-no-zoom-commands.md)
- **Status:** filed (fix in three.js-modded, pending a three-modded release; not worked around in the editor)

### B2. Dragging the Inset Faces / Bevel tool did nothing but stack toasts

- **Tried:** Selected a gable face, clicked Inset Faces on the tool shelf and moved the mouse to set the thickness, as its tooltip says.
- **Happened:** The thickness never changed; every mouse move posted another "Finish the current operation first" toast (five on screen at once). The modal re-runs its operator through the redo path, and the operators refused to run while a modal was active - including the modal itself.
- **Elsewhere:** Blender: Inset Faces follows the mouse live (edbm_inset_modal), so does Bevel; the header shows the value.
- **Where:** plugins/editor-engine/src/ops/messages.ts:17 (notModalMessage refused engine.propDrag), called on every re-run from plugins/editor-engine/src/tools/PropDragModal.ts _apply.
- **Screenshot:** [findings/toast-stack.jpg](./findings/toast-stack.jpg)
- **Status:** fixed: the modal's own re-runs pass (PropDragModal.applying). e2e: modelling-editor-inset-bevel, section 3.

### B3. I then 0.1 switched to vertex select mode instead of setting the inset

- **Tried:** Blender muscle memory for the door: I, type 0.1, Enter.
- **Happened:** I inset instantly at 0.05 with no modal; the typed 1 then switched to vertex select mode (and 2 would have picked edge mode), Enter did nothing. Ctrl+B was the same. The redo panel was the only way to get an exact value.
- **Elsewhere:** Blender: I and Ctrl+B are modal; the mouse distance from the selection centre sets the value, digits type it (handleNumInput), Enter confirms, Esc cancels; I / O / B toggle individual / outset / boundary while it runs.
- **Where:** plugins/editor-engine/src/keymap/presets/blender.ts:88-89 (before the fix) bound I and Ctrl+B to the instant operators; PropDragModal had no numeric input (its docstring said "digits type the value", handleKey had none) and mapped horizontal mouse travel instead of Blender's distance from the centre.
- **Screenshot:** [findings/inset-typed-keys.jpg](./findings/inset-typed-keys.jpg)
- **Status:** fixed: I and Ctrl+B start the inset/bevel modal in both presets; PropDragModal ports edbm_inset_modal / edbm_bevel_modal (NumInput, radial mouse mapping, Shift precision, I/O/B toggles). e2e: modelling-editor-inset-bevel, sections 1, 2, 4.

### B4. After typing a value in the redo panel, the viewport stopped taking keys

- **Tried:** Set the inset thickness to 0.1 in the redo panel, pressed Enter, moved back over the house and pressed S X 0.6 to narrow the door.
- **Happened:** Nothing happened: the number field kept the focus after Enter, so S, X and the digits went into it. Getting the keys back took a click in the viewport, which changes the selection. Typing a value also re-ran the operator on every keystroke (0, 0., 0.1), and the field was disabled while each re-run ran, which could drop keystrokes into the viewport as select-mode switches. A ticked checkbox kept the keys the same way.
- **Elsewhere:** Blender: keys go to the area under the pointer (wm_event_system.cc:4400); a number field applies on Enter and ends its editing. Figma: Enter commits a field and returns to the canvas.
- **Where:** plugins/modelling-editor/src/ui/PropsForm.tsx (NumericInput onValueChange committed per keystroke, focus kept after Enter); plugins/editor-engine/src/input/InputRouter.ts (routing by document.activeElement only).
- **Screenshot:** [findings/after-panel-keys-lost.jpg](./findings/after-panel-keys-lost.jpg)
- **Issue:** [issues/open/modelling-tools/ux-keys-after-redo-panel.md](../../issues/open/modelling-tools/ux-keys-after-redo-panel.md) (filed by the parent on modelling-editor)
- **Status:** fixed: number fields commit on Enter or blur and end editing on Enter/Esc; the viewport takes the keys back when the pointer is over it unless a text field is being typed into. e2e: modelling-editor-panel-keys.

## Major

### M1. Snapping, pivot, orientation and proportional editing are placeholders in the header

- **Tried:** Looked for snapping and the pivot point in the header, where Blender and every design tool put them.
- **Happened:** Each of the four buttons opens "Arrives with the interaction engine (P1). The shell slot is ready." P1 is merged; the features exist in MeshEditPlugin but have no UI besides Ctrl during a drag and the redo panel.
- **Elsewhere:** Blender: Pivot, Orientation, Snap and Proportional popovers in the 3D view header. Figma/Tinkercad: snapping visible and on by default.
- **Where:** plugins/modelling-editor/src/ui/Header.tsx:138 (placeholder text), :151-154 (the slots).
- **Issue:** [issues/open/modelling-tools/ux-header-slot-placeholders.md](../../issues/open/modelling-tools/ux-header-slot-placeholders.md)
- **Status:** filed

### M2. Up is Y; Blender tutorials say Z

- **Tried:** G Z 0.7 to lift the ridge, E Z 0.5 for the chimney, as every Blender tutorial types.
- **Happened:** Z is depth here (three.js / glTF Y-up), so the ridge would move towards the viewer. The view gizmo shows Y on top and the status strip lists X / Y / Z, so G Y works once you notice.
- **Elsewhere:** Blender is Z-up; Figma has no third axis; Tinkercad is Z-up on its workplane.
- **Where:** plugins/mesh-edit/src/transform/keymap.ts:47-53 (axis keys map to the world axes as named).
- **Issue:** [issues/open/modelling-tools/ux-axis-keys-y-up.md](../../issues/open/modelling-tools/ux-axis-keys-y-up.md)
- **Status:** filed (design decision for the maintainer)

### M3. Repeated messages stack up as separate toasts over the model

- **Tried:** Kept working while a message was on screen.
- **Happened:** Each repeat adds a toast; five identical ones covered the top half of the viewport. Toasts sit over the centre of the viewport, where the model is.
- **Elsewhere:** Blender reports one line in the status bar; Figma shows one toast at a time at the bottom.
- **Where:** plugins/modelling-editor/src/ui/ModellingEditorApp.tsx:115-123 (AppToaster().show without a key).
- **Screenshot:** [findings/toast-stack.jpg](./findings/toast-stack.jpg)
- **Issue:** [issues/open/modelling-tools/ux-toast-spam.md](../../issues/open/modelling-tools/ux-toast-spam.md)
- **Status:** filed

## Minor

### M1. No Shade Smooth / Shade Flat

- **Tried:** Searched the command palette for "smooth" and looked in the face context menu.
- **Happened:** Nothing that changes shading. The capability is the modelling command material {shading}, listed as an object-mode operator named just "Material".
- **Elsewhere:** Blender: right-click > Shade Smooth / Flat / Auto Smooth; Face > Shade Smooth in edit mode.
- **Where:** plugins/modelling/src/commands/scene.ts:53-56, :82; plugins/editor-engine/src/ops/modellingOps.ts:60.
- **Issue:** [issues/open/modelling-tools/ux-shade-smooth-missing.md](../../issues/open/modelling-tools/ux-shade-smooth-missing.md)
- **Status:** filed

### M2. The Face context menu is 23 items, starts with selection, and covers the face

- **Tried:** Right-clicked the window face to inset it.
- **Happened:** A ~600 px list: Select All, Select None, Select Linked, ... Inset Faces is item 12. Blueprint shifts the menu up over the clicked face.
- **Elsewhere:** Blender's face context menu leads with Extrude Faces, Inset Faces, Poke, Triangulate, and has no selection or view items.
- **Where:** plugins/modelling-editor/src/ui/ContextMenuProvider.tsx:67-77 (every operator with contextMenu: face, registry order).
- **Screenshot:** [findings/face-context-menu.jpg](./findings/face-context-menu.jpg)
- **Issue:** [issues/open/modelling-tools/ux-face-context-menu.md](../../issues/open/modelling-tools/ux-face-context-menu.md)
- **Status:** filed

### M3. Raw command names in the Mesh menu and palette: "BridgeEdgeLoops", "ConnectVertices"

- **Tried:** Opened the Mesh menu in object mode.
- **Happened:** Object-mode duplicates of the edit-mode operators, labelled with the camelCase command name.
- **Elsewhere:** Blender and Figma never show identifiers.
- **Where:** plugins/editor-engine/src/ops/modellingOps.ts:60.
- **Issue:** [issues/open/modelling-tools/ux-raw-command-labels.md](../../issues/open/modelling-tools/ux-raw-command-labels.md)
- **Status:** filed

### M4. History labels mix "Inset cube" with "Extrude" and "Scale"

- **Tried:** Read the History tab to find which step was the door.
- **Happened:** Document commands carry the object name, mesh-edit operators do not; a click in object mode is "Select cube".
- **Elsewhere:** Blender's Undo History shows operator names only.
- **Where:** step labels from plugins/editor-engine/src/EditorEnginePlugin.ts run() (history.pendingLabel) and the modelling document commands.
- **Issue:** [issues/open/modelling-tools/ux-history-labels.md](../../issues/open/modelling-tools/ux-history-labels.md)
- **Status:** filed

### M5. The first hint covers the cube it points at

- **Tried:** Followed hint 1, "Click to select".
- **Happened:** The card is anchored at the cube's centre and hides its right half.
- **Elsewhere:** Coach marks in Figma and Spline point at their target from outside it.
- **Where:** plugins/modelling-editor/src/ui/Hints.tsx:135-144.
- **Screenshot:** [findings/hint-covers-cube.jpg](./findings/hint-covers-cube.jpg)
- **Issue:** [issues/open/modelling-tools/ux-hint-covers-target.md](../../issues/open/modelling-tools/ux-hint-covers-target.md)
- **Status:** filed

### M6. The start cube is 1 m; Blender's is 2 m

- **Tried:** Typed a Blender tutorial's numbers.
- **Happened:** Proportions come out halved.
- **Elsewhere:** Blender's default cube is 2 m.
- **Where:** plugins/editor-engine/src/ops/objectOps.ts:17 (defaults: {size: 1}).
- **Issue:** [issues/open/modelling-tools/ux-default-cube-size.md](../../issues/open/modelling-tools/ux-default-cube-size.md)
- **Status:** filed

## What worked

- The welcome asks one question (Blender or not) and the move-around cards follow the answer and the device.
- Tab / Enter, 1-2-3, A, G/R/S with axis keys and typed values, E with typed distance: Blender muscle memory works, and the status strip shows the modal keys while you type.
- Ctrl+R loop cut: the ring preview, the wheel for more cuts, the right click to keep it centred, exactly as in Blender.
- The redo panel re-runs an operator with new values in one undo step; the History tab jumps to any step.
- Knife: click points, Enter; one undo step. Save As downloads a .glb that re-opens with the same topology, editable.
