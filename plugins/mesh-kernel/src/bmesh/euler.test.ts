import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMFace, BMVert} from './types'
import {joinEdgeKillVert, joinFaceKillEdge, splitEdgeMakeVert, splitFaceMakeEdge} from './euler'
import {diskCount, diskEdgeExists, edgeIsManifold, radialLength} from './structure'
import {AttrDomain} from '../constants'
import {getComponent, setValue} from './customdata'

function quad() {
    const bm = new BMesh()
    const a = bm.vertCreate(0, 0, 0)
    const b = bm.vertCreate(1, 0, 0)
    const c = bm.vertCreate(1, 1, 0)
    const d = bm.vertCreate(0, 1, 0)
    const f = bm.faceCreate([a, b, c, d])
    return {bm, a, b, c, d, f}
}

/** Two quads sharing one edge, so the shared edge is manifold. */
function twoQuads() {
    const bm = new BMesh()
    const v = [
        bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0),
        bm.vertCreate(2, 1, 0), bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
    ]
    const f1 = bm.faceCreate([v[0], v[1], v[4], v[5]])
    const f2 = bm.faceCreate([v[1], v[2], v[3], v[4]])
    const shared = diskEdgeExists(v[1], v[4])!
    return {bm, v, f1, f2, shared}
}

function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s],
        [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    for (const f of [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]) {
        bm.faceCreate(f.map(i => verts[i]))
    }
    return {bm, verts}
}

