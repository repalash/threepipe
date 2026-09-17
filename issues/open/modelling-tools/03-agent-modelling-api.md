# Agent-driven modelling: command API, generators, reference calibration

Parent: [`00-synthesis.md`](./00-synthesis.md).
Siblings: [`01-m1-kernel-subplan.md`](./01-m1-kernel-subplan.md), [`02-parity-goal.md`](./02-parity-goal.md).

## Why this plan exists

The kokraf demo video (02) set a *human UX* target. The SU-152 lab report
(`https://su152-kokraf-lab-notes.app.teenyapp.com/`) sets a much sharper and more valuable one: an
agent built a 64-object, 52k-triangle tank from a reference photograph using **149 JSON commands**,
with visual feedback between each. That is the "programmatic API usable by humans and AI agents"
from the original brief, demonstrated end to end.

This is now the primary goal. The video target (02) stays as the human-UX checklist.

**Success test**: an agent, given only a reference photograph, builds a recognisable vehicle in
threepipe through the command API, sees what it built after each command, corrects proportions, and
exports a GLB that passes the Khronos validator. No imported geometry, no hardcoded coordinate dumps.

## What the report actually demands

### Commands it used (the whole surface)

| Group | Commands |
| --- | --- |
| Create | `primitive`, `lathe`, `sweep` |
| Edit | `vertices`, `transform`, `array`, `duplicate` |
| Scene | `rename`, `material`, `select`, `light`, `lighting`, `display` |
| Session | `camera`, `capture`, `inspect`, `undo`, `checkpoint`, `tools.reload`, `selftest` |

Note what is **not** there: no bevel, no inset, no boolean, no knife, no loop cut. A whole tank was
built without them. The load-bearing operations are *lathe*, *sweep*, *array*, and *vertex edits by
id*. We have none of those four. We have extrude, duplicate, delete, merge and the modal transform,
which the report barely needed.

That reorders the roadmap. Generators and arrays come before the big edit-mode ports.

### Weaknesses it reported, which are our feature list

Their priority order, kept:

1. **Calibrated photo planes & registered reference overlay.** Their #1, and the stated "most
   valuable upgrade". Our `ReferenceImagePlugin` is a picture-in-picture overlay - useful for a
   human, useless for registration. Needs: image on a world-space plane at a known scale, saved
   orthographic view locked to it, silhouette comparison.
2. **Background-safe render; separate edit and capture acknowledgements.** An edit finishing while
   its screenshot waits on a background `requestAnimationFrame` made recovery ambiguous. Our
   dispatcher must ack the edit and the capture independently, and never block the queue on a frame.
3. **Explicit port / project / document identity.** Every result carries a document id.
4. **Live mirrors, instances, array modifiers.** They arrayed 88 track shoes, then had to re-array by
   hand to change the master. Blender's answer is a modifier stack; so is ours.
5. **Saved front / side / rear / detail cameras.**
6. **Clearance / collision checks.**
7. **Bevel, inset, extrusion, shell, boolean.** (Extrusion we have.)
8. **Reference panel + operation timeline in a split viewport.**

## Decisions

- **D8 Third package `@threepipe/plugin-modelling`** (`plugins/modelling`), `ModellingPlugin`.
  Depends on threepipe + mesh-kernel; **does not depend on mesh-edit**. Rationale: the command API is
  a document-and-scripting layer, not an interaction layer, and it must run headless in Node (with
  the polyfill) so an agent can build without a browser. mesh-edit stays the human UI. The workspace
  example loads both.
- **D9 Commands are data.** Every command is a plain JSON object `{op: string, ...params}` with a
  declared schema, and every result is plain JSON. No function references, nothing unserialisable.
  This is what makes one surface serve a script, a UI action, a replay log and an agent.
- **D10 Generators are kernel-side and Node-safe**, ported from Blender, producing n-gon `MeshData`.
  This also closes 02's "n-gon primitives from Blender" gap - the same port serves both.
- **D11 Undo is snapshot-based per command**, storing `MeshData` plus object transforms for the
  objects a command touched. `checkpoint` names a point on that stack.
- **D12 Modifier stack on the editable mesh**, evaluated lazily, holding array / mirror. Answers
  their #4. Ported from `MOD_array.cc` and `MOD_mirror.cc`.

## Milestones

