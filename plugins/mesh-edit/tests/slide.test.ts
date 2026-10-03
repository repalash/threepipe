/**
 * Edge slide and vertex slide (`transform/slide.ts`).
 *
 * The edge slide parity suite compares against `fixtures/slide.json`, written by Blender running
 * `bpy.ops.transform.edge_slide` in a real 3D view (`fixtures/gen-slide-fixtures.py`): the same mesh,
 * selection, view and operator properties must give the same vertex positions. The rest are worked
 * from the cited Blender functions: the modal input, the `G G` switch, and vertex slide, whose exec
 * path changed after the Blender version that wrote the fixture.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {OrthographicCamera} from 'three'
import {
    BMesh,
    BMVert,
    bmFromMesh,
    edgeSelectSet,
    meshNormalsUpdate,
    primitiveGrid,
    SelectMode,
    selectModeSet,
    selectNone,
    vertSelectSet,
} from '@threepipe/mesh-kernel'
import {TransformView} from '../src/transform/view'
import {TransInfo, TransInfoOptions} from '../src/transform/TransInfo'
import {T_ALT_TRANSFORM} from '../src/transform/types'
import {EdgeSlideData, interpLineV3V3V3V3, meshEdgeSlideDataCreate} from '../src/transform/slide'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'slide.json')
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

interface SlideCase {
    name: string
    props: {value: number, use_even?: boolean, flipped?: boolean, use_clamp?: boolean}
    input: {positions: number[][], faces: number[][], meshEdges: number[][], selected: number[][]}
    positions: number[][]
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    blender: string
    view: {viewMatrix: number[], windowMatrix: number[], isPersp: boolean, winx: number, winy: number, xray: boolean}
    cases: SlideCase[]
}

/** Blender works in float32 and the fixture is rounded to 6 places. */
const TOL = 1e-4

/** The mesh as Blender's edit mode builds it from the `Mesh`: verts, then edges in mesh order, then faces. */
function build(input: SlideCase['input']): {bm: BMesh, verts: BMVert[]} {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    for (const [a, b] of input.meshEdges) bm.edgeCreate(verts[a], verts[b])
    for (const f of input.faces) bm.faceCreate(f.map(i => verts[i]))
    meshNormalsUpdate(bm)
    selectModeSet(bm, SelectMode.Edge)
    for (const [a, b] of input.selected) {
        const e = [...bm.edges].find(x => x.joins(verts[a], verts[b]))
        if (!e) throw new Error(`no edge ${a}-${b}`)
        edgeSelectSet(bm, e, true)
    }
    return {bm, verts}
}

const fixtureView = () => new TransformView(fixture.view.viewMatrix, fixture.view.windowMatrix, fixture.view.winx, fixture.view.winy, fixture.view.isPersp)

function slide(bm: BMesh, mode: 'edgeSlide' | 'vertSlide', extra: Partial<TransInfoOptions> = {}, view = fixtureView()): TransInfo {
    return new TransInfo({
        mode, view, mval: [0, 0], around: 'median', orientation: 'global', bm, objectMatrix: IDENTITY,
        xray: fixture.view.xray, ...extra,
    })
}

describe(`edge slide parity with Blender ${fixture.blender} (transform_mode_edge_slide.cc)`, () => {
    for (const c of fixture.cases) {
        it(`${c.name} ${JSON.stringify(c.props)}`, () => {
            const {bm, verts} = build(c.input)
            // `transform_exec`: the operator's properties, no modal, the cursor at the region's corner.
            const t = slide(bm, 'edgeSlide', {
                modal: false,
                value: [c.props.value],
                slide: {useEven: c.props.use_even, flipped: c.props.flipped, useClamp: c.props.use_clamp},
            })
            expect(t.state).not.toBe('cancel')
            t.confirm()
            verts.forEach((v, i) => {
                const e = c.positions[i]
                expect(Math.abs(v.x - e[0]) + Math.abs(v.y - e[1]) + Math.abs(v.z - e[2]), `vertex ${i}: ${[v.x, v.y, v.z]} vs ${e}`).toBeLessThan(TOL)
            })
        })
    }
})

// region hand-worked cases

