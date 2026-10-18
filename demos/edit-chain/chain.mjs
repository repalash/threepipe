/**
 * The edit chain, as data.
 *
 * `main` is the 30-step chain on one mesh: a 16-segment cylinder becomes a chess rook - cup, crown,
 * waist, foot, crenellations, an arrow slit, mirrored from one half. The side chains are the
 * commands that do not belong on that object (generators, multi-object commands, scene and session
 * commands) and the side quests the brief asks for.
 *
 * Each step is `{n, title, target, command, claim, expect}`:
 *
 * - `command` is a command object, a list of them, or a function of the pre-step context returning
 *   one. Selections are written as geometry (`q.faces(i => i.n[1] > 0.99)`) rather than as indices,
 *   so inserting a step earlier does not silently retarget every later one; the resolved command is
 *   what `results.json` records, so a run is still replayable as plain JSON.
 * - `claim` is what the step says it touches, in the pre-step mesh: `verts` that may move or vanish,
 *   `faces` that may change, `edges` that may go, `attrs` (layer names) that may change anywhere,
 *   `all` for a whole-mesh operation, `object` (fields of the target: name, transform, material,
 *   modifiers), `anyObject` (fields any object may change), `creates` / `removes` (object names) and
 *   `scene` (lights, references, displayMode, environmentIntensity, background). Everything outside
 *   it must come out bit-identical; see `topology.mjs` `localityDiff`.
 * - `expect` is what the step should have done: `counts` (absolute, or `{delta}`), `topology`
 *   (exact values from `measureMesh`), `bbox`, and `check(c)` returning `{what, ok, got, want}`s.
 *   The Blender behaviour an expectation encodes is cited next to it where it is not obvious.
 *
 * `ctx` (pre-step) has `q` (a `query` over the target), `get(name)`, `history` (post-step documents by
 * step id) and `png()`. `c` (post-step) adds `q2`, `postStats`, `preStats`, `result`, `postEntry`,
 * `mesh(doc, name)` and `entry(doc, name)`.
 */

import {decodeMesh, localityDiff, measureMesh, query} from './topology.mjs'

const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t
const ck = (what, ok, got, want) => ({what, ok, got, want})
const range = n => Array.from({length: n}, (_, i) => i)
const f32 = Math.fround

/** Same geometry and attributes, up to renumbering: no collateral either way and equal counts. */
function sameGeometry(a, b, label) {
    if (!a || !b) return ck(label, false, 'missing mesh')
    const ab = localityDiff(a, b, {}).collateral.length
    const ba = localityDiff(b, a, {}).collateral.length
    const counts = [a.vertsNum === b.vertsNum, a.edgesNum === b.edgesNum, a.facesNum === b.facesNum].every(Boolean)
    return ck(label, ab === 0 && ba === 0 && counts,
        `${ab}+${ba} unmatched elements, counts ${b.vertsNum}/${b.edgesNum}/${b.facesNum} vs ${a.vertsNum}/${a.edgesNum}/${a.facesNum}`)
}

const meshAt = (c, step, name) => c.mesh(c.history.get(step), name)
const docAt = (c, step) => c.history.get(step)

// --- selections on the rook -----------------------------------------------------------------------