### MA - kernel generators (Node-safe, ported from Blender) — **done**
All in `plugins/mesh-kernel/src/generate/`. Details, sources and the three bugs the port found in
existing kernel code are in [`01-m1-kernel-subplan.md`](./01-m1-kernel-subplan.md#generators-milestone-ma-of-03-agent-modelling-apimd).
Kernel suite 341 → 550 tests.

| Item | Blender source | Status |
| --- | --- | --- |
| `createGrid` / `createCube` / `createCircle` / `createCone` / `createUVSphere` / `createIcoSphere`, with UVs | `bmo_primitive.cc` | **done** (monkey skipped) |
| `spin` | `bmo_utils.cc` `bmo_spin_exec` | **done** |
| `lathe`, `primitiveTorus` | spin over a wire profile, `MOD_screw.cc`, `add_mesh_torus.py` | **done** |
| `sweep`, minimum-twist frames incl. the cyclic correction | `curve_to_mesh_convert.cc`, `curve_poly.cc` | **done** |
| `arrayGeometry` / `arrayLinear` / `arrayRadial` / `arrayCurve` | `MOD_array.cc`, `curve_deform.cc`, `anim_path.cc` | **done** |
| `mirror` | `bmo_mirror.cc` + `mesh_flip_faces.cc` | **done** |
| `weldVerts`, splice primitives | `bmo_removedoubles.cc`, `bmesh_core.cc` | **done** |

### MB - `@threepipe/plugin-modelling` — **done**
`plugins/modelling`. Document model (object <-> master `MeshData` <-> evaluated <-> baked geometry),
queued dispatcher with schema validation and "did you mean", snapshot undo taken automatically
around any mutating command, rollback of a command that throws part-way, and a session transcript.

Commands: `primitive` `lathe` `sweep` | `vertices` `transform` `extrude` `array` `duplicate`
`mirror` `delete` | `modifier` | `rename` `material` `select` `light` `lighting` `display` |
`camera` `capture` `inspect` `measure` `undo` `redo` `checkpoint` `selftest` `export` `reference`
`help`.

Beyond the report's list: `extrude` (their #7, already in the kernel), `mirror`, `measure` (their #6,
clearance by bounding-box overlap), `modifier` (their #4), `reference` (their #1), `help`.

### MC - reference calibration and saved views — **done**
Their #1 and #5. `reference` places a photograph on a world plane at a measured scale -
`calibrate: {from, to, distance}` in normalised image coordinates - and registers a camera view
`ref:<name>` through threepipe's existing `CameraViewPlugin`, so a capture frames the model exactly
as the photo frames its subject. `camera {view}` replays saved views first and falls back to
computed front/back/left/right/top/bottom/iso framings derived from bounds, so the same command
gives comparable framing as the model grows.

### MD - modifier stack — **done**
Their #4. `array` gains `live: true`; the object keeps a master mesh and an evaluated one, and the
`modifier` command adds, updates, reorders, removes and applies. Editing the master re-evaluates
every copy. Vertex indices always address the master.

### ME - the build — **done**
`examples/modelling-api/builds/isu-152.mjs`: an ISU-152 heavy assault gun, 68 commands, 25 objects,
1784 n-gon faces, built from Wikimedia Commons photographs and published dimensions. Run it with
`npm run modelling:session -- examples/modelling-api/builds/isu-152.mjs --out tmp/isu-152`; it writes
numbered captures, a replayable JSON transcript and a GLB.

Timings on this machine, against the report's for comparison:

| | SU-152 report | this |
| --- | --- | --- |
| median command | 2.9 ms | ~1 ms |
| 90th percentile | 253 ms | ~206 ms |
| worst stall | 118 s (background-tab frame) | 3.9 s (first capture, environment load) |

The 118-second stall is the one that cannot happen here: `capture` drives the render loop explicitly
instead of awaiting `requestAnimationFrame`, and the session driver puts a timeout on every command
so a stuck one fails visibly rather than taking the transcript with it.

**Honest limits of the build.** The reference is a three-quarter photograph, so `calibrate` fixes its
*scale* but cannot give a registered orthographic overlay - perspective makes the two disagree by a
few percent along the length. A true side elevation or a technical drawing would. And the model is
exterior massing plus major fittings: no weld beads, no casting texture, no individual track shoes
(one closed sweep stands in for 88 arrayed ones), no tow hooks or light guards. That is the same
class of gap the report lists for itself, arrived at for the same reason - time, not capability.

## Rules carried over

- Port from Blender source; never approximate, never hardcode output.
- kokraf is BUSL-1.1: behaviour target only, no code.
- The kernel imports neither threepipe nor three (see 01 for why: `ImageData` at module scope).