/** An orthographic view 8 units wide over 800x600 px, looking down -Z: 1 px = 0.01 units. */
function orthoView(): TransformView {
    const cam = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    cam.position.set(0, 0, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    return TransformView.fromCamera(cam, 800, 600)
}

/** A 2x2-unit grid of 4x4 quads in XY (verts at -1, -0.5, 0, 0.5, 1), centred on the origin. */
function grid(): BMesh {
    const bm = bmFromMesh(primitiveGrid({xSegments: 4, ySegments: 4, size: 1}))
    meshNormalsUpdate(bm)
    return bm
}

const at = (bm: BMesh, x: number, y: number) => [...bm.verts].find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6)!

/** Select the grid's column x = 0 as edges. */
function selectColumn(bm: BMesh, x = 0): BMVert[] {
    selectModeSet(bm, SelectMode.Edge)
    selectNone(bm)
    const col = [-1, -0.5, 0, 0.5, 1].map(y => at(bm, x, y))
    for (let i = 0; i + 1 < col.length; i++) {
        const e = [...bm.edges].find(x => x.joins(col[i], col[i + 1]))!
        edgeSelectSet(bm, e, true)
    }
    return col
}

const KEY_CHARS: Record<string, string> = {Minus: '-', Period: '.', AltLeft: 'Alt'}
const key = (code: string, press = true, mods: {alt?: boolean} = {}) => ({type: 'key' as const, event: {
    code, key: KEY_CHARS[code] ?? code.replace(/^Key|^Digit/, '').toLowerCase(), ctrl: false, shift: false, alt: !!mods.alt, press,
}})