const topCap = q => q.faces(i => i.n[1] > 0.99 && i.c[1] > 0.79 && i.size === 16)
const faceYRange = (q, f) => {
    const ys = q.faceVerts(f).map(v => q.pos(v)[1])
    return [Math.min(...ys), Math.max(...ys)]
}
const facesOfEdges = (q, edges) => [...new Set(edges.flatMap(e => q.edgeFaces(e)))]
const bottomNgon = q => q.faces(i => i.n[1] < -0.99 && i.size >= 9)
/** Apothem of a horizontal polygon about the Y axis: mean distance from the axis to edge midpoints. */
function apothem(q, f) {
    const vs = q.faceVerts(f)
    let s = 0
    for (let i = 0; i < vs.length; i++) {
        const a = q.pos(vs[i]), b = q.pos(vs[(i + 1) % vs.length])
        s += Math.hypot((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)
    }
    return s / vs.length
}
/** Which of the 16 angular slots a rim face's centre sits in, slot k spanning [22.5k, 22.5(k+1)). */
const slot = (q, f) => {
    const c = q.faceCenter(f)
    let a = Math.atan2(c[0], c[2]) * 180 / Math.PI
    if (a < 0) a += 360
    return Math.floor(a / 22.5)
}
/** Merlon slots, symmetric under x -> -x (slot k -> 15 - k), so the mirror at step 23 rebuilds them. */
const MERLON_SLOTS = [15, 0, 3, 4, 7, 8, 11, 12]
const rimFaces = q => q.faces(i => i.n[1] > 0.99 && near(i.c[1], 0.8, 1e-4) && i.size === 4)
const slitBandFace = q => q.faces(i => Math.abs(i.n[1]) < 0.01 && i.c[1] > 0.45 && i.c[1] < 0.8
    && i.n[0] < -0.97 && i.c[2] > 0 && i.r > 0.5)
/** Faces whose normal is the slit's and whose vertices all sit strictly inside the band. */
const slitInner = q => q.faces(i => Math.abs(i.n[1]) < 0.01 && i.n[0] < -0.97 && i.c[2] > 0 && i.size === 4
    && q.faceVerts(i.f).every(v => q.pos(v)[1] > 0.46 && q.pos(v)[1] < 0.79))

// --- the main chain ---------------------------------------------------------------------------------

const main = {
    id: 'main', name: 'Main chain: cylinder to chess rook (30 steps)',
    steps: [
        {
            n: 1, title: 'primitive: 16-sided cylinder', target: 'body',
            claimText: 'creates "body": 32 verts, 48 edges, 18 faces (16 quads + two 16-gon caps), closed, with UVs',
            command: {op: 'primitive', type: 'cylinder', name: 'body', segments: 16, radius: 0.5, height: 1.6, color: '#d8cfbd', uvs: true},
            claim: {creates: ['body']},
            expect: {
                counts: {verts: 32, edges: 48, faces: 18, quads: 16, ngons: 2},
                topology: {closed: true, euler: 2, boundaryLoops: 0, genus: 0},
                bbox: {min: [-0.5, -0.8, -0.5], max: [0.5, 0.8, 0.5], tol: 1e-6},
                check: c => [ck('a corner UV layer, so every later step\'s locality check covers UVs', c.postStats.layers.includes('uv'), c.postStats.layers)],
            },
        },
        {
            n: 2, title: 'rename body -> rook', target: 'body',
            claimText: 'only the name changes',
            command: {op: 'rename', object: 'body', name: 'rook'},
            claim: {object: ['name']},
            expect: {check: c => [
                ck('object is now "rook"', c.postEntry?.name === 'rook', c.postEntry?.name),
                ck('no object is called "body"', !c.post.entries.some(e => e.name === 'body'), c.post.entries.map(e => e.name)),
            ]},
        },
        {
            n: 3, title: 'inset the top cap by 0.1', target: 'rook',
            claimText: 'top cap only: a 16-gon 0.1 in from the rim, ringed by 16 quads; no vertex moves',
            command: ({q}) => ({op: 'inset', object: 'rook', faces: topCap(q), thickness: 0.1}),
            claim: ({q}) => ({faces: topCap(q)}),
            expect: {
                counts: {verts: {delta: 16}, edges: {delta: 32}, faces: {delta: 16}},
                topology: {closed: true, euler: 2},
                check: c => {
                    const inner = topCap(c.q2)
                    const want = 0.5 * Math.cos(Math.PI / 16) - 0.1
                    return [ck('one inner 16-gon on top', inner.length === 1, inner.length),
                        ck('its edges sit 0.1 inside the rim (even offset)', inner.length === 1 && near(apothem(c.q2, inner[0]), want), inner.length ? apothem(c.q2, inner[0]) : null, want)]
                },
            },
        },
        {
            n: 4, title: 'extrude the inner cap down 0.3: the cup', target: 'rook',
            claimText: 'the inner cap is replaced by a floor 0.3 lower plus 16 wall quads',
            command: ({q}) => ({op: 'extrude', object: 'rook', faces: topCap(q), distance: -0.3}),
            claim: ({q}) => ({faces: topCap(q)}),
            expect: {
                counts: {verts: {delta: 16}, edges: {delta: 32}, faces: {delta: 16}},
                topology: {closed: true, euler: 2, inconsistentWinding: 0},
                check: c => {
                    const floor = c.q2.faces(i => i.n[1] > 0.99 && i.size === 16 && near(i.c[1], 0.5))
                    return [ck('cup floor: a 16-gon facing up at y = 0.5', floor.length === 1, floor.length)]
                },
            },
        },
        {
            n: 5, title: 'subdivide the 16 side edges', target: 'rook',
            claimText: 'side quads split at mid-height; caps and cup untouched',
            command: ({q}) => ({op: 'subdivide', object: 'rook', edges: q.edges(i => i.dy > 1.5 && i.ra > 0.49 && i.rb > 0.49), cuts: 1}),
            claim: ({q}) => ({faces: facesOfEdges(q, q.edges(i => i.dy > 1.5 && i.ra > 0.49 && i.rb > 0.49))}),
            expect: {
                counts: {verts: {delta: 16}, edges: {delta: 32}, faces: {delta: 16}},
                topology: {closed: true, euler: 2},
                check: c => {
                    const ring = c.q2.verts_(i => i.p[1] === 0 && near(i.r, 0.5))
                    return [ck('16 new vertices at y = 0, r = 0.5 (edge midpoints)', ring.length === 16, ring.length)]
                },
            },
        },
        {
            n: 6, title: 'move the new ring up to y = 0.45', target: 'rook',
            claimText: 'the 16 ring vertices only',
            command: ({q}) => ({op: 'transform', object: 'rook', verts: q.verts_(i => i.p[1] === 0 && i.r > 0.49), move: [0, 0.45, 0]}),
            claim: ({q}) => ({verts: q.verts_(i => i.p[1] === 0 && i.r > 0.49)}),
            expect: {
                counts: {verts: {delta: 0}, edges: {delta: 0}, faces: {delta: 0}},
                check: c => [ck('16 vertices now at y = 0.45', c.q2.verts_(i => near(i.p[1], 0.45) && i.r > 0.49).length === 16,
                    c.q2.verts_(i => near(i.p[1], 0.45) && i.r > 0.49).length)],
            },
        },
        {
            n: 7, title: 'flare the crown band x1.12', target: 'rook',
            claimText: 'the band\'s 32 vertices scale out about the band centre',
            command: ({q}) => ({op: 'transform', object: 'rook',
                faces: q.faces(i => i.c[1] > 0.45 && i.c[1] < 0.8 && i.r > 0.45 && Math.abs(i.n[1]) < 0.01),
                scale: [1.12, 1, 1.12], pivot: [0, 0.625, 0]}),
            claim: ({q}) => ({verts: q.vertsOfFaces(q.faces(i => i.c[1] > 0.45 && i.c[1] < 0.8 && i.r > 0.45 && Math.abs(i.n[1]) < 0.01))}),
            expect: {
                counts: {verts: {delta: 0}, faces: {delta: 0}},
                check: c => {
                    const flared = c.q2.verts_(i => (near(i.p[1], 0.45) || near(i.p[1], 0.8)) && near(i.r, 0.56, 2e-5))
                    return [ck('32 band vertices at r = 0.56', flared.length === 32, flared.length)]
                },
            },
        },
        {
            n: 8, title: 'subdivide the lower side edges', target: 'rook',
            claimText: 'lower side quads split; a ring at y = -0.175',
            command: ({q}) => ({op: 'subdivide', object: 'rook', edges: q.edges(i => near(i.dy, 1.25, 1e-4) && i.ra > 0.49 && i.rb > 0.49)}),
            claim: ({q}) => ({faces: facesOfEdges(q, q.edges(i => near(i.dy, 1.25, 1e-4) && i.ra > 0.49 && i.rb > 0.49))}),
            expect: {
                counts: {verts: {delta: 16}, edges: {delta: 32}, faces: {delta: 16}},
                topology: {closed: true, euler: 2},
                check: c => [ck('16 vertices at y = -0.175', c.q2.verts_(i => near(i.p[1], -0.175) && i.r > 0.5).length === 16,
                    c.q2.verts_(i => near(i.p[1], -0.175) && i.r > 0.5).length)],
            },
        },
        {
            n: 9, title: 'pinch the waist x0.8', target: 'rook',
            claimText: 'the y = -0.175 ring only',
            command: ({q}) => ({op: 'transform', object: 'rook', verts: q.verts_(i => near(i.p[1], -0.175) && i.r > 0.5), scale: [0.8, 1, 0.8], pivot: [0, -0.175, 0]}),
            claim: ({q}) => ({verts: q.verts_(i => near(i.p[1], -0.175) && i.r > 0.5)}),
            expect: {check: c => [ck('waist ring at r = 0.424', c.q2.verts_(i => near(i.p[1], -0.175) && near(i.r, 0.424, 2e-5)).length === 16,
                c.q2.verts_(i => near(i.p[1], -0.175)).map(v => +Math.hypot(c.q2.pos(v)[0], c.q2.pos(v)[2]).toFixed(6)).slice(0, 3))]},
        },
        {
            n: 10, title: 'bisect at y = -0.55 (no fill, nothing cleared)', target: 'rook',
            claimText: 'only the 16 faces the plane crosses are split',
            command: {op: 'bisect', object: 'rook', planeCo: [0, -0.55, 0], planeNo: [0, 1, 0]},
            claim: ({q}) => ({faces: q.faces(i => {
                const [lo, hi] = faceYRange(q, i.f)
                return lo < -0.55 && hi > -0.55
            })}),
            expect: {
                counts: {verts: {delta: 16}, edges: {delta: 32}, faces: {delta: 16}},
                topology: {closed: true, euler: 2},
                check: c => [ck('16 cut vertices on the plane', c.q2.verts_(i => near(i.p[1], -0.55, 1e-6)).length === 16,
                    c.q2.verts_(i => near(i.p[1], -0.55, 1e-6)).length)],
            },
        },
        {
            n: 11, title: 'swell the foot ring x1.15', target: 'rook',
            claimText: 'the y = -0.55 ring only',
            command: ({q}) => ({op: 'transform', object: 'rook', verts: q.verts_(i => near(i.p[1], -0.55, 1e-6)), scale: [1.15, 1, 1.15], pivot: [0, -0.55, 0]}),
            claim: ({q}) => ({verts: q.verts_(i => near(i.p[1], -0.55, 1e-6))}),
            expect: {check: c => {
                const r = c.q2.verts_(i => near(i.p[1], -0.55, 1e-6)).map(v => Math.hypot(c.q2.pos(v)[0], c.q2.pos(v)[2]))
                return [ck('foot ring r = 1.15 x 0.4696', r.every(x => near(x, 1.15 * (0.5 - 0.076 * 0.25 / 0.625), 1e-4)), r[0])]
            }},
        },
        {
            n: 12, title: 'bevel the bottom rim: 3 segments, 0.04', target: 'rook',
            claimText: 'the 16 rim edges and the faces at their vertices: a rounded foot edge (Mark Seams on: no seams to continue)',
            command: ({q}) => ({op: 'bevel', object: 'rook', offset: 0.04, segments: 3, markSeam: true,
                edges: q.edges(i => i.dy === 0 && near(i.a[1], -0.8, 1e-6) && i.ra > 0.45 && i.rb > 0.45)}),
            claim: ({q}) => ({verts: q.vertsOfEdges(q.edges(i => i.dy === 0 && near(i.a[1], -0.8, 1e-6) && i.ra > 0.45 && i.rb > 0.45))}),
            expect: {
                // Each rim vertex (two bevelled edges, one not) becomes a profile of segments + 1 = 4.
                counts: {verts: {delta: 48}, edges: {delta: 96}, faces: {delta: 48}},
                topology: {closed: true, euler: 2},
                check: c => {
                    const seam = c.postMesh.layers.get('uv_seam')
                    const n = seam ? seam.data.reduce((a, x) => a + (x ? 1 : 0), 0) : 0
                    // Mark Seams continues seams that already cross the bevel (`bmesh_bevel.cc:3183`
                    // set_bound_vert_seams -> check_edge_data_seam_sharp_edges, keyed on BM_ELEM_SEAM).
                    // The rook has none, so Blender marks nothing.
                    return [ck('no seams to continue, so none are marked (Blender)', n === 0, n)]
                },
            },
        },
        {
            n: 13, title: 'connectVertices across the bottom 16-gon', target: 'rook',
            claimText: 'the bottom n-gon splits into two 9-gons; nothing moves',
            command: ({q}) => {
                const f = bottomNgon(q)[0]
                const fv = q.faceVerts(f)
                return {op: 'connectVertices', object: 'rook', verts: [fv[0], fv[8]]}
            },
            claim: ({q}) => ({faces: bottomNgon(q)}),
            expect: {
                counts: {verts: {delta: 0}, edges: {delta: 1}, faces: {delta: 1}},
                check: c => {
                    const sizes = c.q2.faces(i => i.n[1] < -0.99).map(f => c.q2.faceSize(f)).sort()
                    return [ck('two 9-gons on the bottom', JSON.stringify(sizes) === '[9,9]', sizes)]
                },
            },
        },
        {
            n: 14, title: 'dissolveElements that edge again', target: 'rook',
            claimText: 'the cut edge and its two faces; the result must equal step 12 exactly',
            command: ({q}) => ({op: 'dissolveElements', object: 'rook',
                edges: q.edges(i => i.faces === 2 && q.edgeFaces(i.e).every(f => q.faceNormal(f)[1] < -0.99))}),
            claim: ({q}) => {
                const e = q.edges(i => i.faces === 2 && q.edgeFaces(i.e).every(f => q.faceNormal(f)[1] < -0.99))
                return {edges: e, faces: facesOfEdges(q, e)}
            },
            expect: {
                counts: {verts: {delta: 0}, edges: {delta: -1}, faces: {delta: -1}},
                check: c => [sameGeometry(meshAt(c, 'main-12', 'rook'), c.postMesh, 'connect + dissolve is a round trip to step 12')],
            },
        },
        {
            n: 15, title: 'deleteElements ONLY_FACE: open the bottom', target: 'rook',
            claimText: 'the bottom 16-gon goes, its rim stays: one boundary loop',
            command: ({q}) => ({op: 'deleteElements', object: 'rook', faces: bottomNgon(q), type: 'ONLY_FACE'}),
            claim: ({q}) => ({faces: bottomNgon(q)}),
            expect: {
                counts: {verts: {delta: 0}, edges: {delta: 0}, faces: {delta: -1}},
                topology: {boundaryLoops: 1, euler: 1},
            },
        },
        {
            n: 16, title: 'gridFill the bottom hole', target: 'rook',
            claimText: 'new quads only; no existing element changes',
            command: ({q}) => ({op: 'gridFill', object: 'rook', edges: q.boundaryEdges()}),
            claim: {},
            expect: {
                topology: {closed: true, boundaryLoops: 0, euler: 2},
                check: c => [ck('every new face is a quad', c.postStats.quads - c.preStats.quads === c.result.data.newFaces
                    && c.postStats.faces - c.preStats.faces === c.result.data.newFaces, {newFaces: c.result.data.newFaces, span: c.result.data.span})],
            },
        },
        {
            n: 17, title: 'extrude 4 merlons up 0.22', target: 'rook',
            claimText: '8 rim quads (4 pairs) rise; their old positions become merlon walls',
            command: ({q}) => ({op: 'extrude', object: 'rook', faces: rimFaces(q).filter(f => MERLON_SLOTS.includes(slot(q, f))), distance: 0.22}),
            claim: ({q}) => ({faces: rimFaces(q).filter(f => MERLON_SLOTS.includes(slot(q, f)))}),
            expect: {
                counts: {verts: {delta: 24}, edges: {delta: 48}, faces: {delta: 24}},
                topology: {closed: true, euler: 2},
                check: c => [ck('8 merlon tops at y = 1.02', c.q2.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.02, 1e-4)).length === 8,
                    c.q2.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.02, 1e-4)).length)],
            },
        },
        {
            n: 18, title: 'inset each merlon top, recessed 0.015', target: 'rook',
            claimText: 'the 8 merlon tops only, each separately',
            command: ({q}) => ({op: 'inset', object: 'rook', faces: q.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.02, 1e-4)),
                thickness: 0.02, depth: -0.015, individual: true}),
            claim: ({q}) => ({faces: q.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.02, 1e-4))}),
            expect: {
                counts: {verts: {delta: 32}, edges: {delta: 64}, faces: {delta: 32}},
                topology: {closed: true, euler: 2},
                check: c => [ck('8 recessed tops at y = 1.005', c.q2.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.005, 1e-4)).length === 8,
                    c.q2.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.005, 1e-4)).length)],
            },
        },
        {
            n: 19, title: 'bisect at x = 0, clear the +x half', target: 'rook',
            claimText: 'everything with x > 0 goes; the -x half stays bit-identical; one open seam loop',
            command: {op: 'bisect', object: 'rook', planeCo: [0, 0, 0], planeNo: [1, 0, 0], clearOuter: true},
            claim: ({q}) => ({verts: q.verts_(i => i.p[0] > 1e-4), faces: q.faces(i => q.faceVerts(i.f).some(v => q.pos(v)[0] > 1e-4))}),
            expect: {
                topology: {boundaryLoops: 1, nonManifoldEdges: 0},
                check: c => [ck('no vertex left with x > 1e-4', c.q2.verts_(i => i.p[0] > 1e-4).length === 0, c.q2.verts_(i => i.p[0] > 1e-4).length)],
            },
        },
        {
            n: 20, title: 'inset a slit panel on the crown', target: 'rook',
            claimText: 'one band quad facing -x',
            command: ({q}) => ({op: 'inset', object: 'rook', faces: slitBandFace(q).slice(0, 1), thickness: 0.035}),
            claim: ({q}) => ({faces: slitBandFace(q).slice(0, 1)}),
            expect: {counts: {verts: {delta: 4}, edges: {delta: 8}, faces: {delta: 4}}},
        },
        {
            n: 21, title: 'extrude the slit panel 0.05 inward', target: 'rook',
            claimText: 'the inset panel only',
            command: ({q}) => ({op: 'extrude', object: 'rook', faces: slitInner(q).slice(0, 1), distance: -0.05}),
            claim: ({q}) => ({faces: slitInner(q).slice(0, 1)}),
            expect: {
                counts: {verts: {delta: 4}, edges: {delta: 8}, faces: {delta: 4}},
                topology: {boundaryLoops: 1, inconsistentWinding: 0},
            },
        },
        {
            n: 22, title: 'vertices: drop the slit floor\'s lower edge 0.03', target: 'rook',
            claimText: 'two vertices move by exactly (0, -0.03, 0)',
            command: ({q}) => {
                const floor = q.faces(i => Math.abs(i.n[1]) < 0.01 && i.n[0] < -0.97 && i.c[2] > 0 && i.size === 4)
                    .sort((a, b) => Math.hypot(q.faceCenter(a)[0], q.faceCenter(a)[2]) - Math.hypot(q.faceCenter(b)[0], q.faceCenter(b)[2]))[0]
                const low = q.faceVerts(floor).sort((a, b) => q.pos(a)[1] - q.pos(b)[1]).slice(0, 2)
                return {op: 'vertices', object: 'rook', relative: true, verts: low.map(v => [v, 0, -0.03, 0])}
            },
            claim: ({q}) => {
                const floor = q.faces(i => Math.abs(i.n[1]) < 0.01 && i.n[0] < -0.97 && i.c[2] > 0 && i.size === 4)
                    .sort((a, b) => Math.hypot(q.faceCenter(a)[0], q.faceCenter(a)[2]) - Math.hypot(q.faceCenter(b)[0], q.faceCenter(b)[2]))[0]
                return {verts: q.faceVerts(floor).sort((a, b) => q.pos(a)[1] - q.pos(b)[1]).slice(0, 2)}
            },
            expect: {check: c => {
                const moved = c.command.verts.map(([v]) => [c.q.pos(v), c.q2.pos(v)])
                return [ck('both moved by exactly -0.03 in y (float32), x and z unchanged',
                    moved.every(([a, b]) => b[1] === f32(a[1] - 0.03) && b[0] === a[0] && b[2] === a[2]), moved.map(([, b]) => b))]
            }},
        },
        {
            n: 23, title: 'modifier: live mirror on x', target: 'rook',
            claimText: 'the master mesh is unchanged; the evaluated mesh is the closed rook',
            command: {op: 'modifier', object: 'rook', add: {type: 'mirror', axis: 'x'}},
            claim: {object: ['modifiers']},
            expect: {check: c => {
                const ev = c.postEntry.evaluatedMesh ? measureMesh(decodeMesh(c.postEntry.evaluatedMesh)) : null
                return [ck('evaluated mesh is closed, Euler 2', !!ev && ev.closed && ev.euler === 2 && ev.boundaryLoops === 0,
                    ev && {closed: ev.closed, euler: ev.euler, boundaryLoops: ev.boundaryLoops, nonManifold: ev.nonManifoldEdges})]
            }},
        },
        {
            n: 24, title: 'modifier: apply the mirror', target: 'rook',
            claimText: 'the master becomes exactly the evaluated mesh of step 23',
            command: {op: 'modifier', object: 'rook', apply: true},
            claim: {all: true, object: ['modifiers']},
            expect: {
                topology: {closed: true, euler: 2, boundaryLoops: 0, nonManifoldEdges: 0},
                check: c => {
                    const ev = decodeMesh(c.entry(docAt(c, 'main-23'), 'rook').evaluatedMesh)
                    const b = c.postStats.bbox
                    return [sameGeometry(ev, c.postMesh, 'master equals the step-23 evaluated mesh'),
                        ck('symmetric in x', near(b.min[0], -b.max[0], 1e-6), [b.min[0], b.max[0]])]
                },
            },
        },
        {
            n: 25, title: 'material: dark stone', target: 'rook',
            claimText: 'colour, roughness, metalness of the rook\'s material; the mesh is untouched',
            command: {op: 'material', object: 'rook', color: '#3a3a40', roughness: 0.4, metalness: 0.15},
            claim: {object: ['material']},
            expect: {check: c => [ck('material set', c.postEntry.material.color === '3a3a40' && near(c.postEntry.material.roughness, 0.4) && near(c.postEntry.material.metalness, 0.15), c.postEntry.material)]},
        },
        {
            n: 26, title: 'transform the object: stand it on the ground', target: 'rook',
            claimText: 'object position only; vertex ids and positions untouched',
            command: {op: 'transform', object: 'rook', move: [0, 0.8, 0]},
            claim: {object: ['transform']},
            expect: {check: c => [ck('position (0, 0.8, 0)', c.postEntry.transform.position.every((x, i) => near(x, [0, 0.8, 0][i], 1e-12)), c.postEntry.transform.position)]},
        },
        {
            n: 27, title: 'applyTransform', target: 'rook',
            claimText: 'every vertex moves by exactly the object offset; the transform resets; the indices stay',
            command: {op: 'applyTransform', object: 'rook'},
            claim: {all: true, object: ['transform']},
            expect: {
                counts: {verts: {delta: 0}, edges: {delta: 0}, faces: {delta: 0}},
                check: c => {
                    let bad = 0
                    for (let v = 0; v < c.preMesh.vertsNum; v++) {
                        const a = c.q.pos(v), b = c.q2.pos(v)
                        if (b[0] !== a[0] || b[2] !== a[2] || b[1] !== f32(a[1] + 0.8)) bad++
                    }
                    const t = c.postEntry.transform
                    return [ck('vertex v moved by (0, 0.8, 0), same index', bad === 0, `${bad} vertices off`),
                        ck('transform is identity', t.position.every(x => x === 0) && t.scale.every(x => x === 1) && t.quaternion[3] === 1, t)]
                },
            },
        },
        {
            n: 28, title: 'dissolveLimited the bottom grid', target: 'rook',
            claimText: 'the flat bottom grid becomes one n-gon; its interior vertices go, its outline stays',
            command: ({q}) => ({op: 'dissolveLimited', object: 'rook', faces: q.faces(i => i.n[1] < -0.99 && near(i.c[1], 0, 1e-4)), angleLimit: 5}),
            claim: ({q}) => {
                const f = q.faces(i => i.n[1] < -0.99 && near(i.c[1], 0, 1e-4))
                return {faces: f, verts: q.interiorVerts(f), edges: q.edgesOfFaces(f)}
            },
            expect: {
                topology: {closed: true, euler: 2},
                check: c => {
                    const b = c.q2.faces(i => i.n[1] < -0.99 && near(i.c[1], 0, 1e-4))
                    return [ck('one bottom face, a 16-gon', b.length === 1 && c.q2.faceSize(b[0]) === 16, b.map(f => c.q2.faceSize(f)))]
                },
            },
        },
        {
            n: 29, title: 'deleteElements ONLY_FACE: one merlon recess', target: 'rook',
            claimText: 'one face goes; a 4-edge hole',
            command: ({q}) => ({op: 'deleteElements', object: 'rook', type: 'ONLY_FACE',
                faces: q.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.805, 1e-4)).sort((a, b) => q.faceCenter(b)[0] - q.faceCenter(a)[0]).slice(0, 1)}),
            claim: ({q}) => ({faces: q.faces(i => i.n[1] > 0.99 && near(i.c[1], 1.805, 1e-4)).sort((a, b) => q.faceCenter(b)[0] - q.faceCenter(a)[0]).slice(0, 1)}),
            expect: {counts: {faces: {delta: -1}, edges: {delta: 0}}, topology: {boundaryLoops: 1}},
        },
        {
            n: 30, title: 'makeEdgeFace: fill it again (F)', target: 'rook',
            claimText: 'a new face on the hole: the mesh must equal step 28 exactly, winding included',
            command: ({q}) => ({op: 'makeEdgeFace', object: 'rook', edges: q.boundaryEdges()}),
            claim: {},
            expect: {
                topology: {closed: true, boundaryLoops: 0, inconsistentWinding: 0},
                check: c => [sameGeometry(meshAt(c, 'main-28', 'rook'), c.postMesh, 'delete + F is a round trip to step 28 (geometry, winding, attributes)')],
            },
        },
    ],
}

