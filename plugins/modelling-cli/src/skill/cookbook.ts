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
        task: 'A knurled ring, dial, button, rocker, eyecup or strap lug: use a part',
        how: '`part` builds a parametric part (real ribs and knurls, smoothed by angle) along +y; `rotation` turns it, '
            + '`part {name, params}` regenerates it with new numbers. `part {list: true}` gives every schema.',
        commands: [{op: 'part', type: 'product/knurled-ring', name: 'focus-ring', params: {radius: 38, length: 14, ribs: 72},
            position: [0, 0, 90], rotation: [Math.PI / 2, 0, 0]}],
        check: rs => rs[0].ok && (rs[0].data as any).groups.knurl.faces === 288 ? null : rs[0].error ?? 'no knurl group',
    },
    {
        task: 'A panel line or seam round a cover, door or control',
        how: '`groove` sweeps a round section along a rounded-rectangle `outline` (or a `path`), drops it onto a curved '
            + 'body with `project`, and cuts it with the Manifold boolean; `fill` lays a dark gap strip in it. The body must '
            + 'be closed and manifold.',
        given: [{op: 'primitive', type: 'cube', name: 'body', size: 20}],
        commands: [{op: 'groove', object: 'body', outline: {at: [0, 0, 10], normal: [0, 0, 1], size: [12, 8], radius: 2}, width: 0.6, depth: 0.4, fill: true}],
        check: rs => rs[0].ok && (rs[0].data as any).strip === 'body-gap' ? null : rs[0].error ?? 'no gap strip',
    },
    {
        task: 'Make a surface read as leather, rubber, satin plastic, metal or glass',
        how: '`uv {size}` first - the relief tile size: 14 for leather, 8 for plastic grain, 6 for rubber, in mm - then '
            + '`material {preset}`. Presets carry measured colour, roughness, metalness and transmission; relief maps are '
            + 'textures, so they need a browser session (a Node session warns and skips them).',
        given: [{op: 'primitive', type: 'cube', name: 'grip', size: 30}],
        commands: [{op: 'uv', object: 'grip', size: 14}, {op: 'material', object: 'grip', preset: 'leather-black'}],
        check: rs => rs.every(r => r.ok) ? null : rs.find(r => !r.ok)!.error!,
    },
    {
        task: 'Printed text, a logo or a legend on a surface',
        how: '`decal` makes a thin textured object from `content.text` or `content.svg`: `plane` on a flat face, `project` '
            + 'onto a curved body (cells that miss are left out), `wrap` round a ring; `emboss` raises it. Rasterised in a '
            + 'browser session; a Node session builds only the geometry.',
        given: [{op: 'primitive', type: 'sphere', name: 'barrel', radius: 10, segments: 48, rings: 24}],
        commands: [{op: 'decal', name: 'label', mode: 'project', object: 'barrel', at: [0, 0, 10], normal: [0, 0, 1], size: [8, 2], content: {text: {text: 'ZOOM'}}}],
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

/**
 * The realism kit, in the order to use it - from the camera benchmark (16-realism.md §3.3-3.4): what moved a
 * hand-built product towards the artist model, and what each tool is for.
 */
export const REALISM_KIT: string[] = [
    '**Measure first.** Published dimensions, standard interfaces (mounts, threads, ISO sizes) and photographs placed to scale with `reference {calibrate}`, each with source and uncertainty. A photo only measures the axes it faces square-on.',
    '**Block the masses as subdivision cages** (`modifier {add: {type: "subsurf"}}`; `crease` for crisp rims), fitted to the measured outlines, and check the silhouettes against the photos (`camera {view: "ref:<name>"}` + `look`) before any detail. Proportions are fixed here or nowhere.',
    '**Parts for recurring components**: `part` builds knurled rings, dials, buttons, rockers, raised pads, eyecups, strap lugs and lens barrels with real ribs and rounded edges (`part {list: true}` for the schemas). Do not hand-lathe knurling or hand-place 60 ribs. `part {name, params}` adjusts one until something else edits it.',
    '**Panel lines and seams**: `groove` round covers, doors and screens (`outline`, `project` on curved bodies, `fill` for the dark strip). Real seams are what make a shell read as an assembled product.',
    '**Shading**: `shade {mode: "byAngle"}` everywhere, `weightedNormal` on bevelled hard parts.',
    '**Surfaces**: `uv {size}` at the relief tile size (leather 14, plastic grain 8, rubber 6, in mm), then `material {preset}`. Glass is clear (`glass`, `glass-coated`) with something dark behind it - a baffle, inner elements - or it shows what is behind it.',
    '**Markings last**: `decal` - `plane` for flat faces, `project` for curved ones, `wrap` round rings; `emboss` for raised or engraved type. Generic fonts; prints and relief maps need a browser session.',
    '**Judge on renders against the reference.** Full-render SSIM rewards flat dark areas and penalises detail that is not pixel-registered with the reference; a sheet of full and clay renders is the better judge of markings and materials.',
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
    'For smooth, product-like forms model a low-poly cage and add `modifier {object, add: {type: "subsurf", levels: 2}}` (Blender\'s Subdivision Surface, limit surface on); keep panel lines and rims crisp with `crease {object, edges, value: 1}` (or 0.3-0.7 for a softened edge) instead of hand-made support loops.',
    'Holes, ports, recesses and slots: model the cutter as its own closed primitive placed where the cut goes, then `boolean {object, with: cutter}` (Blender\'s Manifold solver; DIFFERENCE by default, the cutter is deleted). Both sides must be closed and manifold; a single quad cutter trims along its plane.',
    'Measure before detailing: fit the big masses to published numbers and calibrated photos first. A photo is only good for the axes it faces square-on - a shot from above moves anything higher towards the far edge, so read heights from a level front view and depths only from features on one plane. On the camera demo, refitting the body, prism and grip cages to the front photograph took the silhouette overlap from 0.965 to 0.990 and the measurements moved the top controls further than any detailing would have: the mode dial 7 mm back and 3.8 mm taller, the main dial turned to roll front to back, the top LCD 13 mm wider.',
    'Surfaces and markings last, once the form is right: `uv {object, size}` then `material {preset}` (leather, rubber, satin plastic carry a tiling relief map; glass and metals set transmission and metalness), and printed text, logos and legends as `decal` objects - `project` onto a curved body, `wrap` round a lens. Relief maps and prints are textures: run those commands in a browser session (a Node session warns and leaves them out).',
    'Primitives, lathes and bevels come out flat-shaded, so every facet catches its own highlight: when a part\'s shape is done, `shade {object, mode: "byAngle"}` it (fillets read as curves, corners above 30 degrees stay sharp). The realism benchmark measured 85 % faceting on the camera demo against 21 % on the artist model.',
]