describe('edge slide data (transform_convert_mesh.cc:2301)', () => {
    it('a column of a quad grid slides to its neighbouring columns', () => {
        const bm = grid()
        const col = selectColumn(bm)
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        const sld = t.containers[0].customMode as EdgeSlideData
        expect(sld.sv.length).toBe(5)
        for (const sv of sld.sv) {
            expect(col).toContain(sv.td.extra)
            // One side is +0.5 in X, the other -0.5: the neighbouring columns.
            const xs = sv.dirSide.map(d => d[0]).sort()
            expect(xs[0]).toBeCloseTo(-0.5, 6)
            expect(xs[1]).toBeCloseTo(0.5, 6)
            expect(sv.dirSide[0][1]).toBeCloseTo(0, 6)
            expect(sv.edgeLen).toBeCloseTo(1, 6)
            expect(sv.loopNr).toBe(0)
        }
    })

    it('rejects a vertex with three selected edges (an invalid edge selection)', () => {
        const bm = grid()
        selectColumn(bm)
        const e = [...bm.edges].find(x => x.joins(at(bm, 0, 0), at(bm, 0.5, 0)))!
        edgeSelectSet(bm, e, true)
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        expect(meshEdgeSlideDataCreate(bm, t.containers[0])).toBeNull()
        // `initEdgeSlide_ex`: no slide data cancels the transform.
        expect(t.state).toBe('cancel')
    })

    it('interp_line_v3_v3v3v3 walks a two-segment line, with t at the middle point at its factor', () => {
        // v2 projects to 1/10 of the way from v1 to v3 (`line_point_factor_v3`: (1, 3).(1, 0) / 10).
        const mid = interpLineV3V3V3V3([0, 0, 0], [1, 0, 0], [1, 3, 0], 0.1)
        expect(mid[0]).toBeCloseTo(1, 6)
        expect(mid[1]).toBeCloseTo(0, 6)
        // Past it, the second segment: (0.55 - 0.1) / 0.9 = 0.5 of the way from v2 to v3.
        const p = interpLineV3V3V3V3([0, 0, 0], [1, 0, 0], [1, 3, 0], 0.55)
        expect(p[0]).toBeCloseTo(1, 6)
        expect(p[1]).toBeCloseTo(1.5, 6)
        // Before it, the first: 0.05 / 0.1 of the way from v1 to v2.
        expect(interpLineV3V3V3V3([0, 0, 0], [1, 0, 0], [1, 3, 0], 0.05)[0]).toBeCloseTo(0.5, 6)
    })

    // The fixture's grid (`gen-slide-fixtures.py`): columns at x 0, 1, 1.6, 3, 3.5, rows at y 0, 0.7, 2,
    // 2.4, vertex (2, 1) lifted to z 0.4 and (1, 2) lowered to -0.3.
    const GX = [0, 1, 1.6, 3, 3.5], GY = [0, 0.7, 2, 2.4]
    function fixtureGrid(move?: {x: number, y: number, co: number[]}): {bm: BMesh, v: (x: number, y: number) => BMVert} {
        const bm = new BMesh()
        const vs: BMVert[] = []
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 5; x++) {
                const z = x === 2 && y === 1 ? 0.4 : x === 1 && y === 2 ? -0.3 : 0
                const co = move && move.x === x && move.y === y ? move.co : [GX[x], GY[y], z]
                vs.push(bm.vertCreate(co[0], co[1], co[2]))
            }
        }
        const v = (x: number, y: number) => vs[y * 5 + x]
        for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) bm.faceCreate([v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)])
        meshNormalsUpdate(bm)
        return {bm, v}
    }
    const co = (v: BMVert) => [v.x, v.y, v.z]
    const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i])
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    /** The nearest points of two infinite lines, by the textbook formula (not the port's). */
    function nearestPoints(a0: number[], a1: number[], b0: number[], b1: number[]): [number[], number[]] {
        const da = sub(a1, a0), db = sub(b1, b0), w0 = sub(a0, b0)
        const a = dot(da, da), b = dot(da, db), c = dot(db, db), d = dot(da, w0), e = dot(db, w0)
        const den = a * c - b * b
        const s = (b * e - c * d) / den, u = (a * e - b * d) / den
        return [a0.map((x, i) => x + da[i] * s), b0.map((x, i) => x + db[i] * u)]
    }
    /** Select an L: column x = 2 from row 0 to 2, then row 2 from x = 2 to 3. */
    function selectL(bm: BMesh, v: (x: number, y: number) => BMVert): void {
        selectModeSet(bm, SelectMode.Edge)
        for (const [a, b] of [[v(2, 0), v(2, 1)], [v(2, 1), v(2, 2)], [v(2, 2), v(3, 2)]]) {
            edgeSelectSet(bm, [...bm.edges].find(e => e.joins(a, b))!, true)
        }
    }
    function cornerTargets(bm: BMesh, corner: BMVert): number[][] {
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        const sld = t.containers[0].customMode as EdgeSlideData
        const sv = sld.sv.find(s => s.td.extra === corner)!
        return sv.dirSide.map(d => [d[0] + sv.td.iloc[0], d[1] + sv.td.iloc[1], d[2] + sv.td.iloc[2]])
    }

    it('a corner of the path slides to where the two neighbouring target lines meet (isect_curr_dirs)', () => {
        const {bm, v} = fixtureGrid()
        selectL(bm, v)
        // On the outer side, line A runs through the column's targets (1, 1) and (1, 2), line B through
        // the row's targets (2, 3) and (3, 3); they are skew, so the target is the midpoint of their
        // nearest points (`transform_convert_mesh.cc:2671-2711`). It lies in the cone from the corner
        // through (1, 2) and (2, 3), so the #144270 check keeps it.
        const [p, q] = nearestPoints(co(v(1, 1)), co(v(1, 2)), co(v(2, 3)), co(v(3, 3)))
        const expected = p.map((x, i) => (x + q[i]) / 2)
        const targets = cornerTargets(bm, v(2, 2))
        expect(targets.some(tg => Math.hypot(...sub(tg, expected)) < 1e-6), `${JSON.stringify(targets)} vs ${expected}`).toBe(true)
        // On the inner side both selected edges are in one quad, so the corner slides over that face
        // (`l_edge_next == next.e`), diagonally across the quad to (3, 1) (`isect_face_dst`).
        expect(targets.some(tg => Math.hypot(...sub(tg, co(v(3, 1)))) < 1e-9), JSON.stringify(targets)).toBe(true)
    })

    it('a corner whose line intersection falls outside the cone slides to the midpoint instead (#144270)', () => {
        // Tilt the row's next target up so line B meets line A below the corner, outside the cone.
        const {bm, v} = fixtureGrid({x: 3, y: 3, co: [3, 4, 0]})
        selectL(bm, v)
        const [p, q] = nearestPoints(co(v(1, 1)), co(v(1, 2)), co(v(2, 3)), co(v(3, 3)))
        const isect = p.map((x, i) => (x + q[i]) / 2)
        // Below the corner: on the wrong side of the plane through the corner and (2, 3).
        expect(isect[1]).toBeLessThan(v(2, 2).y)
        const expected = co(v(1, 2)).map((x, i) => (x + co(v(2, 3))[i]) / 2)
        const targets = cornerTargets(bm, v(2, 2))
        expect(targets.some(tg => Math.hypot(...sub(tg, expected)) < 1e-6), `${JSON.stringify(targets)} vs ${expected}`).toBe(true)
    })

    it('beside an n-gon a vertex slides to the opposite side of the n-gon (isect_face_dst, bm_loop_calc_opposite_co)', () => {
        // A strip whose left side is one hexagon; the middle column (1-4-7) is selected.
        const bm = new BMesh()
        const p = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0.1], [2, 1, 0], [0, 2, 0], [1.1, 2, 0], [2, 2, 0]]
        const vs = p.map(c => bm.vertCreate(c[0], c[1], c[2]))
        for (const f of [[0, 1, 4, 7, 6, 3], [1, 2, 5, 4], [4, 5, 8, 7]]) bm.faceCreate(f.map(i => vs[i]))
        meshNormalsUpdate(bm)
        selectModeSet(bm, SelectMode.Edge)
        for (const [a, b] of [[1, 4], [4, 7]]) edgeSelectSet(bm, [...bm.edges].find(e => e.joins(vs[a], vs[b]))!, true)
        // The plane through vertex 4 whose normal is the hexagon's boundary direction there
        // (`BM_loop_calc_face_direction`: unit 1->4 plus unit 4->7), cut with the edge 6-3.
        const norm = (a: number[]) => a.map(x => x / Math.hypot(...a))
        const n = norm(norm(sub(p[4], p[1])).map((x, i) => x + norm(sub(p[7], p[4]))[i]))
        const d = sub(p[3], p[6])
        const lambda = dot(n, sub(p[4], p[6])) / dot(n, d)
        expect(lambda).toBeGreaterThan(0)
        expect(lambda).toBeLessThan(1)
        const expected = p[6].map((x, i) => x + d[i] * lambda)
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        const sld = t.containers[0].customMode as EdgeSlideData
        const sv = sld.sv.find(s => s.td.extra === vs[4])!
        const targets = sv.dirSide.map(dd => dd.map((x, i) => x + sv.td.iloc[i]))
        expect(targets.some(tg => Math.hypot(...sub(tg, expected)) < 1e-6), `${JSON.stringify(targets)} vs ${expected}`).toBe(true)
        // The quad side slides along the rung edge to vertex 5.
        expect(targets.some(tg => Math.hypot(...sub(tg, p[5])) < 1e-9)).toBe(true)
    })

    it('of several crossings of the n-gon, the nearest is the target (bm_loop_calc_opposite_co)', () => {
        // The left face is a 9-gon that folds back: the plane through vertex 4 crosses it at x = 0.3,
        // -0.5 and -1. The walk from vertex 7 meets the nearest crossing first and the farthest last.
        const bm = new BMesh()
        const p: Record<string, number[]> = {
            v1: [1, 0, 0], v2: [2, 0, 0], v4: [1, 1, 0.1], v5: [2, 1, 0], v7: [1.1, 2, 0], v8: [2, 2, 0],
            P: [0.3, 2, 0], Q: [0.3, 0.5, 0], R: [-0.5, 0.5, 0], S: [-0.5, 2.2, 0], T: [-1, 2.2, 0], U: [-1, 0, 0],
        }
        const vs: Record<string, BMVert> = {}
        for (const k in p) vs[k] = bm.vertCreate(p[k][0], p[k][1], p[k][2])
        for (const f of [['v1', 'v4', 'v7', 'P', 'Q', 'R', 'S', 'T', 'U'], ['v1', 'v2', 'v5', 'v4'], ['v4', 'v5', 'v8', 'v7']]) {
            bm.faceCreate(f.map(k => vs[k]))
        }
        meshNormalsUpdate(bm)
        selectModeSet(bm, SelectMode.Edge)
        for (const [a, b] of [['v1', 'v4'], ['v4', 'v7']]) edgeSelectSet(bm, [...bm.edges].find(e => e.joins(vs[a], vs[b]))!, true)
        const norm = (a: number[]) => a.map(x => x / Math.hypot(...a))
        const n = norm(norm(sub(p.v4, p.v1)).map((x, i) => x + norm(sub(p.v7, p.v4))[i]))
        // The crossing on P-Q.
        const d = sub(p.Q, p.P)
        const lambda = dot(n, sub(p.v4, p.P)) / dot(n, d)
        const expected = p.P.map((x, i) => x + d[i] * lambda)
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        const sv = (t.containers[0].customMode as EdgeSlideData).sv.find(s => s.td.extra === vs.v4)!
        const targets = sv.dirSide.map(dd => dd.map((x, i) => x + sv.td.iloc[i]))
        expect(targets.some(tg => Math.hypot(...sub(tg, expected)) < 1e-6), `${JSON.stringify(targets)} vs ${expected}`).toBe(true)
    })

    it('the slide follows the nearest vertex with a visible edge, not one hidden behind a face (BMBVH_EdgeVisible)', () => {
        // Columns at x -1, -0.5, 0, 0.5, 2 (one quad row), and a separate sheet at z = 1 over x < 0.1.
        // Selected: columns -0.5 (gaps 0.5 + 0.5 to its neighbours) and 0.5 (gaps 0.5 + 1.5).
        const bm = new BMesh()
        const xs = [-1, -0.5, 0, 0.5, 2]
        const lo = xs.map(x => bm.vertCreate(x, -1, 0))
        const hi = xs.map(x => bm.vertCreate(x, 1, 0))
        for (let i = 0; i < 4; i++) bm.faceCreate([lo[i], lo[i + 1], hi[i + 1], hi[i]])
        const sheet = [[-3, -3], [0.1, -3], [0.1, 3], [-3, 3]].map(c => bm.vertCreate(c[0], c[1], 1))
        bm.faceCreate(sheet)
        meshNormalsUpdate(bm)
        selectModeSet(bm, SelectMode.Edge)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(lo[1], hi[1]))!, true)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(lo[3], hi[3]))!, true)
        // The cursor on the hidden column (x -0.5 is pixel 350).
        const t = slide(bm, 'edgeSlide', {mval: [350, 300], xray: false}, orthoView())
        const sld = t.containers[0].customMode as EdgeSlideData
        expect((sld.sv[sld.currSvIndex].td.extra as BMVert).x).toBeCloseTo(0.5, 6)
        // The custom points span half the visible column's side-to-side width: 2 units, 200 px.
        expect(Math.hypot(sld.mvalEnd[0] - sld.mvalStart[0], sld.mvalEnd[1] - sld.mvalStart[1])).toBeCloseTo(100, 0)
        // With X-ray every vertex counts, so the hidden column under the cursor is the reference.
        const tx = slide(bm, 'edgeSlide', {mval: [350, 300], xray: true}, orthoView())
        const sx = tx.containers[0].customMode as EdgeSlideData
        expect((sx.sv[sx.currSvIndex].td.extra as BMVert).x).toBeCloseTo(-0.5, 6)
    })
})