// --- side chains --------------------------------------------------------------------------------------

const setup = {
    id: 'setup', name: 'Setup: clear the example page\'s demo hull',
    steps: [{
        n: 1, title: 'delete *', command: {op: 'delete', object: '*'},
        claim: {removes: ['hull']}, capture: false,
        expect: {check: c => [ck('document is empty', c.post.entries.length === 0, c.post.entries.map(e => e.name))]},
    }],
}

const generators = {
    id: 'gen', name: 'Generators: lathe and sweep',
    steps: [
        {
            n: 1, title: 'lathe a pawn', target: 'pawn',
            claimText: '9 profile points, 2 on the axis: 7 rings of 16 plus 2 apexes, closed',
            command: {op: 'lathe', name: 'pawn', segments: 16, position: [-2, 0, 0], color: '#e8e0cc',
                profile: [[0, 0], [0.3, 0], [0.3, 0.08], [0.18, 0.15], [0.12, 0.5], [0.2, 0.55], [0.12, 0.6], [0.15, 0.75], [0, 0.9]]},
            claim: {creates: ['pawn']},
            expect: {counts: {verts: 114, faces: 128, edges: 240}, topology: {closed: true, euler: 2, genus: 0}},
        },
        {
            n: 2, title: 'sweep a handle', target: 'handle',
            claimText: '4 path points x 8 sides, capped: 32 verts, 26 faces, closed',
            command: {op: 'sweep', name: 'handle', radius: 0.05, steps: 8, position: [-2, 0, 1.2],
                path: [[0, 0, 0], [0.3, 0.3, 0], [0.6, 0.3, 0], [0.9, 0, 0]]},
            claim: {creates: ['handle']},
            expect: {counts: {verts: 32, faces: 26, edges: 56}, topology: {closed: true, euler: 2}},
        },
        {
            n: 3, title: 'sweep a closed, tapering ring', target: 'hoop',
            claimText: 'closed path: a torus-like tube, genus 1',
            command: {op: 'sweep', name: 'hoop', radius: 0.06, steps: 8, closed: true, position: [-2, 0, 2.4],
                path: [[0, 0, 0], [0.5, 0, 0], [0.5, 0, 0.5], [0, 0, 0.5]], radii: [1, 0.6, 1, 0.6]},
            claim: {creates: ['hoop']},
            expect: {counts: {verts: 32, faces: 32}, topology: {closed: true, euler: 0, genus: 1}},
        },
    ],
}

