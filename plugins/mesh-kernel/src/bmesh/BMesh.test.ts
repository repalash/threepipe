import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {ElemFlag} from '../constants'
import {BMVert} from './types'
import {
    diskCount,
    diskEdgeExists,
    diskEdges,
    edgeFaceCount,
    edgeIsBoundary,
    edgeIsManifold,
    edgeIsWire,
    radialLength,
    radialLoops,
    validateDisk,
    validateRadial,
    vertEdges,
} from './structure'

/** Unit cube, same vertex order and winding as Blender's `create_cube`. */
function cube(): {bm: BMesh, verts: BMVert[]} {
    const bm = new BMesh()
    const s = 0.5
    const coords: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s],
        [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = coords.map(c => bm.vertCreate(...c))
    const faces = [
        [0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4],
        [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5],
    ]
    for (const f of faces) bm.faceCreate(f.map(i => verts[i]))
    return {bm, verts}
}

function triangle() {
    const bm = new BMesh()
    const a = bm.vertCreate(0, 0, 0)
    const b = bm.vertCreate(1, 0, 0)
    const c = bm.vertCreate(0, 1, 0)
    const f = bm.faceCreate([a, b, c])
    return {bm, a, b, c, f}
}

describe('BMesh construction', () => {
    it('builds a cube with correct element counts', () => {
        const {bm} = cube()
        expect(bm.totvert).toBe(8)
        expect(bm.totedge).toBe(12)
        expect(bm.totface).toBe(6)
        expect(bm.totloop).toBe(24)
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
    })

    it('passes full validation', () => {
        expect(cube().bm.validate()).toEqual([])
    })

    it('reuses shared edges rather than duplicating them', () => {
        const {bm} = cube()
        // 6 quads x 4 edges = 24 edge slots over 12 distinct edges.
        expect(bm.totedge).toBe(12)
        for (const e of bm.edges) expect(radialLength(e)).toBe(2)
    })

    it('rejects a face with a repeated vertex', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        expect(() => bm.faceCreate([a, b, a])).toThrow(/appears twice/)
    })

    it('rejects a face with fewer than three vertices', () => {
        const bm = new BMesh()
        const a = bm.vertCreate()
        const b = bm.vertCreate(1, 0, 0)
        expect(() => bm.faceCreate([a, b])).toThrow(/at least 3/)
    })

    it('rejects a degenerate edge', () => {
        const bm = new BMesh()
        const a = bm.vertCreate()
        expect(() => bm.edgeCreate(a, a)).toThrow(/degenerate/)
    })

    it('edgeCreate with noDouble returns the existing edge', () => {
        const bm = new BMesh()
        const a = bm.vertCreate()
        const b = bm.vertCreate(1, 0, 0)
        const e1 = bm.edgeCreate(a, b)
        const e2 = bm.edgeCreate(a, b, undefined, {noDouble: true})
        expect(e2).toBe(e1)
        expect(bm.totedge).toBe(1)
        // Without the flag a parallel edge is allowed, since BMesh permits it.
        const e3 = bm.edgeCreate(a, b)
        expect(e3).not.toBe(e1)
        expect(bm.totedge).toBe(2)
    })
})

