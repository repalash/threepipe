# Goal: feature parity with kokraf

Parent: [`00-synthesis.md`](./00-synthesis.md). Kernel progress: [`01-m1-kernel-subplan.md`](./01-m1-kernel-subplan.md).

The target is everything kokraf's demo shows, which is the same set its bundled user manual documents
(`.repos/kokraf/manual/`, 23 pages, 36 tools and actions). The manual is a better specification than the
video: it is exhaustive, unambiguous, and lists the modes each tool applies in.

Reminder on provenance: kokraf is BUSL-1.1. This is a **behaviour** target, not a code source. Every
algorithm is ported from Blender, which is also the better implementation — kokraf's own loop cut is
quads-only, its knife handles one straight segment, and its edge slide has a placeholder scorer.

## What the demo actually shows

Analysed from the 4m08s video at 8-second sampling (31 frames). This matters, because the demo and the
manual are not the same target, and the demo is the one the maintainer pointed at.

**The build is kit-bashing in object mode, not sculpting in edit mode.** A floating house is assembled
almost entirely from scaled and rotated primitives: the outliner is a long column of `Cube` entries
plus a few `Cylinder`s. Object-level translate, rotate, scale, duplicate and numeric entry in the
sidebar carry most of the work. Edit mode appears regularly but in a supporting role, nudging vertices
and faces to shape the hull, roof slopes and plank details.

**Observed, in rough order of screen time**
1. Object transform gizmos: translate arrows, rotate trackball rings, scale handles, with a
   `GLOBAL`/`LOCAL` orientation dropdown.
2. Add menu: Group, Mesh (Plane, Cube, Circle, Sphere, Cylinder, Cone, Torus), Light, Camera.
3. Numeric transform entry in the properties panel, typed directly into Position/Rotation/Scale.
4. **Reference images as picture-in-picture overlays**, several at once, repositioned around the
   viewport while modelling. This is central to the workflow and I had not accounted for it at all.
5. Edit mode with vertex / edge / face sub-mode buttons, selection highlighted in yellow, transform
   gizmo on the selection.
6. Outliner listing every object, with an OBJECT / MATERIAL properties pane: Type, UUID, Name,
   Position, Rotation, Scale, Shadow cast and receive, Visible, Frustum Cull, Render Order.
7. Lights, with a point light's Intensity, Color, Distance, Decay, Shadow Intensity, Shadow Bias,
   Shadow Normal Bias and Shadow Radius.
8. Viewport shading modes `SOLID` and `MATERIAL`, a camera selector, and a view-orientation gizmo.
9. Final shaded render with lighting.

**Not clearly exercised in the sampled frames**: loop cut, knife, bevel, inset and edge slide. They are
documented in the manual and exist in the product, but the demo does not lean on them. Extrude may
appear during hull and roof shaping; at 8-second sampling I cannot confirm it, so I am not claiming it
either way.

**What this changes.** Most of the demo is object-level scene assembly, and threepipe is already strong
there: picking with multi-select, transform and pivot gizmos, the hierarchy outliner, primitive
generators, lights, materials and viewport shading all exist. The genuinely missing pieces for *this
demo* are narrower than the full manual suggests:

| Gap | Size | Note |
| --- | --- | --- |
| Edit mode: element selection, overlays, transform | large | M4, the main unlock |
| Reference image overlays | small | Not previously on the checklist. A viewport-space image plane plugin |
| Numeric transform entry | small | uiConfig already supports it; needs wiring in the editor |
| n-gon primitives from Blender | medium | Torus and cone exist as triangulated generators today |

The heavy edit-mode ports (bevel, knife, loop cut) remain on the checklist because the manual documents
them and parity means parity. But they are **not** on the critical path to reproducing this demo, and
should come after edit mode and the reference-image workflow.

## Parity checklist

Status: **done** / **kernel ready** (the kernel supports it, UI missing) / **todo**.

### Modes and navigation
| Feature | Status | Notes |
| --- | --- | --- |
| Object mode / Edit mode toggle | **done** | Tab, in `MeshEditPlugin` |
| Orbit / pan / zoom / focus | **done** | threepipe already has these |
| View helper gizmo | **done** | `EditorViewWidgetPlugin` |
| X-ray mode | todo | M4, needs the edit-mode overlay |
| Viewport shading modes | todo | M4 |

### Selection
| Feature | Status | Notes |
| --- | --- | --- |
| Click select, object | **done** | `PickingPlugin` |
| Multi-select, object | **done** | `PickingPlugin`, primary is index 0 |
| Vertex / edge / face sub-modes | **done** | `MeshEditPlugin`, keys 1/2/3 |
| Box select | todo | Object-level issue already filed as marquee select |
| Select all / none / invert | **done** | A, Alt+A, Ctrl+I |
| Select linked | **done** | L, via the vert-shell walker |
| Select loops and rings | todo | Needs the loop and ring walkers, the same ones loop cut uses |
| Selection history and active element | **done** | Kernel side, round-trips through conversion |

### Edit-mode tools
| Feature | Status | Notes |
| --- | --- | --- |
| Move / rotate / scale with axis constraints | **done** | G/R/S, X/Y/Z, Shift+axis for planes |
| Numeric input during a modal op | **done** | Type digits mid-transform |
| Snapping | todo | M4, plus vertex and grid targets |
| Extrude | **done** | E, chained into a move as Blender's macro does |
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