const arrays = {
    id: 'array', name: 'array and duplicate',
    steps: [
        {n: 1, title: 'primitive cube "link"', target: 'link', command: {op: 'primitive', type: 'cube', name: 'link', size: 0.4, position: [2, 0, -2]},
            claim: {creates: ['link']}, expect: {counts: {verts: 8, faces: 6}}},
        {
            n: 2, title: 'array x4, linear', target: 'link',
            claimText: 'the original cube stays put; three copies 0.6 apart',
            command: {op: 'array', object: 'link', count: 4, step: [0.6, 0, 0]},
            claim: {},
            expect: {counts: {verts: 32, faces: 24}, topology: {shells: 4, closed: true}},
        },
        {
            n: 3, title: 'array x3 radial into objects', target: 'link',
            claimText: 'two new objects, each an exact copy of link\'s mesh; link itself untouched',
            command: {op: 'array', object: 'link', count: 3, angle: Math.PI * 2, pivot: [2, 0, -1], axis: 'y', into: 'objects', name: 'link-r'},
            claim: {creates: ['link-r', 'link-r.001']},
            expect: {check: c => {
                const made = c.post.entries.filter(e => e.name.startsWith('link-r'))
                const src = c.postMesh
                return [ck('two copies', made.length === 2, made.map(e => e.name)),
                    ...made.map(e => sameGeometry(src, decodeMesh(e.mesh), `${e.name} mesh equals link`))]
            }},
        },
        {
            n: 4, title: 'array live: x2 up', target: 'link',
            claimText: 'a modifier only; the master mesh is untouched',
            command: {op: 'array', object: 'link', count: 2, step: [0, 0.6, 0], live: true},
            claim: {object: ['modifiers']},
            expect: {check: c => {
                const ev = c.postEntry.evaluatedMesh ? measureMesh(decodeMesh(c.postEntry.evaluatedMesh)) : null
                return [ck('evaluated mesh: 64 verts, 8 shells', ev?.verts === 64 && ev?.shells === 8, ev && {verts: ev.verts, shells: ev.shells})]
            }},
        },
        {
            n: 5, title: 'duplicate x2, modifiers carried', target: 'link',
            claimText: 'two new objects with link\'s mesh and stack',
            command: {op: 'duplicate', object: 'link', move: [0, 0, 1], count: 2, name: 'link-copy'},
            claim: {creates: ['link-copy', 'link-copy.001']},
            expect: {check: c => {
                const made = c.post.entries.filter(e => e.name.startsWith('link-copy'))
                return [ck('two copies', made.length === 2, made.map(e => e.name)),
                    ...made.map(e => ck(`${e.name} carries the live array`, JSON.stringify(e.modifiers) === JSON.stringify(c.postEntry.modifiers), e.modifiers.length)),
                    ...made.map(e => sameGeometry(c.postMesh, decodeMesh(e.mesh), `${e.name} mesh equals link`))]
            }},
        },
        {
            n: 6, title: 'delete link-r*', claimText: 'exactly the two radial copies',
            command: {op: 'delete', object: 'link-r*'}, claim: {removes: ['link-r', 'link-r.001']}, capture: false,
            expect: {check: c => [ck('gone', !c.post.entries.some(e => e.name.startsWith('link-r')), c.post.entries.map(e => e.name))]},
        },
    ],
}

const mirrorMerge = {
    id: 'mirror', name: 'Side quest: mergeByDistance after mirror',
    steps: [
        {n: 1, title: 'primitive cube "half"', target: 'half', command: {op: 'primitive', type: 'cube', name: 'half', size: 1, uvs: true, position: [0, 0, 3]},
            claim: {creates: ['half']}},
        {
            n: 2, title: 'shift it to x in [0.00005, 1.00005]', target: 'half',
            command: {op: 'transform', object: 'half', verts: range(8), move: [0.50005, 0, 0]},
            claim: {all: true},
            expect: {check: c => [ck('min x = 0.00005', near(c.postStats.bbox.min[0], 0.00005, 1e-7), c.postStats.bbox.min[0])]},
        },
        {
            n: 3, title: 'deleteElements ONLY_FACE: open the -x side', target: 'half',
            command: ({q}) => ({op: 'deleteElements', object: 'half', type: 'ONLY_FACE', faces: q.faces(i => i.n[0] < -0.99)}),
            claim: ({q}) => ({faces: q.faces(i => i.n[0] < -0.99)}),
            expect: {topology: {boundaryLoops: 1}},
        },
        {
            n: 4, title: 'mirror on x, merge distance 0', target: 'half',
            claimText: 'the original half stays bit-identical; a mirrored copy is added; nothing is welded',
            command: {op: 'mirror', object: 'half', axis: 'x', mergeDistance: 0},
            claim: {},
            expect: {counts: {verts: 16, faces: 10}, topology: {boundaryLoops: 2, shells: 2}},
        },
        {
            n: 5, title: 'mergeByDistance 0.001 on every vertex', target: 'half',
            claimText: 'the 8 seam vertices merge pairwise to x = 0; nothing else moves',
            command: ({q}) => ({op: 'mergeByDistance', object: 'half', verts: range(q.verts), threshold: 0.001}),
            claim: ({q}) => ({verts: q.verts_(i => Math.abs(i.p[0]) < 0.001)}),
            expect: {
                counts: {verts: 12, faces: 10, edges: 20},
                topology: {closed: true, euler: 2, boundaryLoops: 0},
                check: c => [ck('removed 4', c.result.data.removed === 4, c.result.data.removed),
                    ck('seam at x = 0 (centroid merge)', c.q2.verts_(i => i.p[0] === 0).length === 4, c.q2.verts_(i => Math.abs(i.p[0]) < 0.01).map(v => c.q2.pos(v)[0]))],
            },
        },
    ],
}

const joinSeparate = {
    id: 'join', name: 'join then separate',
    steps: [
        {n: 1, title: 'primitive sphere "ball"', target: 'ball', command: {op: 'primitive', type: 'sphere', name: 'ball', radius: 0.3, segments: 12, rings: 8, position: [4, 0, 0]},
            claim: {creates: ['ball']}, expect: {topology: {closed: true, euler: 2}}},
        {n: 2, title: 'primitive torus "ring"', target: 'ring', command: {op: 'primitive', type: 'torus', name: 'ring', radius: 0.4, tubeRadius: 0.1, segments: 16, tubeSegments: 8, position: [5, 0, 0]},
            claim: {creates: ['ring']}, expect: {topology: {closed: true, euler: 0}}},
        {
            n: 3, title: 'join ball + ring -> combo', target: 'ball',
            claimText: 'the ball\'s mesh stays; the ring\'s is appended in the ball\'s space; ring is removed',
            command: {op: 'join', objects: ['ball', 'ring'], name: 'combo'},
            claim: {removes: ['ring'], object: ['name']},
            expect: {
                topology: {shells: 2, closed: true},
                check: c => {
                    const ring = c.mesh(c.pre, 'ring')
                    const ball = c.preMesh
                    let bad = 0
                    for (let v = 0; v < ring.vertsNum; v++) {
                        const p = [ring.positions[v * 3] + 1, ring.positions[v * 3 + 1], ring.positions[v * 3 + 2]]
                        const w = ball.vertsNum + v
                        const got = c.q2.pos(w)
                        if (p.some((x, k) => !near(x, got[k], 1e-6))) bad++
                    }
                    return [ck('counts add up', c.postStats.verts === ball.vertsNum + ring.vertsNum && c.postStats.faces === ball.facesNum + ring.facesNum,
                        c.postStats.verts), ck('ring vertices land at their world positions', bad === 0, `${bad} off`)]
                },
            },
        },
        {
            n: 4, title: 'separate combo by loose parts', target: 'combo',
            claimText: 'the torus part leaves as a new object at the same place; combo is the ball again',
            command: {op: 'separate', object: 'combo', mode: 'loose'},
            claim: ({q, stats}) => ({verts: range(q.verts).slice(q.verts - 128), faces: range(stats.faces).slice(stats.faces - 128), creates: ['combo.001']}),
            expect: {check: c => {
                const part = c.post.entries.find(e => e.name === 'combo.001')
                return [sameGeometry(c.mesh(docAt(c, 'join-01'), 'ball'), c.postMesh, 'combo equals the original ball'),
                    ck('combo.001 has the torus counts', !!part && decodeMesh(part.mesh).vertsNum === 128 && decodeMesh(part.mesh).facesNum === 128, part && decodeMesh(part.mesh).vertsNum),
                    ck('combo.001 placed like combo', !!part && JSON.stringify(part.transform) === JSON.stringify(c.postEntry.transform), part?.transform.position)]
            }},
        },
        {n: 5, title: 'delete combo.001', command: {op: 'delete', object: 'combo.001'}, claim: {removes: ['combo.001']}, capture: false},
    ],
}

