/**
 * The task-indexed cookbook in `SKILL.md`: what to send for the things agents most often need, mined
 * from the ISU-152 and Eiffel tower builds (`examples/modelling-api/builds/`) and the edit-chain demo.
 *
 * Every entry runs in `tests/skill.test.ts` - in a Node session, or in the headless browser for the ones
 * that draw - and its `check` must hold, so an example in the skill cannot quietly stop working.
 */

import type {Command, CommandResult} from '@threepipe/plugin-modelling'

export interface CookbookEntry {
    /** The task, as an agent would phrase it. */
    task: string
    /** One or two sentences: why this way. */
    how: string
    /** Run first, not shown as the answer (shown as "given"). */
    given?: Command[]
    commands: Command[]
    /** Needs pixels: runs in the browser test. */
    browser?: boolean
    /** Returns a problem, or null when the example did what it says. */
    check(results: CommandResult[]): string | null
}

const data = (r: CommandResult) => r.data as any

export const COOKBOOK: CookbookEntry[] = [
    {
        task: 'Block out a part to measured dimensions',
        how: 'Name every object and give real sizes; the name is how every later command addresses it.',
        commands: [
            {op: 'primitive', type: 'cube', name: 'hull', width: 2.44, height: 0.85, depth: 6.77, position: [0, 0.895, 0]},
        ],
        check: rs => Math.abs(data(rs[0]).bounds.size[2] - 6.77) < 1e-6 ? null : 'hull is not 6.77 long',
    },
    {
        task: 'Find vertex, edge and face indices before editing',
        how: '`inspect {detail: true}` lists positions, `edgeVerts`, `faceVerts` and `faceEdges`. Pick indices from '
            + 'the numbers (e.g. the face whose vertices all have the largest y is the top), never by guessing.',
        given: [{op: 'primitive', type: 'cube', name: 'box', size: 2}],
        commands: [{op: 'inspect', object: 'box', detail: true}],
        check: rs => data(rs[0]).edgeVerts?.length === 12 && data(rs[0]).faceVerts?.length === 6 ? null : 'no edge/face listing',
    },
    {
        task: 'Taper or slope a block (move some vertices)',
        how: 'The ISU-152 nose: inspect, pick the vertices by position, move them relative. Here vertices 1, 3, 5, 7 '
            + 'of a fresh cube are its +z face.',
        given: [{op: 'primitive', type: 'cube', name: 'nose', size: 1}],
        commands: [{op: 'vertices', object: 'nose', relative: true, verts: [[1, 0, 0, -0.3], [3, 0, 0, -0.3], [5, 0, 0, -0.3], [7, 0, 0, -0.3]]}],
        check: rs => rs[0].locality?.local ? null : 'vertex move was not local',
    },
    {
        task: 'A wheel, knob or lens: lathe a profile',
        how: 'A profile of [radius, height] points revolved about an axis - the ISU-152 road wheels and the antenna.',
        commands: [{op: 'lathe', name: 'wheel', axis: 'x', segments: 20,
            profile: [[0, -0.08], [0.24, -0.08], [0.275, -0.03], [0.275, 0.03], [0.24, 0.08], [0, 0.08]]}],
        check: rs => rs[0].ok ? null : rs[0].error!,
    },
    {
        task: 'A row of identical parts that stays editable',
        how: 'A live `array` modifier: edit the master and every copy follows. Do not duplicate by hand.',
        given: [{op: 'primitive', type: 'cylinder', name: 'post', radius: 0.1, depth: 1, segments: 12}],
        commands: [{op: 'array', object: 'post', count: 6, step: [0.8, 0, 0], live: true}],
        check: rs => rs[0].ok ? null : rs[0].error!,
    },
    {
        task: 'A pipe, rail or track along a path',
        how: '`sweep` carries a profile (or a radius) along a polyline; `closed` for a loop. One sweep replaced 88 '
            + 'arrayed track shoes in the ISU-152 build.',
        commands: [{op: 'sweep', name: 'rail', radius: 0.03, steps: 8,
            path: [[0, 1, -2], [0, 1.2, -1], [0, 1.2, 1], [0, 1, 2]]}],
        check: rs => rs[0].ok ? null : rs[0].error!,
    },
    {
        task: 'The other side of a symmetric object',
        how: 'A live `mirror` modifier mirrors about the object origin; place the part at the origin and move its '
            + 'geometry (`transform {faces}`), or use `applyTransform`, before mirroring about a world axis.',
        given: [{op: 'primitive', type: 'cube', name: 'side', size: 1}, {op: 'transform', object: 'side', faces: [0, 1, 2, 3, 4, 5], move: [2, 0, 0]}],
        commands: [{op: 'modifier', object: 'side', add: {type: 'mirror', axis: 'x'}}],
        check: rs => rs[0].ok ? null : rs[0].error!,
    },
    {
        task: 'Grow a tower panel by panel: extrude, move, taper',
        how: 'The Eiffel piers: extrude the cap along the measured centreline and scale it to the measured width. '
            + 'The result lists the new cap faces - extrude those next.',
        given: [{op: 'primitive', type: 'plane', name: 'pier', size: 4}],
        commands: [{op: 'extrude', object: 'pier', faces: [0], direction: [0, 1, 0], distance: 3, scale: [0.8, 1, 0.8]}],
        check: rs => rs[0].ok && rs[0].locality?.local ? null : rs[0].error ?? 'not local',
    },
    {
        task: 'A window or panel: inset a face and push it in',
        how: 'Inset makes the border; extrude the inset face by a negative distance to recess it.',
        given: [{op: 'primitive', type: 'cube', name: 'wall', width: 4, height: 3, depth: 0.3}],
        commands: [
            {op: 'inset', object: 'wall', faces: [0], thickness: 0.3},
            {op: 'extrude', object: 'wall', faces: [0], distance: -0.1},
        ],
        check: rs => rs.every(r => r.ok) ? null : 'inset/extrude failed',
    },
    {
        task: 'A lattice or truss from a cage',
        how: 'The Eiffel bracing: `poke` puts an X in every panel and a live `wireframe` turns every edge into a strut, '
            + 'so editing the cage moves the lattice.',
        given: [{op: 'primitive', type: 'cube', name: 'cage', size: 2}],
        commands: [
            {op: 'poke', object: 'cage'},
            {op: 'wireframe', object: 'cage', thickness: 0.08, live: true},
        ],
        check: rs => rs.every(r => r.ok) ? null : 'poke/wireframe failed',
    },
    {
        task: 'Round an edge - after checking it is the right one',
        how: 'Highlight the edge index in a `look` (with `labels`) before spending it on a bevel.',
        given: [{op: 'primitive', type: 'cube', name: 'block', size: 2}],
        commands: [
            {op: 'look', view: 'iso', highlight: {object: 'block', edges: [3]}, labels: true, includeImage: false},
            {op: 'bevel', object: 'block', edges: [3], offset: 0.2, segments: 3},
        ],
        browser: true,
        check: rs => data(rs[0])?.highlight?.edges === 1 && rs[1].ok ? null : 'look or bevel failed',
    },
    {
        task: 'Check dimensions to scale (not by eye)',
        how: 'Write the drawing\'s numbers as a spec; `validate` answers PASS/FAIL/UNVERIFIED per requirement, in world space.',
        given: [{op: 'primitive', type: 'cube', name: 'plinth', width: 25.33, height: 2.5, depth: 25.33, position: [0, 1.25, 0]}],
        commands: [{op: 'validate', object: 'plinth', spec: {bbox: {size: [25.33, 2.5, 25.33], min: [null, 0, null]}, manifold: {closed: true}}}],
        check: rs => data(rs[0]).conforms ? null : 'spec did not conform',
    },
    {
        task: 'Make sure an edit touched only what it should',
        how: 'Every mutating result carries `locality`; across several commands, `checkpoint` first and `diff` after, '
            + 'claiming what you meant to change.',
        given: [{op: 'primitive', type: 'cube', name: 'box', size: 2}],
        commands: [
            {op: 'checkpoint', name: 'before-top'},
            {op: 'inset', object: 'box', faces: [0], thickness: 0.2},
            {op: 'diff', object: 'box', from: 'before-top', claim: {faces: [0]}},
        ],
        check: rs => data(rs[2]).local ? null : 'diff reported collateral',
    },
    {
        task: 'Undo a bad step, or rewind to a checkpoint',
        how: '`undo` walks the same history a person\'s Ctrl+Z does; `undo {to}` rewinds to a checkpoint. A failed '
            + 'command changes nothing, and `changed: false` means a command was a no-op with no undo step.',
        given: [{op: 'primitive', type: 'cube', name: 'box'}, {op: 'checkpoint', name: 'clean'}, {op: 'poke', object: 'box'}],
        commands: [{op: 'undo', to: 'clean'}],
        check: rs => data(rs[0]).undone === 1 ? null : 'did not rewind one step',
    },
    {
        task: 'See the model from all sides',
        how: '`look` with no arguments is an auto-framed front/right/top/iso sheet, plus which objects each view shows.',
        given: [{op: 'primitive', type: 'cube', name: 'box'}],
        commands: [{op: 'look', includeImage: false}],
        browser: true,
        check: rs => data(rs[0])?.views?.length === 4 ? null : 'not a four-view sheet',
    },
    {
        task: 'Edit something generated elsewhere',
        how: '`import` welds a GLB/glTF/OBJ/STL (base64 `data`, or `url`) - or a three.js object already in the scene '
            + '(`object`) - into editable topology; a GLB exported here comes back exact.',
        commands: [
            // a tetrahedron as OBJ text, base64-encoded (the CLI does this for you: `threepipe-modelling import file.obj`)
            {op: 'import', data: 'byB0ZXRyYQp2IDAgMCAwCnYgMSAwIDAKdiAwIDEgMAp2IDAgMCAxCmYgMSAzIDIKZiAxIDIgNApmIDEgNCAzCmYgMiAzIDQK', format: 'obj', name: 'tetra'},
            {op: 'validate', object: 'tetra', spec: {manifold: {closed: true}, counts: {verts: 4, faces: 4}}},
        ],
        check: rs => (rs[1].data as any)?.conforms ? null : 'imported tetrahedron did not validate',
    },
    {
        task: 'Deliver the result',
        how: '`export` a GLB; editable topology rides along in `THREEPIPE_mesh_topology`. For a file that is '
            + 'byte-identical on replay, leave out the viewer config and UUIDs.',
        given: [{op: 'primitive', type: 'cube', name: 'part'}],
        commands: [{op: 'export', format: 'glb', viewerConfig: false, uuids: false}],
        check: rs => data(rs[0]).bytes > 500 ? null : 'export too small',
    },
]