describe('disk cycle', () => {
    it('counts the edges around each cube corner as 3', () => {
        const {bm} = cube()
        for (const v of bm.verts) expect(diskCount(v)).toBe(3)
    })

    it('walks every incident edge exactly once', () => {
        const {bm, verts} = cube()
        const v = verts[0]
        const walked = vertEdges(v)
        expect(walked.length).toBe(3)
        expect(new Set(walked).size).toBe(3)
        for (const e of walked) expect(e.uses(v)).toBe(true)
        const all = [...bm.edges].filter(e => e.uses(v))
        expect(new Set(walked)).toEqual(new Set(all))
    })

    it('stays doubly linked and consistent', () => {
        const {bm} = cube()
        for (const v of bm.verts) expect(validateDisk(v)).toEqual([])
    })

    it('finds an existing edge between two vertices and rejects a non-edge', () => {
        const {verts} = cube()
        expect(diskEdgeExists(verts[0], verts[1])).not.toBeNull()
        // Opposite corners of the cube share no edge.
        expect(diskEdgeExists(verts[0], verts[7])).toBeNull()
    })

    it('leaves a lone vertex loose after its only edge is removed', () => {
        const bm = new BMesh()
        const a = bm.vertCreate()
        const b = bm.vertCreate(1, 0, 0)
        const e = bm.edgeCreate(a, b)
        expect(a.e).toBe(e)
        bm.edgeKill(e)
        expect(a.e).toBeNull()
        expect(b.e).toBeNull()
        expect(diskCount(a)).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('repoints v.e when the referenced edge is removed but others remain', () => {
        const bm = new BMesh()
        const centre = bm.vertCreate()
        const spokes = [bm.vertCreate(1, 0, 0), bm.vertCreate(0, 1, 0), bm.vertCreate(0, 0, 1)]
        const edges = spokes.map(s => bm.edgeCreate(centre, s))
        expect(diskCount(centre)).toBe(3)
        bm.edgeKill(centre.e!)
        expect(diskCount(centre)).toBe(2)
        expect(centre.e).not.toBeNull()
        expect(edges).toContain(centre.e)
        expect(validateDisk(centre)).toEqual([])
    })
})

describe('radial cycle', () => {
    it('reports a lone triangle edge as a boundary', () => {
        const {f} = triangle()
        for (const l of f.eachLoop()) {
            expect(radialLength(l.e!)).toBe(1)
            expect(edgeIsBoundary(l.e!)).toBe(true)
            expect(edgeIsManifold(l.e!)).toBe(false)
            expect(edgeIsWire(l.e!)).toBe(false)
        }
    })

    it('reports every cube edge as manifold', () => {
        const {bm} = cube()
        for (const e of bm.edges) {
            expect(edgeIsManifold(e)).toBe(true)
            expect(edgeIsBoundary(e)).toBe(false)
            expect(edgeFaceCount(e)).toBe(2)
        }
    })

    it('represents a non-manifold edge with three faces', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const wings = [bm.vertCreate(0, 1, 0), bm.vertCreate(0, -1, 0), bm.vertCreate(0, 0, 1)]
        for (const w of wings) bm.faceCreate([a, b, w])
        const shared = diskEdgeExists(a, b)!
        expect(radialLength(shared)).toBe(3)
        expect(edgeIsManifold(shared)).toBe(false)
        expect(edgeIsBoundary(shared)).toBe(false)
        expect(bm.validate()).toEqual([])
    })

    it('treats an edge with no face as wire', () => {
        const bm = new BMesh()
        const e = bm.edgeCreate(bm.vertCreate(), bm.vertCreate(1, 0, 0))
        expect(edgeIsWire(e)).toBe(true)
        expect(radialLength(e)).toBe(0)
        expect([...radialLoops(e)]).toEqual([])
    })

    it('stays doubly linked and consistent', () => {
        const {bm} = cube()
        for (const e of bm.edges) expect(validateRadial(e)).toEqual([])
    })
})

describe('loop cycle', () => {
    it('runs in winding order and closes', () => {
        const {f, a, b, c} = triangle()
        expect(f.len).toBe(3)
        expect(f.verts()).toEqual([a, b, c])
        const loops = f.loops()
        expect(loops[0].next).toBe(loops[1])
        expect(loops[2].next).toBe(loops[0])
        expect(loops[0].prev).toBe(loops[2])
    })

    it('gives each loop the edge spanning it and the next vertex', () => {
        const {bm} = cube()
        let checked = 0
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                expect(l.e!.joins(l.v, l.next.v)).toBe(true)
                checked++
            }
        }
        expect(checked).toBe(24)
    })
})