const ngonSubdiv = {
    id: 'ngon', name: 'Side quests: subdivide an n-gon-heavy mesh, dissolveLimited after subdivide',
    steps: [
        {n: 1, title: 'primitive 8-sided drum', target: 'drum', command: {op: 'primitive', type: 'cylinder', name: 'drum', segments: 8, uvs: true, radius: 0.4, height: 0.5, position: [-4, 0, 0]},
            claim: {creates: ['drum']}, expect: {counts: {verts: 16, edges: 24, faces: 10, ngons: 2}}},
        {
            n: 2, title: 'subdivide every edge', target: 'drum',
            // `bmo_subdivide.cc:1126`: a face with no matching pattern and more than two cut edges keeps
            // its new vertices on its boundary - so each 8-gon cap becomes a 16-gon; side quads with all
            // four edges cut take the 2x2 grid pattern.
            claimText: 'side quads become 2x2 grids; the 8-gon caps become 16-gons (no n-gon pattern, bmo_subdivide.cc:1126)',
            command: {op: 'subdivide', object: 'drum', cuts: 1},
            claim: {all: true},
            expect: {
                counts: {verts: 48, faces: 34, edges: 80},
                topology: {closed: true, euler: 2},
                check: c => {
                    const caps = c.q2.faces(i => Math.abs(i.n[1]) > 0.99)
                    return [ck('two 16-gon caps', caps.length === 2 && caps.every(f => c.q2.faceSize(f) === 16), caps.map(f => c.q2.faceSize(f)))]
                },
            },
        },
        {
            n: 3, title: 'dissolveLimited everything, 5 degrees', target: 'drum',
            claimText: 'collinear vertices and coplanar faces go: back to the original drum exactly',
            command: ({stats}) => ({op: 'dissolveLimited', object: 'drum', faces: range(stats.faces), angleLimit: 5}),
            claim: {all: true},
            expect: {
                counts: {verts: 16, edges: 24, faces: 10},
                check: c => [sameGeometry(meshAt(c, 'ngon-01', 'drum'), c.postMesh, 'subdivide + limited dissolve is a round trip')],
            },
        },
    ],
}

const bevelBoundary = {
    id: 'bevel', name: 'Side quest: bevel, 3 segments, on a boundary edge',
    steps: [
        {n: 1, title: 'primitive 2x2 grid "sheet"', target: 'sheet', command: {op: 'primitive', type: 'grid', name: 'sheet', xSegments: 2, ySegments: 2, size: 1, position: [-4, 0, 2]},
            claim: {creates: ['sheet']}, expect: {counts: {verts: 9, faces: 4}, topology: {boundaryLoops: 1}}},
        {
            n: 2, title: 'bevel a boundary edge, 3 segments', target: 'sheet',
            // `bmo_bevel.cc:57`: only manifold edges are tagged for beveling, so Blender leaves a boundary
            // edge alone. Expected: no change, and the command says so.
            claimText: 'Blender tags only manifold edges (bmo_bevel.cc:57): nothing changes, with a warning',
            command: ({q}) => ({op: 'bevel', object: 'sheet', edges: q.boundaryEdges().slice(0, 1), segments: 3, offset: 0.1}),
            claim: {},
            expect: {
                counts: {verts: {delta: 0}, faces: {delta: 0}},
                check: c => [ck('warns that nothing was beveled', (c.result.warnings ?? []).some(w => /nothing was beveled/.test(w)), c.result.warnings),
                    ck('reports changed: false', c.result.changed === false, c.result.changed)],
            },
        },
        {
            n: 3, title: 'bevel an interior edge, 3 segments', target: 'sheet',
            claimText: 'the edge\'s vertices and their faces only',
            command: ({q}) => ({op: 'bevel', object: 'sheet', edges: q.edges(i => i.faces === 2).slice(0, 1), segments: 3, offset: 0.1}),
            claim: ({q}) => ({verts: q.vertsOfEdges(q.edges(i => i.faces === 2).slice(0, 1))}),
            expect: {check: c => {
                const made = c.result.data.newFaces ?? []
                const quads = made.filter(f => c.q2.faceSize(f) === 4).length
                // The three strip faces are certain; the end faces depend on bmesh_bevel's terminal-edge
                // vmesh at each end (`build_boundary_terminal_edge`), and no Blender fixture pins them here.
                return [ck('the 3-segment strip: at least 3 new quads', quads >= 3, {newFaces: made.length, quads}),
                    ck('total face count matches Blender', null, `${made.length} new faces; no Blender fixture for a terminal edge on a grid`)]
            }},
        },
    ],
}

const bridge = {
    id: 'bridge', name: 'Side quest: bridgeEdgeLoops between two separated loops',
    steps: [
        {n: 1, title: 'open tube, 12 sides', target: 'tube', command: {op: 'primitive', type: 'cylinder', name: 'tube', segments: 12, uvs: true, radius: 0.3, height: 1.2, capEnds: false, position: [-4, 0, 4]},
            claim: {creates: ['tube']}, expect: {counts: {verts: 24, faces: 12}, topology: {boundaryLoops: 2}}},
        {n: 2, title: 'subdivide the long edges x2', target: 'tube',
            command: ({q}) => ({op: 'subdivide', object: 'tube', cuts: 2, edges: q.edges(i => i.dy > 1)}),
            claim: ({q}) => ({faces: facesOfEdges(q, q.edges(i => i.dy > 1))}),
            expect: {counts: {verts: 48, faces: 36}}},
        {
            n: 3, title: 'deleteElements FACE: the middle band', target: 'tube',
            claimText: 'two separate tubes, four open loops',
            command: ({q}) => ({op: 'deleteElements', object: 'tube', faces: q.faces(i => Math.abs(i.c[1]) < 0.01)}),
            claim: ({q}) => ({faces: q.faces(i => Math.abs(i.c[1]) < 0.01), edges: q.edges(i => Math.abs(i.mid[1]) < 0.01)}),
            expect: {counts: {verts: 48, faces: 24}, topology: {boundaryLoops: 4, shells: 2}},
        },
        {
            n: 4, title: 'bridgeEdgeLoops the two facing loops, 1 cut', target: 'tube',
            claimText: 'new faces only; no existing vertex moves; one tube again, planar untwisted quads',
            command: ({q}) => ({op: 'bridgeEdgeLoops', object: 'tube', numberCuts: 1, edges: q.edges(i => i.faces === 1 && Math.abs(i.mid[1]) < 0.3)}),
            claim: {},
            expect: {
                counts: {verts: 60, faces: 48},
                topology: {boundaryLoops: 2, shells: 1, closed: false},
                check: c => {
                    const band = c.q2.faces(i => Math.abs(i.c[1]) < 0.2)
                    return [ck('24 bridge quads, all vertical (untwisted)', band.length === 24 && band.every(f => c.q2.faceSize(f) === 4 && Math.abs(c.q2.faceNormal(f)[1]) < 1e-3), band.length),
                        ck('12 new vertices on y = 0', c.q2.verts_(i => near(i.p[1], 0, 1e-6)).length === 12, c.q2.verts_(i => near(i.p[1], 0, 1e-6)).length)]
                },
            },
        },
    ],
}

const gridFill = {
    id: 'grid', name: 'Side quest: gridFill',
    steps: [
        {n: 1, title: 'primitive 4x4 grid "floor"', target: 'floor', command: {op: 'primitive', type: 'grid', name: 'floor', xSegments: 4, uvs: true, ySegments: 4, size: 2, position: [4, 0, 4]},
            claim: {creates: ['floor']}, expect: {counts: {verts: 25, faces: 16}}},
        {
            n: 2, title: 'deleteElements FACE: the middle 2x2', target: 'floor',
            command: ({q}) => ({op: 'deleteElements', object: 'floor', faces: q.faces(i => Math.abs(i.c[0]) < 0.5 && Math.abs(i.c[2]) < 0.5)}),
            claim: ({q}) => {
                const f = q.faces(i => Math.abs(i.c[0]) < 0.5 && Math.abs(i.c[2]) < 0.5)
                return {faces: f, verts: q.interiorVerts(f), edges: q.edgesOfFaces(f)}
            },
            expect: {counts: {verts: 24, faces: 12}, topology: {boundaryLoops: 2}},
        },
        {
            n: 3, title: 'gridFill the 8-edge hole', target: 'floor',
            claimText: 'four quads and a centre vertex: the original grid again',
            command: ({q}) => ({op: 'gridFill', object: 'floor', edges: q.edges(i => i.faces === 1 && Math.abs(i.mid[0]) < 0.6 && Math.abs(i.mid[2]) < 0.6)}),
            claim: {},
            expect: {
                counts: {verts: 25, faces: 16},
                topology: {boundaryLoops: 1},
                check: c => {
                    const orig = meshAt(c, 'grid-01', 'floor')
                    const centre = c.q2.verts_(i => Math.abs(i.p[0]) < 0.01 && Math.abs(i.p[2]) < 0.01)
                    return [ck('centre vertex at (0, 0, 0) within 1e-6', centre.length === 1 && c.q2.pos(centre[0]).every(x => Math.abs(x) < 1e-6), centre.map(v => c.q2.pos(v))),
                        sameGeometry(orig, c.postMesh, 'grid fill reproduces the deleted faces exactly')]
                },
            },
        },
    ],
}