describe('edge slide modal input (transform_mode_edge_slide.cc, transform_input.cc)', () => {
    it('the cursor drives the factor along the projected side direction (INPUT_CUSTOM_RATIO_FLIP)', () => {
        const bm = grid()
        selectColumn(bm)
        // The column projects to x = 400; the cursor starts on it.
        const t = slide(bm, 'edgeSlide', {mval: [400, 300]}, orthoView())
        const sld = t.containers[0].customMode as EdgeSlideData
        const sv = sld.sv[sld.currSvIndex]
        // The custom points span half of the reference vertex's side-to-side vector on screen: 100 px
        // for the 1-unit gap between the neighbouring columns (`edge_slide_data_init_mval`).
        const span = Math.hypot(sld.mvalEnd[0] - sld.mvalStart[0], sld.mvalEnd[1] - sld.mvalStart[1])
        expect(span).toBeCloseTo(50, 0)
        // Moving 25 px towards dir_side[0]'s target is a factor of 0.5 towards side 0.
        const toward = Math.sign(sv.dirSide[0][0])
        t.handleEvent({type: 'mousemove', mval: [400 + toward * 25, 300]})
        expect(t.valuesFinal[0]).toBeCloseTo(0.5, 6)
        expect((sv.td.extra as BMVert).x).toBeCloseTo(toward * 0.25, 6)
        expect(t.header).toBe('Edge Slide: 0.5000 ')
    })

    it('a typed number is exact and is not clamped (applyNumInput after CLAMP)', () => {
        const bm = grid()
        selectColumn(bm)
        const t = slide(bm, 'edgeSlide', {mval: [400, 300]}, orthoView())
        t.handleEvent(key('Minus'))
        t.handleEvent(key('Digit1'))
        t.handleEvent(key('Period'))
        t.handleEvent(key('Digit5'))
        expect(t.valuesFinal[0]).toBeCloseTo(-1.5, 6)
        const sld = t.containers[0].customMode as EdgeSlideData
        const sv = sld.sv[0]
        // Negative goes to side 1, 1.5 times its length.
        expect((sv.td.extra as BMVert).x).toBeCloseTo(sv.td.iloc[0] + sv.dirSide[1][0] * 1.5, 6)
    })

    it('E toggles even, F flips, C and Alt unclamp (handleEventEdgeSlide, transformEvent)', () => {
        const bm = grid()
        selectColumn(bm)
        const t = slide(bm, 'edgeSlide', {mval: [400, 300]}, orthoView())
        t.handleEvent(key('KeyE'))
        expect(t.saveProps().slide!.useEven).toBe(true)
        t.handleEvent(key('KeyF'))
        expect(t.saveProps().slide!.flipped).toBe(true)
        t.handleEvent(key('KeyC'))
        expect(t.flag & T_ALT_TRANSFORM).toBeTruthy()
        expect(t.saveProps().slide!.useClamp).toBe(false)
        t.handleEvent(key('KeyC'))
        t.handleEvent(key('AltLeft', true, {alt: true}))
        expect(t.flag & T_ALT_TRANSFORM).toBeTruthy()
        t.handleEvent(key('AltLeft', false))
        expect(t.flag & T_ALT_TRANSFORM).toBeFalsy()
    })

    it('saves value and the slide properties, and the redo reproduces the modal result', () => {
        const bm = grid()
        const col = selectColumn(bm)
        const t = slide(bm, 'edgeSlide', {mval: [400, 300]}, orthoView())
        t.handleEvent({type: 'mousemove', mval: [430, 310]})
        t.handleEvent(key('KeyE'))
        t.confirm()
        const after = col.map(v => [v.x, v.y, v.z])
        const saved = t.saveProps()
        expect(saved.mode).toBe('edgeSlide')
        expect(saved.value.length).toBe(1)
        expect(saved.slide!.mval).toEqual([400, 300])

        // Undo by hand, then run the redo: `T_INPUT_IS_VALUES_FINAL` with the saved properties.
        const bm2 = grid()
        const col2 = selectColumn(bm2)
        const r = slide(bm2, 'edgeSlide', {modal: false, value: saved.value, mval: saved.slide!.mval, slide: saved.slide}, orthoView())
        r.confirm()
        col2.forEach((v, i) => {
            expect(v.x).toBeCloseTo(after[i][0], 6)
            expect(v.y).toBeCloseTo(after[i][1], 6)
        })
    })
})

