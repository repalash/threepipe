---
prev:
    text: 'PivotControlsPlugin'
    link: './PivotControlsPlugin'

next:
    text: 'ObjectConstraintsPlugin'
    link: './ObjectConstraintsPlugin'

aside: false
---

# PivotEditPlugin

[Example](https://threepipe.org/examples/#pivot-edit-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PivotEditPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PivotEditPlugin.html)

<iframe src="https://threepipe.org/examples/pivot-edit-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Pivot Edit Plugin Example"></iframe>

Pivot Edit Plugin provides interactive pivot point (origin) editing for objects. Toggle "Edit Pivot" mode to show a translate-only gizmo at the object's pivot, drag it to move only the pivot while the object mesh stays visually in place.

Works alongside both [TransformControlsPlugin](./TransformControlsPlugin) and [PivotControlsPlugin](./PivotControlsPlugin), but does not require either. Only [PickingPlugin](./PickingPlugin) is required (auto-added if not present).

## Usage

```typescript
import {ThreeViewer, PivotEditPlugin, PickingPlugin} from 'threepipe'
import {Vector3} from 'three'

const viewer = new ThreeViewer({...})

const pivotEdit = viewer.addPluginSync(new PivotEditPlugin())

// Toggle pivot edit mode
pivotEdit.editPivot = true

// Preset operations
pivotEdit.pivotToCenter()                    // move pivot to bounding box center
pivotEdit.pivotToBottom()                    // move pivot to bottom center
pivotEdit.pivotToOrigin()                    // move pivot to world origin
pivotEdit.pivotToPoint(new Vector3(1, 0, 0)) // arbitrary point

// Pivot marker (visible when an object is selected)
pivotEdit.showPivotMarker = true   // default
pivotEdit.markerScale = 1          // size of the marker dot
pivotEdit.markerColor = 0xffff00   // yellow (default)
```

## Features

- **Interactive drag**: Translate-only gizmo at the pivot, drag to reposition. Object mesh stays in place.
- **Pivot marker**: Yellow sphere at the current pivot location, visible when an object is selected, constant screen size.
- **Presets**: Pivot to Center, Bottom, World Origin.
- **Undo/Redo**: All operations integrate with [UndoManagerPlugin](https://threepipe.org/docs/classes/UndoManagerPlugin.html).

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **P** | Toggle pivot edit mode |
| **Escape** | Exit pivot edit mode |