const connect = {
    id: 'connect', name: 'Side quest: connectVertices across an n-gon',
    steps: [
        {n: 1, title: 'primitive 8-gon disc', target: 'disc', command: {op: 'primitive', type: 'circle', name: 'disc', segments: 8, radius: 0.4, position: [4, 0, -4]},
            claim: {creates: ['disc']}, expect: {counts: {verts: 8, edges: 8, faces: 1}}},
        {
            n: 2, title: 'connectVertices 0 -> 4 (path)', target: 'disc',
            claimText: 'one cut across the n-gon: two 5-gons; no vertex moves',
            command: {op: 'connectVertices', object: 'disc', verts: [0, 4]},
            claim: {faces: [0]},
            expect: {counts: {verts: 8, edges: 9, faces: 2}, check: c => [ck('two 5-gons', c.q2.faces(() => true).map(f => c.q2.faceSize(f)).join() === '5,5', c.q2.faces(() => true).map(f => c.q2.faceSize(f)))]},
        },
        {
            n: 3, title: 'connectVertices pairs 1, 3', target: 'disc',
            claimText: 'the 5-gon holding both splits into a triangle and a quad',
            command: {op: 'connectVertices', object: 'disc', verts: [1, 3], pairs: true},
            claim: ({q}) => ({faces: q.faces(i => q.faceVerts(i.f).includes(1) && q.faceVerts(i.f).includes(3))}),
            expect: {counts: {verts: 8, edges: 10, faces: 3}},
        },
    ],
}

const bisectChain = {
    id: 'cut', name: 'Side quest: bisect through the chain object',
    steps: [
        {
            n: 1, title: 'duplicate the rook', target: 'rook',
            command: {op: 'duplicate', object: 'rook', name: 'rook-cut', move: [1.6, 0, 0]},
            claim: {creates: ['rook-cut']}, captureFit: 'rook-cut',
            expect: {check: c => [sameGeometry(c.postMesh, c.mesh(c.post, 'rook-cut'), 'the copy has the rook\'s mesh')]},
        },
        {
            n: 2, title: 'bisect it at world y = 0.9, fill, clear above', target: 'rook-cut',
            claimText: 'everything above the plane goes; the cut is closed with a face',
            command: {op: 'bisect', object: 'rook-cut', planeCo: [1.6, 0.9, 0], planeNo: [0, 1, 0], fill: true, clearOuter: true},
            claim: ({q}) => ({verts: q.verts_(i => i.p[1] > 0.9 - 1e-4), faces: q.faces(i => q.faceVerts(i.f).some(v => q.pos(v)[1] > 0.9 - 1e-4))}),
            expect: {
                topology: {closed: true, euler: 2, boundaryLoops: 0},
                check: c => [ck('fill faces reported', (c.result.data.fillFaces ?? []).length >= 1, c.result.data.fillFaces),
                    ck('nothing above y = 0.9', c.postStats.bbox.max[1] <= 0.9 + 1e-5, c.postStats.bbox.max[1])],
            },
        },
    ],
}

const pokeWire = {
    id: 'wire', name: 'Side quest: poke + wireframe, and the live wireframe modifier',
    steps: [
        {n: 1, title: 'primitive cube "cage"', target: 'cage', command: {op: 'primitive', type: 'cube', name: 'cage', size: 0.8, position: [0, 0, -4]}, claim: {creates: ['cage']}},
        {n: 2, title: 'poke every face', target: 'cage', claimText: 'each quad becomes a fan of 4 triangles around a new centre',
            command: {op: 'poke', object: 'cage'}, claim: {all: true},
            expect: {counts: {verts: 14, edges: 36, faces: 24, triFaces: 24}, topology: {closed: true, euler: 2}}},
        {n: 3, title: 'wireframe 0.04', target: 'cage', claimText: 'every edge a strut: a closed surface of genus E - V + 1 = 23',
            command: {op: 'wireframe', object: 'cage', thickness: 0.04}, claim: {all: true},
            expect: {topology: {closed: true, manifold: true, genus: 23}}},
        {n: 4, title: 'primitive cube "cage2"', target: 'cage2', command: {op: 'primitive', type: 'cube', name: 'cage2', size: 0.8, position: [1.2, 0, -4]}, claim: {creates: ['cage2']}},
        {
            n: 5, title: 'wireframe live 0.05', target: 'cage2',
            claimText: 'a modifier: the master cube is untouched; evaluated genus 5',
            command: {op: 'wireframe', object: 'cage2', thickness: 0.05, live: true}, claim: {object: ['modifiers']},
            expect: {check: c => {
                const ev = measureMesh(decodeMesh(c.postEntry.evaluatedMesh))
                return [ck('evaluated: closed, genus 5', ev.closed && ev.genus === 5, {closed: ev.closed, genus: ev.genus})]
            }},
        },
        {
            n: 6, title: 'modifier update: thickness 0.02', target: 'cage2',
            command: {op: 'modifier', object: 'cage2', index: 0, update: {thickness: 0.02}}, claim: {object: ['modifiers']},
            expect: {check: c => [ck('thickness 0.02', c.postEntry.modifiers[0]?.thickness === 0.02, c.postEntry.modifiers[0])]},
        },
        {n: 7, title: 'modifier remove', target: 'cage2', command: {op: 'modifier', object: 'cage2', index: 0, remove: true}, claim: {object: ['modifiers']},
            expect: {check: c => [ck('stack empty', c.postEntry.modifiers.length === 0, c.postEntry.modifiers)]}},
    ],
}

const solidifyShell = {
    id: 'solid', name: 'Side quest: solidify an open shell',
    steps: [
        {n: 1, title: 'primitive 3x3 grid "shell"', target: 'shell', command: {op: 'primitive', type: 'grid', name: 'shell', xSegments: 3, ySegments: 3, size: 1, position: [-2, 0, -4]},
            claim: {creates: ['shell']}, expect: {counts: {verts: 16, faces: 9}}},
        {
            n: 2, title: 'solidify 0.1', target: 'shell',
            claimText: 'the input surface stays in place; an offset copy and a rim close it: volume 0.1',
            command: {op: 'solidify', object: 'shell', thickness: 0.1}, claim: {},
            expect: {
                counts: {verts: 32, faces: 30},
                topology: {closed: true, euler: 2, boundaryLoops: 0},
                check: c => [ck('|volume| = 1 x 1 x 0.1', near(Math.abs(c.postStats.volume), 0.1, 1e-5), c.postStats.volume)],
            },
        },
    ],
}

const applyMod = {
    id: 'apply', name: 'Side quest: applyTransform then a modifier',
    steps: [
        {n: 1, title: 'plane "wing" placed and turned', target: 'wing', command: {op: 'primitive', type: 'plane', name: 'wing', size: 1, position: [2, 0, 2], rotation: [0, 0.3, 0]},
            claim: {creates: ['wing']}},
        {
            n: 2, title: 'applyTransform', target: 'wing',
            claimText: 'vertices take their world positions; transform resets',
            command: {op: 'applyTransform', object: 'wing'}, claim: {all: true, object: ['transform']},
            expect: {check: c => {
                const [qx, qy, qz, qw] = c.target.transform.quaternion
                const t = c.target.transform.position
                let worst = 0
                for (let v = 0; v < c.preMesh.vertsNum; v++) {
                    const p = c.q.pos(v)
                    // q * p * q^-1 + t
                    const ix = qw * p[0] + qy * p[2] - qz * p[1], iy = qw * p[1] + qz * p[0] - qx * p[2]
                    const iz = qw * p[2] + qx * p[1] - qy * p[0], iw = -qx * p[0] - qy * p[1] - qz * p[2]
                    const w = [ix * qw + iw * -qx + iy * -qz - iz * -qy + t[0], iy * qw + iw * -qy + iz * -qx - ix * -qz + t[1], iz * qw + iw * -qz + ix * -qy - iy * -qx + t[2]]
                    const got = c.q2.pos(v)
                    worst = Math.max(worst, ...w.map((x, k) => Math.abs(x - got[k])))
                }
                return [ck('every vertex at its old world position (1e-6)', worst < 1e-6, worst)]
            }},
        },
        {
            n: 3, title: 'modifier: mirror x (about the world origin now)', target: 'wing',
            claimText: 'a modifier only; evaluated mesh symmetric about x = 0',
            command: {op: 'modifier', object: 'wing', add: {type: 'mirror', axis: 'x'}}, claim: {object: ['modifiers']},
            expect: {check: c => {
                const ev = measureMesh(decodeMesh(c.postEntry.evaluatedMesh))
                return [ck('evaluated: 8 verts, symmetric in x', ev.verts === 8 && near(ev.bbox.min[0], -ev.bbox.max[0], 1e-6), {verts: ev.verts, x: [ev.bbox.min[0], ev.bbox.max[0]]})]
            }},
        },
        {n: 4, title: 'modifier apply', target: 'wing', command: {op: 'modifier', object: 'wing', apply: true}, claim: {all: true, object: ['modifiers']},
            expect: {counts: {verts: 8, faces: 2}, topology: {shells: 2}}},
    ],
}

