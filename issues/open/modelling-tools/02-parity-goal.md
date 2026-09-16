# Goal: feature parity with kokraf

Parent: [`00-synthesis.md`](./00-synthesis.md). Kernel progress: [`01-m1-kernel-subplan.md`](./01-m1-kernel-subplan.md).

The target is everything kokraf's demo shows, which is the same set its bundled user manual documents
(`.repos/kokraf/manual/`, 23 pages, 36 tools and actions). The manual is a better specification than the
video: it is exhaustive, unambiguous, and lists the modes each tool applies in.

Reminder on provenance: kokraf is BUSL-1.1. This is a **behaviour** target, not a code source. Every
algorithm is ported from Blender, which is also the better implementation — kokraf's own loop cut is
quads-only, its knife handles one straight segment, and its edge slide has a placeholder scorer.

## Parity checklist

Status: **done** / **kernel ready** (the kernel supports it, UI missing) / **todo**.

### Modes and navigation
| Feature | Status | Notes |
| --- | --- | --- |
| Object mode / Edit mode toggle | todo | M4. Plugin named `MeshEditPlugin`; `EditModePlugin` is taken by the Blueprint editor |
| Orbit / pan / zoom / focus | **done** | threepipe already has these |
| View helper gizmo | **done** | `EditorViewWidgetPlugin` |
| X-ray mode | todo | M4, needs the edit-mode overlay |
| Viewport shading modes | todo | M4 |

### Selection
| Feature | Status | Notes |
| --- | --- | --- |
| Click select, object | **done** | `PickingPlugin` |
| Multi-select, object | **done** | `PickingPlugin`, primary is index 0 |
| Vertex / edge / face sub-modes | todo | Kernel selection flags exist; picking and overlays are M4 |
| Box select | todo | Object-level issue already filed as marquee select |
| Select all / none / invert | kernel ready | Flags exist; needs the flush rules |
| Select linked | todo | Needs the shell walker |
| Select loops and rings | todo | Needs the loop and ring walkers, the same ones loop cut uses |
| Selection history and active element | **done** | Kernel side, round-trips through conversion |

### Edit-mode tools
| Feature | Status | Notes |
| --- | --- | --- |
| Move / rotate / scale with axis constraints | todo | M4 transform state machine, ported from Blender |
| Numeric input during a modal op | todo | M4 |
| Snapping | todo | M4, plus vertex and grid targets |
| Extrude | todo | M5. Composition of duplicate, delete and side-face creation |
| Inset | todo | M5 |
| Bevel | todo | M6, the largest single port |
| Loop cut | todo | M5, via subdivide with the ring walker |
| Knife | todo | M6 |
| Edge slide | todo | M5 |
| New face from vertices | todo | M5, Blender's `contextual_create` |
| Merge | todo | M5 |
| Split / separate | todo | M5 |
| Delete elements | kernel ready | Kill operators exist; needs the delete-context modes |
| Subdivide | kernel ready | `splitEdgeMakeVert` does the topology; smoothing is M5 |
| Dissolve | kernel ready | `joinFaceKillEdge` works; the operator wrapper is M5 |

### Object-mode actions
| Feature | Status | Notes |
| --- | --- | --- |
| Duplicate / copy / paste / delete | **done** | `PickingPlugin`, `ObjectClipboard` |
| Join objects | todo | M5 |
| Apply transform | **done** | Existing threepipe |
| Add primitives | partly | `Object3DGeneratorPlugin` exists; n-gon primitives ported from Blender are M5 |
| Outliner | **done** | `HierarchyUiPlugin` |
| Context menus | **done** | `CustomContextMenu` plus uiconfig tags |

### Beyond the demo, in kokraf but lower priority
| Feature | Status | Notes |
| --- | --- | --- |
| Booleans | todo | M7, via manifold-3d as a lazy optional plugin |
| UV editor and unwrap | todo | M7, via `xatlas-three`, which is already the maintainer's package |
| Texture painting | todo | Out of scope for parity-with-demo; revisit later |
| Undo / redo | partly | Kernel snapshots designed; wiring to `UndoManagerPlugin` is M4 |
| Import / export | **done** | threepipe's asset pipeline is already ahead here |

## What "complete" means

1. Every row above is **done**.
2. Each tool is a Blender port with its provenance recorded, not an approximation.
3. Each tool is reachable three ways: keyboard, UI, and the typed scripting API. The API is the agent
   API, so a tool that only works from a gizmo is not finished.
4. Interactive Playwright coverage per tool, following the existing test matrix.
5. The kernel stays Node-safe: no tool may pull a browser dependency into it.

## Order

Kernel first, because every tool depends on it. Remaining kernel work: walkers, selection flush,
normals, tessellation is done, then the operator slot machinery that the generated Blender schema
drives. Then M4 edit mode, which is the single biggest unlock: once selection, overlays and the modal
transform exist, each subsequent tool is an operator plus a keymap entry.