describe('splitEdgeMakeVert', () => {
    it('splits a boundary edge of a single quad, giving it a fifth corner', () => {
        const {bm, a, b, f} = quad()
        const e = diskEdgeExists(a, b)!
        const {vNew, eNew} = splitEdgeMakeVert(bm, e, b)

        expect(bm.totvert).toBe(5)
        expect(bm.totedge).toBe(5)
        expect(bm.totface).toBe(1)
        expect(f.len).toBe(5)
        expect(bm.totloop).toBe(5)
        expect(diskCount(vNew)).toBe(2)
        expect(eNew.joins(b, vNew)).toBe(true)
        expect(e.joins(a, vNew)).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('splits a manifold edge, extending both adjacent faces', () => {
        const {bm, f1, f2, shared} = twoQuads()
        const {vNew} = splitEdgeMakeVert(bm, shared, shared.v1)

        expect(f1.len).toBe(5)
        expect(f2.len).toBe(5)
        expect(bm.totvert).toBe(7)
        expect(bm.totface).toBe(2)
        expect(diskCount(vNew)).toBe(2)
        // Both halves of the split edge stay manifold.
        for (const e of bm.edges) {
            if (e.uses(vNew)) expect(radialLength(e)).toBe(2)
        }
        expect(bm.validate()).toEqual([])
    })

    it('places the new vertex at the given factor along the edge', () => {
        const {bm, a, b} = quad()
        const e = diskEdgeExists(a, b)!
        const {vNew} = splitEdgeMakeVert(bm, e, a, 0.25)
        // From a (0,0,0) a quarter of the way to b (1,0,0).
        expect(vNew.x).toBeCloseTo(0.25, 6)
        expect(vNew.y).toBeCloseTo(0, 6)
        expect(bm.validate()).toEqual([])
    })

    it('interpolates vertex attributes at the split point', () => {
        const {bm, a, b} = quad()
        const layer = bm.addLayer('vert', 'weight', 'float')
        setValue(a, bm.vdata, layer, [0])
        setValue(b, bm.vdata, layer, [8])
        const e = diskEdgeExists(a, b)!
        const {vNew} = splitEdgeMakeVert(bm, e, a, 0.25)
        expect(getComponent(vNew, layer)).toBeCloseTo(2, 5)
    })

    it('splits a wire edge with no faces', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const e = bm.edgeCreate(a, b)
        const {vNew} = splitEdgeMakeVert(bm, e, b)
        expect(bm.totvert).toBe(3)
        expect(bm.totedge).toBe(2)
        expect(bm.totface).toBe(0)
        expect(diskCount(vNew)).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('splits every edge of a cube and keeps it valid and manifold', () => {
        const {bm} = cube()
        for (const e of [...bm.edges]) splitEdgeMakeVert(bm, e, e.v1, 0.5)
        expect(bm.totvert).toBe(8 + 12)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(6)
        for (const f of bm.faces) expect(f.len).toBe(8)
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('rejects a vertex that is not on the edge', () => {
        const {bm, a, b, c} = quad()
        const e = diskEdgeExists(a, b)!
        expect(() => splitEdgeMakeVert(bm, e, c)).toThrow(/does not use vertex/)
    })
})

describe('splitFaceMakeEdge', () => {
    it('cuts a quad into two triangles along a diagonal', () => {
        const {bm, f} = quad()
        const loops = f.loops()
        const {fNew, eNew} = splitFaceMakeEdge(bm, f, loops[0], loops[2])

        expect(bm.totface).toBe(2)
        expect(f.len).toBe(3)
        expect(fNew.len).toBe(3)
        expect(bm.totloop).toBe(6)
        expect(bm.totedge).toBe(5)
        expect(radialLength(eNew)).toBe(2)
        expect(edgeIsManifold(eNew)).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('cuts a hexagon into a quad and a quad', () => {
        const bm = new BMesh()
        const v: BMVert[] = []
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            v.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
        }
        const f = bm.faceCreate(v)
        const loops = f.loops()
        const {fNew} = splitFaceMakeEdge(bm, f, loops[0], loops[3])
        expect(f.len + fNew.len).toBe(8) // 6 corners plus the 2 on the new edge
        expect(f.len).toBe(4)
        expect(fNew.len).toBe(4)
        expect(bm.validate()).toEqual([])
    })

    it('gives the new face the original material and flags', () => {
        const {bm, f} = quad()
        f.matNr = 3
        const layer = bm.addLayer('face', 'group', 'int32')
        setValue(f, bm.pdata, layer, [7])
        const loops = f.loops()
        const {fNew} = splitFaceMakeEdge(bm, f, loops[0], loops[2])
        expect(fNew.matNr).toBe(3)
        expect(getComponent(fNew, layer)).toBe(7)
    })

    it('refuses to split between adjacent loops', () => {
        const {bm, f} = quad()
        const loops = f.loops()
        expect(() => splitFaceMakeEdge(bm, f, loops[0], loops[1])).toThrow(/adjacent loops/)
    })

    it('refuses loops from a different face', () => {
        const {bm, f1, f2} = twoQuads()
        expect(() => splitFaceMakeEdge(bm, f1, f1.loops()[0], f2.loops()[2]))
            .toThrow(/must belong to face/)
    })

    it('splitting every face of a cube keeps it valid', () => {
        const {bm} = cube()
        for (const f of [...bm.faces]) {
            const loops = f.loops()
            splitFaceMakeEdge(bm, f, loops[0], loops[2])
        }
        expect(bm.totface).toBe(12)
        expect(bm.totedge).toBe(18)
        expect(bm.totvert).toBe(8)
        // A triangulated cube: V - E + F = 8 - 18 + 12 = 2.
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
    })
})

describe('joinFaceKillEdge', () => {
    it('merges two quads into a hexagon', () => {
        const {bm, f1, f2, shared} = twoQuads()
        const merged = joinFaceKillEdge(bm, f1, f2, shared)

        expect(merged).toBe(f1)
        expect(bm.totface).toBe(1)
        expect(f1.len).toBe(6)
        expect(bm.totedge).toBe(6)
        expect(bm.totloop).toBe(6)
        expect(bm.validate()).toEqual([])
    })

    it('is the inverse of splitFaceMakeEdge', () => {
        const {bm, f} = quad()
        const before = f.verts().map(v => v.id)
        const loops = f.loops()
        const {fNew, eNew} = splitFaceMakeEdge(bm, f, loops[0], loops[2])
        expect(bm.totface).toBe(2)

        const merged = joinFaceKillEdge(bm, f, fNew, eNew)
        expect(merged).toBe(f)
        expect(bm.totface).toBe(1)
        expect(f.len).toBe(4)
        expect(bm.totedge).toBe(4)
        // The rim is the same set of vertices, though the cycle may start elsewhere.
        expect(new Set(f.verts().map(v => v.id))).toEqual(new Set(before))
        expect(bm.validate()).toEqual([])
    })

    it('refuses to join a face to itself', () => {
        const {bm, f1, shared} = twoQuads()
        expect(joinFaceKillEdge(bm, f1, f1, shared)).toBeNull()
    })

    it('refuses a boundary edge, which has only one face', () => {
        const {bm, a, b, f} = quad()
        const e = diskEdgeExists(a, b)!
        expect(joinFaceKillEdge(bm, f, f, e)).toBeNull()
        expect(bm.totface).toBe(1)
    })

    it('refuses when the faces share more than one edge', () => {
        // Two triangles glued along two edges would fold; the check must reject it.
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(0, 1, 0)
        const f1 = bm.faceCreate([a, b, c])
        const f2 = bm.faceCreate([c, b, a])
        const shared = diskEdgeExists(a, b)!
        expect(joinFaceKillEdge(bm, f1, f2, shared)).toBeNull()
        expect(bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('leaves the mesh untouched when it refuses', () => {
        const {bm, f1, f2, shared} = twoQuads()
        const before = bm.describe()
        // Same winding on both sides makes the join illegal.
        expect(joinFaceKillEdge(bm, f1, f1, shared)).toBeNull()
        expect(bm.describe()).toBe(before)
        expect(bm.validate()).toEqual([])
    })

    it('merges two faces of a cube, leaving a valid five-face mesh', () => {
        const {bm} = cube()
        const e = [...bm.edges].find(x => edgeIsManifold(x))!
        const [l1, l2] = [...(function* () {
            let l = e.l!
            const first = l
            do {
                yield l
                l = l.radialNext!
            } while (l !== first)
        })()]
        const merged = joinFaceKillEdge(bm, l1.f, l2.f, e)
        expect(merged).not.toBeNull()
        expect(bm.totface).toBe(5)
        expect(bm.totedge).toBe(11)
        expect(merged!.len).toBe(6)
        expect(bm.validate()).toEqual([])
    })
})

describe('joinEdgeKillVert', () => {
    it('dissolves a vertex inserted into a quad edge, restoring the quad', () => {
        const {bm, a, b, f} = quad()
        const e = diskEdgeExists(a, b)!
        const {vNew, eNew} = splitEdgeMakeVert(bm, e, b)
        expect(f.len).toBe(5)

        const survivor = joinEdgeKillVert(bm, eNew, vNew)
        expect(survivor).not.toBeNull()
        expect(bm.totvert).toBe(4)
        expect(bm.totedge).toBe(4)
        expect(f.len).toBe(4)
        expect(bm.totloop).toBe(4)
        expect(bm.validate()).toEqual([])
    })

    it('refuses a vertex whose valence is not two', () => {
        const {bm, verts} = cube()
        const corner = verts[0]
        expect(diskCount(corner)).toBe(3)
        const before = bm.describe()
        expect(joinEdgeKillVert(bm, corner.e!, corner)).toBeNull()
        expect(bm.describe()).toBe(before)
        expect(bm.validate()).toEqual([])
    })

    it('refuses when the result would be a degenerate edge', () => {
        // A triangle's corner has valence 2, but dissolving it would collapse the face.
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(0, 1, 0)
        bm.faceCreate([a, b, c])
        const e = diskEdgeExists(a, b)!
        expect(joinEdgeKillVert(bm, e, a)).toBeNull()
        expect(bm.totface).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('dissolves a vertex on a wire chain', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(2, 0, 0)
        const e1 = bm.edgeCreate(a, b)
        bm.edgeCreate(b, c)
        const survivor = joinEdgeKillVert(bm, e1, b)
        expect(survivor).not.toBeNull()
        expect(bm.totvert).toBe(2)
        expect(bm.totedge).toBe(1)
        expect(survivor!.joins(a, c) || survivor!.joins(c, a)).toBe(true)
        expect(bm.validate()).toEqual([])
    })
})

describe('Euler characteristic is preserved', () => {
    it('holds across a split-then-join round trip on a cube', () => {
        const {bm} = cube()
        const chi = () => bm.totvert - bm.totedge + bm.totface
        expect(chi()).toBe(2)

        for (const e of [...bm.edges]) splitEdgeMakeVert(bm, e, e.v1, 0.5)
        expect(chi()).toBe(2)

        for (const f of [...bm.faces]) {
            const loops = f.loops()
            splitFaceMakeEdge(bm, f, loops[0], loops[Math.floor(loops.length / 2)])
        }
        expect(chi()).toBe(2)
        expect(bm.validate()).toEqual([])
    })
})

describe('joinEdgeKillVert across every configuration', () => {
    // Regression guard. The first implementation unlinked the dropped loop without repointing its
    // edge's radial entry, leaving `e.l` dangling at a deleted loop. Only some relative positions of
    // the dropped loop trigger it, so the hand-written cases above all passed while the code was
    // wrong. Splitting and rejoining every edge of several n-gons, in both orientations, catches it.
    for (const n of [3, 4, 5, 6, 8]) {
        for (const which of [0, 1] as const) {
            it(`splits and rejoins every edge of a ${n}-gon, tv=v${which + 1}`, () => {
                const bm = new BMesh()
                const v: BMVert[] = []
                for (let i = 0; i < n; i++) {
                    const a = (i / n) * Math.PI * 2
                    v.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
                }
                const f = bm.faceCreate(v)

                for (const e of [...bm.edges]) {
                    const tv = which === 0 ? e.v1 : e.v2
                    const {vNew, eNew} = splitEdgeMakeVert(bm, e, tv, 0.5)
                    expect(bm.validate()).toEqual([])
                    expect(f.len).toBe(n + 1)

                    expect(joinEdgeKillVert(bm, eNew, vNew)).not.toBeNull()
                    expect(bm.validate()).toEqual([])
                    expect(f.len).toBe(n)
                }

                expect(bm.totvert).toBe(n)
                expect(bm.totedge).toBe(n)
                expect(bm.totface).toBe(1)
            })
        }
    }

    it('also holds on a closed cube, where every edge is manifold', () => {
        const {bm} = cube()
        for (const e of [...bm.edges]) {
            const {vNew, eNew} = splitEdgeMakeVert(bm, e, e.v1, 0.5)
            expect(bm.validate()).toEqual([])
            expect(joinEdgeKillVert(bm, eNew, vNew)).not.toBeNull()
            expect(bm.validate()).toEqual([])
        }
        expect(bm.describe()).toBe('verts 8, edges 12, faces 6, loops 24')
    })
})