const exportChain = {
    id: 'export', name: 'Side quest: glb export, re-import, compare',
    steps: [
        {n: 1, title: 'primitive icosphere "gem"', target: 'gem', command: {op: 'primitive', type: 'icosphere', name: 'gem', subdivisions: 2, uvs: true, radius: 0.3, position: [0, 3, 0]},
            claim: {creates: ['gem']}, expect: {counts: {verts: 42, faces: 80}}},
        {
            n: 2, title: 'export glb {objects: [gem]}, re-import, compare', target: 'gem',
            claimText: 'a file with gem only; re-imported, its topology equals gem\'s exactly. There is no import command: re-imported with viewer.load',
            // The camera is part of the exported scene, so put it somewhere fixed first: the export is then
            // a function of the document alone, and the second pass can compare it byte for byte.
            command: [{op: 'camera', position: [6, 4, 6], target: [0, 0.5, 0]},
                {op: 'export', format: 'glb', includeData: true, objects: ['gem']}],
            claim: {},
            after: async ({run, page, pre, result, pass}) => {
                const checks = []
                checks.push(ck('export returned bytes', result.ok && result.data.bytes > 0, result.data?.bytes))
                // Keep the file's JSON per pass, so a determinism failure can be diffed.
                const glb = Buffer.from(result.data.base64, 'base64')
                const jsonLength = glb.readUInt32LE(12)
                const gltfJson = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
                const {writeFile: write, mkdir: mk} = await import('node:fs/promises')
                await mk('tmp/edit-chain', {recursive: true})
                await write(`tmp/edit-chain/export-pass-${pass}.gltf.json`, JSON.stringify(gltfJson, null, 1))
                // The same export again in the same session: any difference here is not about sessions.
                const again = await run({op: 'export', format: 'glb', includeData: true, objects: ['gem']})
                checks.push(ck('a second export in the same session is byte-identical', again.ok && again.data.base64 === result.data.base64,
                    `${again.data?.bytes} vs ${result.data.bytes} bytes`))
                const hasImport = (await run({op: 'help'})).data.some(d => d.op === 'import' || d.op === 'load')
                checks.push(ck('an API command can re-import the file', hasImport, hasImport ? 'yes' : 'no import/load command'))
                // No API path, so through the viewer, as the editor's file menu would - without applying the
                // file's viewer settings, which are not what is being compared.
                const imported = await page.evaluate(async b64 => {
                    const bin = atob(b64)
                    const bytes = new Uint8Array(bin.length)
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
                    const before = new Set(window.modelling.document.entries.map(e => e.id))
                    const root = await window.viewer.load(new File([bytes], 'reimport.glb'), {importConfig: false})
                    window.__chainReimport = root
                    const added = window.modelling.document.entries.filter(e => !before.has(e.id))
                    const meshes = []
                    root?.traverse?.(o => { if (o.isMesh) meshes.push(o.name) })
                    const b64of = ta => {
                        const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)
                        let s = ''
                        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
                        return btoa(s)
                    }
                    return {
                        meshes,
                        added: added.map(e => ({id: e.id, name: e.name, mesh: {faceOffsets: b64of(e.mesh.faceOffsets), materials: [...e.mesh.materials],
                            layers: e.mesh.attributes.layers().map(l => ({name: l.name, domain: l.domain, type: l.type, bytes: b64of(l.data)}))}})),
                    }
                }, result.data.base64)
                checks.push(ck('the file holds only the requested object', imported.meshes.length === 1, `${imported.meshes.length} meshes: ${imported.meshes.slice(0, 8).join(', ')}`))
                const gemPre = pre.entries.find(e => e.name === 'gem')
                const twin = imported.added.find(e => e.name.startsWith('gem'))
                checks.push(ck('the re-import came back editable (adopted into the document)', !!twin, imported.added.map(e => e.name)))
                if (twin && gemPre) checks.push(sameGeometry(decodeMesh(gemPre.mesh), decodeMesh(twin.mesh), 're-imported gem equals gem (positions, faces, attributes)'))
                // Put the document and scene back as they were.
                if (imported.added.length) await run({op: 'delete', objects: imported.added.map(e => e.name)})
                await page.evaluate(() => {
                    window.__chainReimport?.removeFromParent?.()
                    window.__chainReimport = null
                })
                return {checks}
            },
            noUndoCheck: 'read-only command (the harness cleans up what the re-import added)',
        },
    ],
}

const PNG = ctx => ctx.png()

const scene = {
    id: 'scene', name: 'Scene and session commands: nothing else may change',
    steps: [
        {n: 1, title: 'light: add a directional key', command: {op: 'light', name: 'key', type: 'directional', position: [3, 5, 2], intensity: 2},
            claim: {scene: ['lights']}, captureFit: 'rook',
            expect: {check: c => [ck('key light exists', c.post.scene.lights.some(l => l.name === 'key' && l.intensity === 2), c.post.scene.lights)]}},
        {n: 2, title: 'light: update its intensity', command: {op: 'light', name: 'key', intensity: 1.2}, claim: {scene: ['lights']}, captureFit: 'rook',
            expect: {check: c => [ck('intensity 1.2, still one key', c.post.scene.lights.filter(l => l.name === 'key').length === 1 && c.post.scene.lights.find(l => l.name === 'key').intensity === 1.2, c.post.scene.lights)]}},
        {n: 3, title: 'lighting: environment intensity and background', command: {op: 'lighting', environmentIntensity: 0.9, background: '#1d1f24'},
            claim: {scene: ['environmentIntensity', 'background']}, captureFit: 'rook',
            expect: {check: c => [ck('set', c.post.scene.environmentIntensity === 0.9 && c.post.scene.background === '1d1f24', [c.post.scene.environmentIntensity, c.post.scene.background])]}},
        {n: 4, title: 'display solid', command: {op: 'display', mode: 'solid'}, claim: {scene: ['displayMode'], anyObject: ['material']}, captureFit: 'rook',
            expect: {check: c => [ck('every material grey', c.post.entries.every(e => e.material.color === 'c8c8c8'), c.post.entries.map(e => e.material.color))]}},
        {n: 5, title: 'material on rook while solid: red', target: 'rook', command: {op: 'material', object: 'rook', color: '#aa3322'}, claim: {object: ['material']}, captureFit: 'rook'},
        {
            n: 6, title: 'display material: the red stays', command: {op: 'display', mode: 'material'}, claim: {scene: ['displayMode'], anyObject: ['material']}, captureFit: 'rook',
            claimText: 'every object gets its own colour back; the rook keeps the red it was given while solid',
            expect: {check: c => {
                const before = c.history.get('scene-03')
                const others = c.post.entries.filter(e => e.name !== 'rook')
                return [ck('rook is red (#aa3322), the colour set last', c.post.entries.find(e => e.name === 'rook')?.material.color === 'aa3322', c.post.entries.find(e => e.name === 'rook')?.material.color),
                    ck('other objects have their pre-solid colour', others.every(e => before.entries.find(b => b.id === e.id)?.material.color === e.material.color), others.map(e => e.material.color))]
            }},
        },
        {n: 7, title: 'reference: a calibrated photo plane', command: ctx => ({op: 'reference', name: 'ref', image: PNG(ctx), plane: 'front', width: 2, origin: [0, 1, -2]}),
            claim: {scene: ['references']}, captureFit: 'rook',
            expect: {check: c => [ck('reference "ref" placed', c.post.scene.references.includes('ref'), c.post.scene.references)]}},
        {n: 8, title: 'reference: list', command: {op: 'reference'}, claim: {}, capture: false,
            expect: {check: c => [ck('lists "ref"', (c.result.data.planes ?? []).some(p => p.name === 'ref'), c.result.data)]}},
        {n: 9, title: 'reference: remove', command: {op: 'reference', name: 'ref', remove: true}, claim: {scene: ['references']}, capture: false},
        {n: 10, title: 'camera: front, fit rook, save', command: {op: 'camera', view: 'front', fit: 'rook', save: 'chain-front'}, claim: {}, capture: false,
            expect: {check: c => [ck('saved "chain-front"', c.result.data.saved === 'chain-front', c.result.data.saved)]}},
        {n: 11, title: 'camera: replay the saved view', command: {op: 'camera', view: 'chain-front'}, claim: {}, capture: false,
            expect: {check: c => [ck('source "saved"', c.result.data.source === 'saved', c.result.data.source)]}},
        {n: 12, title: 'camera: orthographic top', command: [{op: 'camera', projection: 'orthographic', view: 'top', fit: 'rook'}, {op: 'camera', projection: 'perspective'}], claim: {}, capture: false,
            expect: {check: c => [ck('back in perspective', c.result.data.projection === 'perspective', c.results.map(r => r.data?.projection))]}},
        {n: 13, title: 'capture a PNG', command: {op: 'capture', mimeType: 'image/png', label: 'scene check'}, claim: {}, capture: false,
            expect: {check: c => [ck('an image came back', typeof c.result.data.dataUrl === 'string' && c.result.data.dataUrl.startsWith('data:image/png') && c.result.data.width > 0, c.result.data.width)]}},
        {n: 14, title: 'select rook, then clear', command: [{op: 'select', object: 'rook'}, {op: 'select', selected: false}], claim: {}, capture: false,
            expect: {check: c => [ck('selected, then cleared', c.results[0].data.selected === 'rook' && c.results[1].data.selected === null, c.results.map(r => r.data))]}},
        {n: 15, title: 'help: list, and one command in full', command: [{op: 'help'}, {op: 'help', command: 'bevel'}], claim: {}, capture: false,
            expect: {check: c => [ck('the whole registry listed (48 commands on 2026-10-16, 59 with boolean, groove, part, uv, decal ... on 2026-10-18)', c.results[0].data.length >= 59 && ['primitive', 'bevel', 'boolean', 'groove', 'part'].every(op => c.results[0].data.some(d => (d.op ?? d) === op)), c.results[0].data.length),
                ck('bevel schema lists segments', !!c.results[1].data.inputSchema.properties.segments, Object.keys(c.results[1].data.inputSchema.properties).length)]}},
        {
            n: 16, title: 'inspect rook with detail', target: 'rook', command: {op: 'inspect', object: 'rook', detail: true}, claim: {}, capture: false,
            expect: {check: c => {
                const d = c.result.data
                const n = Math.min(c.postStats.verts, 400)
                let worst = 0
                for (let v = 0; v < (d.vertices?.length ?? 0); v++) worst = Math.max(worst, ...d.vertices[v].map((x, k) => Math.abs(x - c.q2.pos(v)[k])))
                const facesOk = (d.faceVerts ?? []).every((fv, f) => fv.join() === c.q2.faceVerts(f).join())
                return [ck(`lists ${n} vertices`, d.vertices?.length === n, d.vertices?.length), ck('positions within 1e-5 of the mesh', worst <= 5e-6 + 1e-9, worst),
                    ck('faceVerts match the mesh', facesOk, (d.faceVerts ?? []).length)]
            }},
        },
        {
            n: 17, title: 'measure bounds and overlaps', target: 'rook', command: [{op: 'measure', object: 'rook', mode: 'bounds'}, {op: 'measure'}], claim: {}, capture: false,
            expect: {check: c => {
                const b = c.results[0].data[0]
                const s = c.postStats.bbox
                return [ck('world bounds equal the mesh bounds (identity transform)', b.min.every((x, k) => near(x, s.min[k], 1e-5)) && b.max.every((x, k) => near(x, s.max[k], 1e-5)), b),
                    ck('overlaps reported', typeof c.results[1].data.pairs === 'number', c.results[1].data.pairs)]
            }},
        },
        {n: 18, title: 'history', command: {op: 'history', limit: 5}, claim: {}, capture: false,
            expect: {check: c => [ck('5 entries, canUndo', c.result.data.entries.length === 5 && c.result.data.canUndo === true, c.result.data.entries.map(e => e.op))]}},
        {n: 19, title: 'checkpoint "pre-nudge"', command: {op: 'checkpoint', name: 'pre-nudge'}, claim: {}, capture: false},
        {n: 20, title: 'transform rook: nudge (to be rewound)', target: 'rook', command: {op: 'transform', object: 'rook', move: [0, 0, 0.5]}, claim: {object: ['transform']}, captureFit: 'rook'},
        {
            n: 21, title: 'undo {to: "pre-nudge"}', command: {op: 'undo', to: 'pre-nudge'}, claim: {anyObject: ['transform']}, capture: false,
            expect: {check: c => {
                const d = c.diffDocs(c.history.get('scene-19'), c.post)
                return [ck('back to the checkpoint, bit for bit', d.length === 0, d.slice(0, 3))]
            }},
        },
        {
            n: 22, title: 'redo', command: {op: 'redo'}, claim: {anyObject: ['transform']}, capture: false,
            expect: {check: c => {
                const d = c.diffDocs(c.history.get('scene-20'), c.post)
                return [ck('the nudge is back, bit for bit', d.length === 0, d.slice(0, 3))]
            }},
        },
        {n: 23, title: 'undo the nudge', command: {op: 'undo'}, claim: {anyObject: ['transform']}, capture: false},
        {n: 24, title: 'selftest', command: {op: 'selftest', verbose: true}, claim: {}, capture: false,
            expect: {check: c => [ck('every object passes', c.result.data.failed === 0, c.result.data.failed)]}},
        {n: 25, title: 'light: remove the key', command: {op: 'light', name: 'key', remove: true}, claim: {scene: ['lights']}, capture: false,
            expect: {check: c => [ck('gone', !c.post.scene.lights.some(l => l.name === 'key'), c.post.scene.lights)]}},
    ],
}