describe('kill operations', () => {
    it('faceKill removes loops but leaves edges and vertices', () => {
        const {bm, f} = triangle()
        bm.faceKill(f)
        expect(bm.totface).toBe(0)
        expect(bm.totloop).toBe(0)
        expect(bm.totedge).toBe(3)
        expect(bm.totvert).toBe(3)
        for (const e of bm.edges) expect(edgeIsWire(e)).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('edgeKill cascades to the faces using it', () => {
        const {bm} = cube()
        const e = bm.edges.values().next().value!
        bm.edgeKill(e)
        // Both faces that shared the edge go with it.
        expect(bm.totface).toBe(4)
        expect(bm.totedge).toBe(11)
        expect(bm.totvert).toBe(8)
        expect(bm.validate()).toEqual([])
    })

    it('vertKill cascades to edges and faces', () => {
        const {bm, verts} = cube()
        bm.vertKill(verts[0])
        expect(bm.totvert).toBe(7)
        // The corner had 3 edges and 3 faces.
        expect(bm.totedge).toBe(9)
        expect(bm.totface).toBe(3)
        expect(bm.validate()).toEqual([])
    })

    it('killing the whole cube leaves an empty, valid mesh', () => {
        const {bm, verts} = cube()
        for (const v of verts) bm.vertKill(v)
        expect(bm.totvert).toBe(0)
        expect(bm.totedge).toBe(0)
        expect(bm.totface).toBe(0)
        expect(bm.totloop).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('killing an element twice is a no-op', () => {
        const {bm, f} = triangle()
        bm.faceKill(f)
        bm.faceKill(f)
        expect(bm.totface).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('drops killed elements from the selection history and active face', () => {
        const {bm, f, a} = triangle()
        bm.selectHistory.push({elem: f}, {elem: a})
        bm.actFace = f
        bm.faceKill(f)
        expect(bm.actFace).toBeNull()
        expect(bm.selectHistory.map(h => h.elem)).toEqual([a])
        expect(bm.validate()).toEqual([])
    })
})

describe('validation detects corruption', () => {
    it('catches a broken disk link', () => {
        const {bm, verts} = cube()
        verts[0].e!.setDiskNext(verts[0], null)
        expect(bm.validate().join('\n')).toMatch(/disk cycle has a null link/)
    })

    it('catches a face whose len disagrees with its cycle', () => {
        const {bm, f} = triangle()
        f.len = 4
        expect(bm.validate().join('\n')).toMatch(/says len 4 but its cycle has 3 loops/)
    })

    it('catches a loop pointing at the wrong face', () => {
        const {bm, f} = triangle()
        const other = bm.faceCreate([bm.vertCreate(5, 0, 0), bm.vertCreate(6, 0, 0), bm.vertCreate(5, 1, 0)])
        f.lFirst.f = other
        expect(bm.validate().join('\n')).toMatch(/points at face/)
    })

    it('assertValid throws listing the problems', () => {
        const {bm, f} = triangle()
        f.len = 99
        expect(() => bm.assertValid()).toThrow(/invalid BMesh/)
    })
})

describe('index and table access', () => {
    it('assigns contiguous indices and resolves them back', () => {
        const {bm} = cube()
        bm.elemIndexEnsure()
        const seen = new Set<number>()
        for (const v of bm.verts) seen.add(v.index)
        expect(seen.size).toBe(8)
        expect(Math.max(...seen)).toBe(7)
        expect(bm.vertAt(3).index).toBe(3)
        expect(bm.faceAt(0).len).toBe(4)
    })
})

describe('describe', () => {
    it('summarises the mesh', () => {
        expect(cube().bm.describe()).toBe('verts 8, edges 12, faces 6, loops 24')
    })
})

describe('element flag defaults, against bmesh_core.cc', () => {
    // These three lines of Blender decide whether a generated mesh renders faceted or inflated, and
    // they do not agree with each other:
    //   v->head.hflag = 0               bmesh_core.cc:161
    //   e->head.hflag = BM_ELEM_SMOOTH  bmesh_core.cc:250
    //   f->head.hflag = 0               bmesh_core.cc:493
    // A face defaulting to smooth is what made every primitive bake with averaged vertex normals.
    it('creates faces flat and edges smooth', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(1, 1, 0)

        expect(a.hflag).toBe(0)
        expect(bm.edgeCreate(a, b).hflag & ElemFlag.Smooth).toBe(ElemFlag.Smooth)

        const f = bm.faceCreate([a, b, c])
        expect(f.hflag & ElemFlag.Smooth).toBe(0)
    })

    it('takes the smooth flag from an example face', () => {
        const bm = new BMesh()
        const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0)]
        const example = bm.faceCreate(v)
        example.hflag |= ElemFlag.Smooth

        const w = [bm.vertCreate(0, 0, 1), bm.vertCreate(1, 0, 1), bm.vertCreate(1, 1, 1)]
        expect(bm.faceCreate(w, example).hflag & ElemFlag.Smooth).toBe(ElemFlag.Smooth)
    })
})