describe('G G (transform.cc:1117, transform_modal_item_poll)', () => {
    it('G during Move switches to edge slide on edge loops, G again back to Move', () => {
        const bm = grid()
        const col = selectColumn(bm)
        const t = slide(bm, 'edgeSlide', {}, orthoView())
        t.cancel()
        const m = new TransInfo({mode: 'translate', view: orthoView(), mval: [400, 300], around: 'median', orientation: 'global', bm, objectMatrix: IDENTITY})
        m.handleEvent({type: 'mousemove', mval: [420, 300]})
        expect(col[0].x).toBeCloseTo(0.2, 6)
        m.handleEvent(key('KeyG'))
        expect(m.mode).toBe('edgeSlide')
        // The move is undone first (`restoreTransObjects`), then the slide applies from the same cursor.
        expect(m.dataLenAll).toBe(5)
        m.handleEvent(key('KeyG'))
        expect(m.mode).toBe('translate')
        expect(col[0].x).toBeCloseTo(0.2, 6)
    })

    it('falls back to vertex slide when the selection is not edge loops, and to Move with no edges', () => {
        const bm = grid()
        selectModeSet(bm, SelectMode.Vertex)
        selectNone(bm)
        vertSelectSet(bm, at(bm, 0, 0), true)
        const m = new TransInfo({mode: 'translate', view: orthoView(), mval: [400, 300], around: 'median', orientation: 'global', bm, objectMatrix: IDENTITY})
        m.handleEvent(key('KeyG'))
        expect(m.mode).toBe('vertSlide')
        expect(m.state).not.toBe('cancel')

        const lone = new BMesh()
        const v = lone.vertCreate(0, 0, 0)
        vertSelectSet(lone, v, true)
        const m2 = new TransInfo({mode: 'translate', view: orthoView(), mval: [400, 300], around: 'median', orientation: 'global', bm: lone, objectMatrix: IDENTITY})
        m2.handleEvent(key('KeyG'))
        // A loose vertex still gets vertex slide data (it slides into itself, `transform_convert_mesh.cc:2205`).
        expect(m2.mode).toBe('vertSlide')
    })

    it('G is Move again from either slide, never slide from rotate', () => {
        const bm = grid()
        selectColumn(bm)
        const r = new TransInfo({mode: 'rotate', view: orthoView(), mval: [500, 300], around: 'median', orientation: 'global', bm, objectMatrix: IDENTITY})
        r.handleEvent(key('KeyG'))
        expect(r.mode).toBe('translate')
    })
})