const hazards = {
    id: 'hazard', name: 'Hazards: no-ops, rejected commands, undo fidelity',
    steps: [
        {
            n: 1, title: 'weld rook: nothing to merge', target: 'rook',
            claimText: 'a no-op: nothing changes, it says so (changed: false) and pushes no undo step',
            command: {op: 'weld', object: 'rook', distance: 1e-6}, claim: {},
            expect: {counts: {verts: {delta: 0}}, check: c => [ck('reports changed: false', c.result.changed === false, c.result.changed)]},
        },
        {
            n: 2, title: 'mergeByDistance rook: nothing to merge', target: 'rook',
            command: ({q}) => ({op: 'mergeByDistance', object: 'rook', verts: range(q.verts), threshold: 1e-6}), claim: {},
            expect: {counts: {verts: {delta: 0}}, check: c => [ck('reports changed: false', c.result.changed === false, c.result.changed)]},
        },
        {
            n: 3, title: 'modifier with only an object: list the stack', target: 'rook',
            claimText: 'read-only listing (help reports `modifier` as mutating): changed: false, no undo step',
            command: {op: 'modifier', object: 'rook'}, claim: {}, capture: false,
            expect: {check: c => [ck('reports changed: false', c.result.changed === false, c.result.changed)]},
        },
        {
            n: 4, title: 'vertices: an out-of-range index is rejected', target: 'rook',
            claimText: 'rejected, and the document is exactly as before',
            command: {op: 'vertices', object: 'rook', verts: [[0, 0, 0, 0], [999999, 0, 0, 0]]}, claim: {}, expectError: true, capture: false,
        },
        {
            n: 5, title: 'material: metalness 0.9, roughness 0.1', target: 'rook',
            claimText: 'undo must bring back every material property it changed, not only the colour',
            command: {op: 'material', object: 'rook', metalness: 0.9, roughness: 0.1}, claim: {object: ['material']},
        },
        {
            n: 6, title: 'transform verts {from, to}', target: 'rook',
            claimText: '`readIntList` documents {from, to} ranges; the schema should accept one',
            command: {op: 'transform', object: 'rook', verts: {from: 0, to: 3}, move: [0, 0, 0]}, claim: {verts: [0, 1, 2, 3]}, capture: false,
        },
        {
            n: 7, title: 'delete rook-cut, then undo revives it', target: 'rook-cut',
            command: {op: 'delete', object: 'rook-cut'}, claim: {removes: ['rook-cut']}, captureFit: '*',
        },
    ],
}

const controls = {
    id: 'control', name: 'Controls: deliberate damage the checks must catch',
    steps: [
        {n: 1, title: 'primitive cube "probe" (with UVs)', target: 'probe', command: {op: 'primitive', type: 'cube', name: 'probe', size: 0.5, position: [-4, 0, -4], uvs: true},
            claim: {creates: ['probe']}},
        {
            n: 2, title: 'CONTROL: move two vertices, claim one', target: 'probe', control: 'locality',
            claimText: 'claims vertex 0 only, moves 0 and 1: locality must FAIL',
            command: {op: 'transform', object: 'probe', verts: [0, 1], move: [0, 0.1, 0]}, claim: {verts: [0]},
        },
        {n: 3, title: 'primitive sphere "smoothie", smooth shaded', target: 'smoothie', command: {op: 'primitive', type: 'sphere', name: 'smoothie', radius: 0.3, segments: 12, rings: 6, shading: 'smooth', position: [-5, 0, -4]},
            claim: {creates: ['smoothie']}},
        {
            n: 4, title: 'CONTROL: flat shading, claimed as nothing', target: 'smoothie', control: 'locality',
            claimText: 'writes sharp_face on every face without claiming the layer: locality must FAIL (attribute)',
            command: {op: 'material', object: 'smoothie', shading: 'flat'}, claim: {},
        },
        {n: 5, title: 'cube "blockA"', target: 'blockA', command: {op: 'primitive', type: 'cube', name: 'blockA', size: 1, position: [-7, 0, -4]}, claim: {creates: ['blockA']}},
        {n: 6, title: 'cube "blockB", touching', target: 'blockB', command: {op: 'primitive', type: 'cube', name: 'blockB', size: 1, position: [-6, 0, -4]}, claim: {creates: ['blockB']}},
        {n: 7, title: 'join them', target: 'blockA', command: {op: 'join', objects: ['blockA', 'blockB'], name: 'blocks'}, claim: {removes: ['blockB'], object: ['name']}},
        {
            n: 8, title: 'CONTROL: weld the touching faces together', target: 'blocks', control: 'manifold',
            claimText: 'welding two touching cubes leaves the shared wall doubled: the manifold check must FAIL',
            command: {op: 'weld', object: 'blocks', distance: 1e-4}, claim: {all: true},
        },
        {n: 9, title: 'clean up the controls', command: {op: 'delete', objects: ['probe', 'smoothie', 'blocks']}, claim: {removes: ['probe', 'smoothie', 'blocks']}, capture: false},
    ],
}

export const chains = [setup, main, generators, arrays, mirrorMerge, joinSeparate, ngonSubdiv, bevelBoundary,
    bridge, gridFill, connect, bisectChain, pokeWire, solidifyShell, applyMod, exportChain, scene, hazards, controls]

/** One line per command for the coverage table, where its use needs explaining. */
export const COVERAGE_NOTES = {
    undo: 'after every mutating step (round trip), plus scene-21/23',
    redo: 'after every mutating step (round trip), plus scene-22',
    selftest: 'after every step (manifold check), plus scene-24',
    camera: 'before every capture, plus scene-10..12',
    capture: 'every strip thumbnail, plus scene-13',
    help: 'harness start (command table), scene-15, export-02',
    mergeByDistance: 'edit-mode M > By Distance; `weld` is the object-level Merge by Distance',
}

/** Issues the chain has found, filed under `issues/open/modelling-tools/`, with the steps that show them. */
export const ISSUES = [
    {file: 'chain-noop-command-no-undo-step.md', title: 'A no-op mutating command pushed no undo step; the next undo reverted the command before it (fixed: changed: false)', steps: ['bevel-02', 'hazard-01', 'hazard-02', 'hazard-03']},
    {file: 'chain-material-undo-colour-only.md', title: 'Undo of `material` restored only the colour (fixed)', steps: ['main-25', 'hazard-05']},
    {file: 'chain-redo-rotation-not-exact.md', title: 'Redo re-created rotated objects from an Euler snapshot: not bit-exact (fixed)', steps: ['array-03']},
    {file: 'chain-display-material-overwrites-colour.md', title: '`display material` throws away colours set while solid', steps: ['scene-06']},
    {file: 'chain-export-ignores-objects.md', title: '`export {objects}` exports the whole scene', steps: ['export-02']},
    {file: 'chain-export-not-deterministic.md', title: '`export` is not byte-deterministic: random uuids, and a second export differs from the first', steps: ['export-02']},
    {file: 'chain-no-import-command.md', title: 'No command re-imports an exported file (Track 1 adding `import`)', steps: ['export-02']},
    {file: 'chain-transform-range-schema.md', title: '`transform {verts: {from, to}}` rejected by the schema though the code supports it', steps: ['hazard-06']},
    {file: 'chain-api-measure-diff-dump.md', title: 'No lossless mesh dump, topology measure or claimed/collateral diff in the API', steps: []},
    {file: 'chain-primitive-uvs.md', title: '`primitive` could not generate UVs (fixed: `uvs` option); default differs from Blender', steps: ['main-01']},
]