/** The anti-mistake list: imperatives, each from a failure seen in a real build or harness run. */
export const RULES: string[] = [
    'Check a command\'s parameters with `help {command: "<op>"}` before guessing; an unknown parameter fails with "did you mean".',
    'Get indices from `inspect {object, detail: true}`, never by guessing - and inspect again after any topology edit (extrude, inset, bevel, subdivide, delete, weld, poke): indices change. A result\'s `locality.meshes.<name>.verts.renumbered` tells you they did.',
    'Before spending an index on a destructive edit, `look {highlight: {object, edges: [i]}, labels: true}` to see it is the one you mean.',
    'Measure, then validate, then look. A render is not a check: write dimensions as `validate {spec: {bbox: {size: [...]}}}`.',
    'Read `locality` on every mutating result. `local: false` means something outside what you named changed - `diff` or `undo` before going on.',
    '`checkpoint` before a risky chain; `diff {from}` after it; `undo {to}` to rewind.',
    '`primitive {position}` sets the object transform. Live `mirror` and radial `array` work about the object origin - move geometry with `transform {faces}` or `applyTransform` before mirroring about a world axis.',
    '`inspect`\'s `bounds` is the master mesh (what indices address). With modifiers, use `evaluatedBounds` / `worldBounds`, or `measure`.',
    'Prefer live modifiers (`array`, `mirror`, `wireframe`) to baked copies, so the master stays editable.',
    'Name every object; address families with `prefix*`. Never address objects by UUID.',
    'A failed command changes nothing - fix it and resend. `changed: false` means it was a no-op and left no undo step.',
    'Do not hand-place many identical parts: `array` or `sweep` them.',
    'Primitives, lathes and bevels come out flat-shaded, so every facet catches its own highlight: when a part\'s shape is done, `shade {object, mode: "byAngle"}` it (fillets read as curves, corners above 30 degrees stay sharp). The realism benchmark measured 85 % faceting on the camera demo against 21 % on the artist model.',
]