describe('vertex slide (transform_mode_vert_slide.cc)', () => {
    it('slides each selected vertex along the edge closest to the cursor direction', () => {
        const bm = grid()
        selectModeSet(bm, SelectMode.Vertex)
        selectNone(bm)
        const v = at(bm, 0, 0)
        vertSelectSet(bm, v, true)
        const t = slide(bm, 'vertSlide', {mval: [400, 300]}, orthoView())
        // Up the screen: the edge to (0, 0.5) (`update_active_edges` with the mouse direction).
        t.handleEvent({type: 'mousemove', mval: [400, 325]})
        expect(v.x).toBeCloseTo(0, 6)
        expect(v.y).toBeCloseTo(0.25, 6)
        expect(t.valuesFinal[0]).toBeCloseTo(0.5, 6)
        // Clamped to [0, 1] without a typed number.
        t.handleEvent({type: 'mousemove', mval: [400, 400]})
        expect(v.y).toBeCloseTo(0.5, 6)
        expect(t.header).toBe('Vertex Slide: 1.0000 ')
        // Left: the edge to (-0.5, 0).
        t.handleEvent({type: 'mousemove', mval: [380, 300]})
        expect(v.x).toBeCloseTo(-0.2, 6)
        expect(v.y).toBeCloseTo(0, 6)
    })

    it('even keeps the distance of the reference vertex along each edge', () => {
        const bm = grid()
        selectModeSet(bm, SelectMode.Vertex)
        selectNone(bm)
        const a = at(bm, 0, 0)
        const b = at(bm, 1, 1)
        vertSelectSet(bm, a, true)
        vertSelectSet(bm, b, true)
        const t = slide(bm, 'vertSlide', {modal: false, value: [0.5], slide: {useEven: true, direction: [1, 0, 0]}, mval: [400, 300]}, orthoView())
        t.confirm()
        // `doVertSlide`: perc times the reference vertex's edge length (0.5), along each unit edge.
        expect(a.x).toBeCloseTo(0.25, 6)
        // (1, 1) is a corner: its +X-most edge goes to (1, 0.5)... both its edges are -X or -Y; the
        // best dot with +X is the -Y edge (dot 0 beats -1).
        expect(b.x).toBeCloseTo(1, 6)
        expect(b.y).toBeCloseTo(0.75, 6)
    })

    it('even + flipped measures back from the target instead (vert_slide_apply_elem)', () => {
        const bm = grid()
        selectModeSet(bm, SelectMode.Vertex)
        selectNone(bm)
        const a = at(bm, 0, 0)
        vertSelectSet(bm, a, true)
        const t = slide(bm, 'vertSlide', {modal: false, value: [0.2], slide: {useEven: true, flipped: true, direction: [1, 0, 0]}, mval: [400, 300]}, orthoView())
        t.confirm()
        // From the target (0.5, 0) back along the edge by 0.2 * 0.5.
        expect(a.x).toBeCloseTo(0.4, 6)
    })

    it('saves the slide direction for redo (the hidden `direction` property)', () => {
        const bm = grid()
        selectModeSet(bm, SelectMode.Vertex)
        selectNone(bm)
        vertSelectSet(bm, at(bm, 0, 0), true)
        const t = slide(bm, 'vertSlide', {mval: [400, 300]}, orthoView())
        t.handleEvent({type: 'mousemove', mval: [400, 330]})
        t.confirm()
        const s = t.saveProps().slide!
        expect(s.direction![1]).toBeCloseTo(1, 6)
        expect(s.direction![0]).toBeCloseTo(0, 6)
    })
})

// endregion
