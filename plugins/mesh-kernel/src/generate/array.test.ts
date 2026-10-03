import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {radialLoops} from '../bmesh/structure'
import {AttrType} from '../constants'
import {getComponent, setComponent} from '../bmesh/customdata'
import {Vec3, mat4RotationAxis, mat4Scale, mat4TransformPoint} from '../math'
import {
    arrayCurve,
    arrayGeometry,
    arrayLinear,
    arrayRadial,
    curvePathFromPolyline,
    polylineLength,
    whereOnPath,
} from './array'
import {
    boundaryEdgeCount,
    distinctPositionCount,
    eulerCharacteristic,
    faceCenter,
    windingProblems,
} from './topology.testutil'

// region fixtures

/** A closed box. Six quads, so arraying it end to end leaves coincident interior faces. */
function box(bm: BMesh, x0 = 0, x1 = 1, y0 = 0, y1 = 1, z0 = 0, z1 = 1): {verts: BMVert[], faces: BMFace[]} {
    const co: Vec3[] = [
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1],
        [x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1],
    ]
    const verts = co.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {verts, faces}
}

/**
 * The same box with the two faces perpendicular to X removed: an open tube along X. Arraying this
 * end to end has nothing coincident to remove, so the weld has to produce a manifold surface.
 */
function tubeX(bm: BMesh, x0 = 0, x1 = 1): {verts: BMVert[], faces: BMFace[]} {
    const co: Vec3[] = [
        [x0, 0, 0], [x0, 0, 1], [x0, 1, 0], [x0, 1, 1],
        [x1, 0, 0], [x1, 0, 1], [x1, 1, 0], [x1, 1, 1],
    ]
    const verts = co.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = [[2, 3, 7, 6], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {verts, faces}
}

/** One sector of an annulus, sized so `count` of them rotated by `2pi/count` tile the ring exactly. */
function annulusSector(bm: BMesh, count: number, rInner = 1, rOuter = 2): BMFace {
    const rot = mat4RotationAxis([0, 1, 0], Math.PI * 2 / count)
    const a: Vec3 = [rInner, 0, 0]
    const b: Vec3 = [rOuter, 0, 0]
    const c = mat4TransformPoint(rot, b)
    const d = mat4TransformPoint(rot, a)
    return bm.faceCreate([a, b, c, d].map(p => bm.vertCreate(p[0], p[1], p[2])))
}

/** How many edges have 0, 1, 2, ... faces. The quickest way to see that a weld really joined things. */
function radialHistogram(bm: BMesh): Record<number, number> {
    const h: Record<number, number> = {}
    for (const e of bm.edges) {
        const n = [...radialLoops(e)].length
        h[n] = (h[n] ?? 0) + 1
    }
    return h
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

// endregion

describe('arrayGeometry - counts and fit', () => {
    it('makes `count` copies including the original, and leaves the mesh valid', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        const r = arrayGeometry(bm, {faces}, {count: 3, useConstantOffset: true, constantOffset: [2, 0, 0]})

        // 3 x (8 verts, 12 edges, 6 faces), nothing merged.
        expect(bm.totvert).toBe(24)
        expect(bm.totedge).toBe(36)
        expect(bm.totface).toBe(18)
        expect(r.count).toBe(3)
        expect(r.copies.length).toBe(3)
        expect(r.verts.length).toBe(24)
        expect(r.edges.length).toBe(36)
        expect(r.faces.length).toBe(18)
        expect(bm.validate()).toEqual([])
        // Three separate closed boxes: chi = 3 x 2.
        expect(eulerCharacteristic(bm)).toBe(6)
    })

    it('defaults to two copies, as the modifier does', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        const r = arrayGeometry(bm, {faces}, {useConstantOffset: true, constantOffset: [2, 0, 0]})
        expect(r.count).toBe(2)
        expect(bm.totvert).toBe(16)
    })

    it('pulls in the vertices and edges its faces need, like the duplicate does', () => {
        const bm = new BMesh()
        const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0)]
        const f = bm.faceCreate(v)
        const r = arrayGeometry(bm, {faces: [f]}, {count: 2, useConstantOffset: true, constantOffset: [5, 0, 0]})
        expect(r.verts.length).toBe(6)
        expect(r.edges.length).toBe(6)
        expect(r.faces.length).toBe(2)
    })

    it('fitLength divides the length by the offset: count = trunc(length / dist) + 1', () => {
        // `count = (length + float_epsilon) / dist + 1`, truncated.
        for (const [length, step, expected] of [[5, 2, 3], [6, 2, 4], [1, 2, 1], [0, 2, 1]] as const) {
            const bm = new BMesh()
            const {faces} = box(bm)
            const r = arrayGeometry(bm, {faces}, {
                fitType: 'fitLength', length, useConstantOffset: true, constantOffset: [step, 0, 0],
            })
            expect(r.count, `length ${length} step ${step}`).toBe(expected)
        }
    })

    it('fitLength measures the whole offset vector, not just one axis', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        // |(3, 4, 0)| is 5, so a length of 10 fits two gaps and three copies.
        const r = arrayGeometry(bm, {faces}, {
            fitType: 'fitLength', length: 10, useConstantOffset: true, constantOffset: [3, 4, 0],
        })
        expect(r.count).toBe(3)
    })

    it('fitCurve takes its length from the polyline, and a closed path is longer by its last segment', () => {
        const square: Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]]
        expect(polylineLength(square, false)).toBeCloseTo(9, 12)
        expect(polylineLength(square, true)).toBeCloseTo(12, 12)

        const open = new BMesh()
        const r1 = arrayGeometry(open, {faces: box(open).faces}, {
            fitType: 'fitCurve', curve: square, useConstantOffset: true, constantOffset: [1, 0, 0],
        })
        expect(r1.count).toBe(10) // 9 / 1 + 1

        const closed = new BMesh()
        const r2 = arrayGeometry(closed, {faces: box(closed).faces}, {
            fitType: 'fitCurve', curve: square, curveClosed: true,
            useConstantOffset: true, constantOffset: [1, 0, 0],
        })
        expect(r2.count).toBe(13) // 12 / 1 + 1
    })

    it('falls back to one copy with an error when the offset has no translation', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        const r = arrayGeometry(bm, {faces}, {
            fitType: 'fitLength', length: 10, useConstantOffset: true, constantOffset: [0, 0, 0],
        })
        expect(r.count).toBe(1)
        expect(r.warning).toMatch(/offset is too small/)
        expect(bm.totvert).toBe(8)
    })
})

describe('arrayGeometry - the three offset sources', () => {
    it('constant offset puts copy n at n * step', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm)
        const r = arrayGeometry(bm, {faces}, {count: 4, useConstantOffset: true, constantOffset: [2, 0.5, 0]})
        for (let c = 0; c < 4; c++) {
            const copy = r.copies[c].vertMap.get(verts[0])!
            expect(copy.x).toBeCloseTo(verts[0].x + 2 * c, 12)
            expect(copy.y).toBeCloseTo(verts[0].y + 0.5 * c, 12)
            expect(copy.z).toBeCloseTo(verts[0].z, 12)
        }
    })

    it('relative offset is a fraction of the bounding box, so the spacing scales with the input', () => {
        for (const width of [1, 3, 0.25]) {
            const bm = new BMesh()
            const {verts, faces} = box(bm, 0, width)
            const r = arrayGeometry(bm, {faces}, {count: 3, useRelativeOffset: true, relativeOffset: [1, 0, 0]})
            const copy1 = r.copies[1].vertMap.get(verts[0])!
            const copy2 = r.copies[2].vertMap.get(verts[0])!
            expect(copy1.x - verts[0].x, `width ${width}`).toBeCloseTo(width, 12)
            expect(copy2.x - verts[0].x, `width ${width}`).toBeCloseTo(2 * width, 12)
        }
    })

    it('relative offset of a half is half the box, per axis', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 0, 2, 0, 6, 0, 1)
        const r = arrayGeometry(bm, {faces}, {count: 2, useRelativeOffset: true, relativeOffset: [0.5, 1, 0]})
        const copy = r.copies[1].vertMap.get(verts[0])!
        expect(copy.x - verts[0].x).toBeCloseTo(1, 12)
        expect(copy.y - verts[0].y).toBeCloseTo(6, 12)
        expect(copy.z - verts[0].z).toBeCloseTo(0, 12)
    })

    it('adds the offset sources together rather than choosing between them', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 0, 2)
        const r = arrayGeometry(bm, {faces}, {
            count: 2,
            useConstantOffset: true, constantOffset: [0.5, 0, 0],
            useRelativeOffset: true, relativeOffset: [1, 0, 0],
        })
        // 0.5 constant + 1 x the box's width of 2.
        const copy = r.copies[1].vertMap.get(verts[0])!
        expect(copy.x - verts[0].x).toBeCloseTo(2.5, 12)
    })

    it('object offset accumulates per copy: copy n sits at offset^n', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 1, 2)
        const step = mat4RotationAxis([0, 1, 0], Math.PI / 2)
        const r = arrayGeometry(bm, {faces}, {count: 5, useObjectOffset: true, objectOffset: step})

        for (const v of verts) {
            let expected: Vec3 = [v.x, v.y, v.z]
            for (let c = 0; c < 5; c++) {
                const copy = r.copies[c].vertMap.get(v)!
                expect(copy.x).toBeCloseTo(expected[0], 12)
                expect(copy.y).toBeCloseTo(expected[1], 12)
                expect(copy.z).toBeCloseTo(expected[2], 12)
                expected = mat4TransformPoint(step, expected)
            }
        }
    })

    it('a quarter-turn object offset brings the fifth copy back onto the first', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 1, 2)
        const step = mat4RotationAxis([0, 1, 0], Math.PI / 2)
        const r = arrayGeometry(bm, {faces}, {count: 5, useObjectOffset: true, objectOffset: step})

        // `final_offset` is offset^4, which for a quarter turn is the identity.
        for (let i = 0; i < 16; i++) {
            expect(r.finalOffset[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 12)
        }
        for (const v of verts) {
            const first = r.copies[0].vertMap.get(v)!
            const fifth = r.copies[4].vertMap.get(v)!
            expect(fifth.x).toBeCloseTo(first.x, 12)
            expect(fifth.y).toBeCloseTo(first.y, 12)
            expect(fifth.z).toBeCloseTo(first.z, 12)
        }
    })
})

describe('arrayGeometry - the merge', () => {
    it('welds a chain of boxes when the offset equals their width', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        const r = arrayLinear(bm, {faces}, {count: 3, step: [1, 0, 0], merge: true})

        // Three boxes share two seams. Unwelded that is 24 verts; welded it is four rings of four.
        expect(bm.totvert).toBe(16)
        expect(r.merged.length).toBe(8) // two seams, four vertices each
        // Four rings of four edges, plus four rails across each of the three boxes.
        expect(bm.totedge).toBe(4 * 4 + 3 * 4)
        // 18 faces, less the two interior quads that turned out to already exist.
        expect(bm.totface).toBe(16)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        expect(distinctPositionCount(bm)).toBe(bm.totvert)
        expect(eulerCharacteristic(bm)).toBe(16 - 28 + 16)

        // The chain really is one piece: the interior edges carry the shared quad as well as the two
        // side faces, which is what an arrayed *closed* box gives in Blender too - the interior faces
        // are not removed, only de-duplicated.
        expect(radialHistogram(bm)).toEqual({2: 20, 3: 8})
    })

    it('welds nothing when the offset is larger than the geometry', () => {
        const bm = new BMesh()
        const {faces} = box(bm)
        const r = arrayLinear(bm, {faces}, {count: 3, step: [1.5, 0, 0], merge: true})

        expect(r.merged.length).toBe(0)
        expect(bm.totvert).toBe(24)
        expect(bm.totedge).toBe(36)
        expect(bm.totface).toBe(18)
        expect(bm.validate()).toEqual([])
    })

    it('welds an open tube into a single manifold tube', () => {
        const bm = new BMesh()
        const {faces} = tubeX(bm)
        const r = arrayLinear(bm, {faces}, {count: 3, step: [1, 0, 0], merge: true})

        expect(r.merged.length).toBe(8)
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(28)
        expect(bm.totface).toBe(12)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        // Nothing is non-manifold: 8 boundary edges at the two open ends, everything else has 2 faces.
        expect(radialHistogram(bm)).toEqual({1: 8, 2: 20})
        expect(boundaryEdgeCount(bm)).toBe(8)
        expect(eulerCharacteristic(bm)).toBe(0) // a tube
        expect(distinctPositionCount(bm)).toBe(bm.totvert)
    })

    it('respects the merge threshold', () => {
        // A gap of 0.05 between copies: welded at a threshold of 0.1, kept at 0.01.
        const welded = new BMesh()
        arrayLinear(welded, {faces: tubeX(welded).faces}, {
            count: 3, step: [1.05, 0, 0], merge: true, mergeThreshold: 0.1,
        })
        expect(welded.totvert).toBe(16)

        const kept = new BMesh()
        arrayLinear(kept, {faces: tubeX(kept).faces}, {
            count: 3, step: [1.05, 0, 0], merge: true, mergeThreshold: 0.01,
        })
        expect(kept.totvert).toBe(24)
    })

    it('propagates the mapping through a long chain', () => {
        // The `!offset_has_scale && c >= 2` shortcut translates chunk 2's mapping instead of
        // recomputing it, so a long chain must still weld every seam.
        const bm = new BMesh()
        const {faces} = tubeX(bm)
        arrayLinear(bm, {faces}, {count: 10, step: [1, 0, 0], merge: true})
        expect(bm.totvert).toBe(11 * 4)
        expect(bm.totface).toBe(10 * 4)
        expect(bm.validate()).toEqual([])
        // 11 rings of 4 edges plus 10 runs of 4 rails; the two end rings are the boundary.
        expect(bm.totedge).toBe(11 * 4 + 10 * 4)
        expect(radialHistogram(bm)).toEqual({1: 8, 2: 76})
        expect(boundaryEdgeCount(bm)).toBe(8)
    })

    it('still welds when the offset scales, taking the slow path', () => {
        // A scaling offset makes each gap a different size, so Blender skips the "chunk n is chunk
        // n-1 translated" shortcut and re-runs `dm_mvert_map_doubles` for every pair. A tapered tube
        // is the shape where a scaling offset still produces coincident seams: each copy's near ring
        // is the previous copy's far ring.
        const bm = new BMesh()
        const ring0: Vec3[] = [[0, -1, -1], [0, -1, 1], [0, 1, 1], [0, 1, -1]]
        const ring1: Vec3[] = [[1, -0.5, -0.5], [1, -0.5, 0.5], [1, 0.5, 0.5], [1, 0.5, -0.5]]
        const a = ring0.map(p => bm.vertCreate(p[0], p[1], p[2]))
        const b = ring1.map(p => bm.vertCreate(p[0], p[1], p[2]))
        const faces: BMFace[] = []
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4
            faces.push(bm.faceCreate([a[i], a[j], b[j], b[i]]))
        }

        const r = arrayGeometry(bm, {faces}, {
            count: 4,
            useConstantOffset: true, constantOffset: [1, 0, 0],
            useObjectOffset: true, objectOffset: mat4Scale([1, 0.5, 0.5]),
            useMerge: true, mergeThreshold: 1e-9,
        })

        expect(r.merged.length).toBe(12) // three seams of four
        expect(bm.totvert).toBe(20) // five rings of four
        expect(bm.totface).toBe(16)
        expect(bm.validate()).toEqual([])
        expect(radialHistogram(bm)).toEqual({1: 8, 2: 4 * 5 + 4 * 4 - 8})
        // Each ring is half the size of the one before it.
        for (let c = 0; c < 4; c++) {
            const copy = r.copies[c].vertMap.get(a[0])!
            expect(copy.y, `copy ${c}`).toBeCloseTo(-Math.pow(0.5, c), 12)
        }
    })
})

describe('arrayGeometry - caps', () => {
    it('places a start cap one step before the first copy and an end cap one step after the last', () => {
        const bm = new BMesh()
        const {faces} = tubeX(bm) // x from 0 to 1
        // The cap is authored one step forward, at x = 1, because Blender puts the start cap at
        // `inverse(offset)`; that lands this one on the tube's x = 0 opening.
        const capFace = bm.faceCreate([
            bm.vertCreate(1, 0, 0), bm.vertCreate(1, 0, 1),
            bm.vertCreate(1, 1, 1), bm.vertCreate(1, 1, 0),
        ])

        const r = arrayGeometry(bm, {faces}, {
            count: 3,
            useConstantOffset: true, constantOffset: [1, 0, 0],
            startCap: {faces: [capFace]},
            endCap: {faces: [capFace]},
        })

        // Three tube copies (24 verts) plus the two cap copies (4 each). The authored cap square
        // itself is not part of the array; it was duplicated, not consumed.
        expect(r.verts.length).toBe(24 + 8)
        expect(bm.totvert).toBe(24 + 8 + 4)

        const at = (x: number) => r.verts.filter(v => Math.abs(v.x - x) < 1e-9).length
        expect(at(-1)).toBe(0)
        expect(at(0)).toBe(4 + 4) // the tube's first ring and the start cap on top of it
        expect(at(1)).toBe(8)
        expect(at(2)).toBe(8)
        // The end cap is at `final_offset * offset`, three steps on from x = 1.
        expect(at(3)).toBe(4)
        expect(at(4)).toBe(4)
        expect(bm.validate()).toEqual([])
    })

    it('welds a cap onto the chunk it abuts', () => {
        const bm = new BMesh()
        const {faces} = tubeX(bm)
        // A square exactly on the tube's x = 0 opening, so the start cap lands on x = -1 ... which
        // is where `inverse(offset)` puts it, and the first chunk starts at x = 0. Offset it so the
        // cap's own copy lands on the seam.
        const capVerts = [
            bm.vertCreate(1, 0, 0), bm.vertCreate(1, 0, 1),
            bm.vertCreate(1, 1, 1), bm.vertCreate(1, 1, 0),
        ]
        const capFace = bm.faceCreate(capVerts)

        const r = arrayGeometry(bm, {faces}, {
            count: 2,
            useConstantOffset: true, constantOffset: [1, 0, 0],
            startCap: {faces: [capFace]},
            useMerge: true,
        })
        // The start cap copy lands at x = 0, on the tube's opening, and welds to it.
        expect(r.merged.length).toBeGreaterThan(0)
        expect(bm.validate()).toEqual([])
    })
})

describe('arrayGeometry - UV offset', () => {
    it('shifts every float2 corner layer by the offset times the copy index', () => {
        const bm = new BMesh()
        const layer = bm.addLayer('loop', 'uv', 'float2' as AttrType)
        const {faces} = box(bm)
        for (const f of faces) {
            for (const l of f.eachLoop()) {
                setComponent(l, bm.ldata, layer, 0, 0.25)
                setComponent(l, bm.ldata, layer, 1, 0.5)
            }
        }

        const r = arrayGeometry(bm, {faces}, {
            count: 3, useConstantOffset: true, constantOffset: [2, 0, 0], uvOffset: [1, -0.1],
        })

        for (let c = 0; c < 3; c++) {
            const f = r.copies[c].faceMap.get(faces[0])!
            const l = f.lFirst
            expect(getComponent(l, layer, 0)).toBeCloseTo(0.25 + c, 6)
            expect(getComponent(l, layer, 1)).toBeCloseTo(0.5 - 0.1 * c, 6)
        }
    })
})

describe('arrayLinear', () => {
    it('is the general array with only a constant offset', () => {
        const a = new BMesh()
        const ra = arrayLinear(a, {faces: box(a).faces}, {count: 4, step: [1.5, 0, 0]})

        const b = new BMesh()
        const rb = arrayGeometry(b, {faces: box(b).faces}, {
            count: 4, useConstantOffset: true, constantOffset: [1.5, 0, 0],
        })

        expect(ra.count).toBe(rb.count)
        expect(a.describe()).toBe(b.describe())
        expect([...a.verts].map(v => v.x).sort()).toEqual([...b.verts].map(v => v.x).sort())
    })
})

describe('arrayRadial', () => {
    it('spreads `count` copies over the angle, each rotated by angle / count from the last', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 1, 2)
        const r = arrayRadial(bm, {faces}, {count: 6, angle: Math.PI, axis: [0, 1, 0]})

        for (let c = 0; c < 6; c++) {
            const rot = mat4RotationAxis([0, 1, 0], (Math.PI / 6) * c)
            for (const v of verts) {
                const expected = mat4TransformPoint(rot, [v.x, v.y, v.z])
                const copy = r.copies[c].vertMap.get(v)!
                expect(copy.x).toBeCloseTo(expected[0], 12)
                expect(copy.y).toBeCloseTo(expected[1], 12)
                expect(copy.z).toBeCloseTo(expected[2], 12)
            }
        }
    })

    it('rotates about the pivot, not the origin', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 0, 1)
        const pivot: Vec3 = [5, 0, 5]
        const r = arrayRadial(bm, {faces}, {count: 4, axis: [0, 1, 0], pivot})

        for (const v of verts) {
            const before = Math.hypot(v.x - pivot[0], v.z - pivot[2])
            for (let c = 1; c < 4; c++) {
                const copy = r.copies[c].vertMap.get(v)!
                expect(Math.hypot(copy.x - pivot[0], copy.z - pivot[2])).toBeCloseTo(before, 12)
                expect(copy.y).toBeCloseTo(v.y, 12)
            }
        }
    })

    it('closes a full turn into a welded ring', () => {
        const bm = new BMesh()
        const sector = annulusSector(bm, 8)
        const r = arrayRadial(bm, {faces: [sector]}, {
            count: 8, angle: Math.PI * 2, axis: [0, 1, 0], merge: true, mergeThreshold: 1e-6,
        })

        // Eight quads meeting at eight seams: 32 corners weld down to 16 distinct vertices.
        expect(r.merged.length).toBe(16)
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(8)
        expect(bm.validate()).toEqual([])
        expect(distinctPositionCount(bm, 1e-6)).toBe(16)
        // Every seam, including the one between the last copy and the first, has two faces on it.
        expect(radialHistogram(bm)).toEqual({1: 16, 2: 8})
        expect(eulerCharacteristic(bm)).toBe(0) // an annulus
        expect(windingProblems(bm)).toEqual([])
    })

    it('leaves the sectors loose without merge', () => {
        const bm = new BMesh()
        const sector = annulusSector(bm, 8)
        const r = arrayRadial(bm, {faces: [sector]}, {count: 8, angle: Math.PI * 2, axis: [0, 1, 0]})
        expect(r.merged.length).toBe(0)
        expect(bm.totvert).toBe(32)
        expect(bm.totface).toBe(8)
        // All 32 edges are boundaries, because nothing is joined.
        expect(radialHistogram(bm)).toEqual({1: 32})
    })
})

describe('curve path evaluation', () => {
    it('measures a polyline the way BKE_anim_path_calc_data does', () => {
        const path: Vec3[] = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [6, 0, 0]]
        const cp = curvePathFromPolyline(path, false)!
        expect(cp.accum).toEqual([2, 4, 6])
        expect(cp.cyclic).toBe(false)
    })

    it('interpolates position linearly along the polyline', () => {
        const path: Vec3[] = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [6, 0, 0]]
        const cp = curvePathFromPolyline(path, false)!
        for (const [t, x] of [[0, 0], [0.25, 1.5], [0.5, 3], [0.75, 4.5], [1, 6]] as const) {
            const w = whereOnPath(cp, t)!
            expect(w.loc[0], `t ${t}`).toBeCloseTo(x, 9)
            expect(w.loc[1]).toBeCloseTo(0, 9)
            expect(w.loc[2]).toBeCloseTo(0, 9)
        }
    })

    it('wraps the parameter on a cyclic path and closes the loop', () => {
        const square: Vec3[] = [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]]
        const cp = curvePathFromPolyline(square, true)!
        expect(cp.accum).toEqual([4, 8, 12, 16])
        const start = whereOnPath(cp, 0)!
        const end = whereOnPath(cp, 1)!
        expect(end.loc[0]).toBeCloseTo(start.loc[0], 9)
        expect(end.loc[2]).toBeCloseTo(start.loc[2], 9)
        // 1.25 wraps to 0.25.
        const wrapped = whereOnPath(cp, 1.25)!
        const quarter = whereOnPath(cp, 0.25)!
        expect(wrapped.loc[0]).toBeCloseTo(quarter.loc[0], 9)
        expect(wrapped.loc[2]).toBeCloseTo(quarter.loc[2], 9)
    })

    it('returns null for a path that is not a path', () => {
        expect(curvePathFromPolyline([[0, 0, 0]], false)).toBeNull()
        expect(curvePathFromPolyline([], false)).toBeNull()
    })
})

describe('arrayCurve', () => {
    /** The copy's local +X, measured between the centres of the two faces perpendicular to X. */
    function copyAxis(r: ReturnType<typeof arrayCurve>, c: number, srcFaces: BMFace[]): {
        dir: Vec3, length: number, centre: Vec3,
    } {
        const lo = r.copies[c].faceMap.get(srcFaces[0])! // the x0 face
        const hi = r.copies[c].faceMap.get(srcFaces[1])! // the x1 face
        const a = faceCenter(lo)
        const b = faceCenter(hi)
        const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const len = Math.hypot(d[0], d[1], d[2])
        return {dir: [d[0] / len, d[1] / len, d[2] / len], length: len, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]}
    }

    /** A unit-long box centred on the Y and Z axes, with its two X faces first in the list. */
    function segmentBox(bm: BMesh) {
        const co: Vec3[] = [
            [0, -0.25, -0.25], [0, -0.25, 0.25], [0, 0.25, -0.25], [0, 0.25, 0.25],
            [1, -0.25, -0.25], [1, -0.25, 0.25], [1, 0.25, -0.25], [1, 0.25, 0.25],
        ]
        const v = co.map(c => bm.vertCreate(c[0], c[1], c[2]))
        const faces = [
            [0, 1, 3, 2], // x = 0
            [4, 6, 7, 5], // x = 1
            [2, 3, 7, 6], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5],
        ].map(f => bm.faceCreate(f.map(i => v[i])))
        return {verts: v, faces}
    }

    it('takes its count from the path length and the copy width', () => {
        const bm = new BMesh()
        const {faces} = segmentBox(bm)
        const r = arrayCurve(bm, {faces}, {path: [[0, 0, 0], [6, 0, 0]], axis: 'x'})
        // A 6-long path and a 1-wide copy: trunc(6 / 1) + 1.
        expect(r.count).toBe(7)
        expect(bm.validate()).toEqual([])
    })

    it('is the identity along a straight path aligned with the axis', () => {
        const bm = new BMesh()
        const {verts, faces} = segmentBox(bm)
        const r = arrayCurve(bm, {faces}, {path: [[0, 0, 0], [4, 0, 0]], count: 4, axis: 'x'})

        for (let c = 0; c < 4; c++) {
            for (const v of verts) {
                const copy = r.copies[c].vertMap.get(v)!
                expect(copy.x).toBeCloseTo(v.x + c, 9)
                expect(copy.y).toBeCloseTo(v.y, 9)
                expect(copy.z).toBeCloseTo(v.z, 9)
            }
        }
    })

    it('orients every copy to the local tangent of a bent path', () => {
        const bm = new BMesh()
        const {faces} = segmentBox(bm)
        // Two 5-long straight runs, so copies 0..3 sit inside the first and 5..9 inside the second.
        const path: Vec3[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5]]
        const r = arrayCurve(bm, {faces}, {path, axis: 'x'})
        expect(r.count).toBe(11) // trunc(10 / 1) + 1
        expect(bm.validate()).toEqual([])

        for (const [c, tangent] of [
            [0, [1, 0, 0]], [1, [1, 0, 0]], [2, [1, 0, 0]], [3, [1, 0, 0]],
            [5, [0, 0, 1]], [6, [0, 0, 1]], [7, [0, 0, 1]], [8, [0, 0, 1]], [9, [0, 0, 1]],
        ] as [number, Vec3][]) {
            const {dir, length} = copyAxis(r, c, faces)
            const dot = dir[0] * tangent[0] + dir[1] * tangent[1] + dir[2] * tangent[2]
            expect(dot, `copy ${c}`).toBeCloseTo(1, 6)
            // Placement is rigid: the copy keeps its length rather than being stretched.
            expect(length, `copy ${c}`).toBeCloseTo(1, 6)
        }
    })

    it('follows a closed path all the way round and meets itself', () => {
        const bm = new BMesh()
        const {verts, faces} = segmentBox(bm)
        // A square of side 3: perimeter 12, so 12 unit copies close it exactly.
        const path: Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]]
        const r = arrayCurve(bm, {faces}, {path, closed: true, count: 12, axis: 'x'})

        expect(r.count).toBe(12)
        expect(bm.validate()).toEqual([])

        // Every copy stays a unit long and turns with the path.
        for (let c = 0; c < 12; c++) {
            expect(copyAxis(r, c, faces).length, `copy ${c}`).toBeCloseTo(1, 6)
        }

        // The last copy's far face lands exactly on the first copy's near face.
        const startVerts = verts.filter(v => near(v.x, 0))
        for (const v of startVerts) {
            const first = r.copies[0].vertMap.get(v)!
            const sameCorner = verts.find(o => near(o.x, 1) && near(o.y, v.y) && near(o.z, v.z))!
            const last = r.copies[11].vertMap.get(sameCorner)!
            expect(last.x).toBeCloseTo(first.x, 6)
            expect(last.y).toBeCloseTo(first.y, 6)
            expect(last.z).toBeCloseTo(first.z, 6)
        }
    })

    it('works on the other two axes', () => {
        for (const axis of ['y', 'z'] as const) {
            const bm = new BMesh()
            const co: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 1], [0, 1, 1]]
            // A unit square lying in the plane that the chosen axis runs through.
            const i = axis === 'y' ? 1 : 2
            const verts = co.map(c => {
                const p: Vec3 = [c[0] * 0.5, 0, 0]
                p[i] = c[1]
                return bm.vertCreate(p[0], p[1], p[2])
            })
            const f = bm.faceCreate(verts)
            const path: Vec3[] = [[0, 0, 0], [4, 0, 0]]
            const r = arrayCurve(bm, {faces: [f]}, {path, axis})
            expect(r.count, axis).toBe(5)
            expect(bm.validate(), axis).toEqual([])
            // The chain runs along the path, so it spans roughly the path's length in X.
            const xs = r.verts.map(v => v.x)
            expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3.5)
        }
    })

    it('uses the mesh bounds as the origin when deform bounds are on', () => {
        // With bounds off (Blender's default) a copy at x < 0 hangs off the start of the path; with
        // bounds on, the geometry's own minimum becomes the start.
        const withBounds = new BMesh()
        const b = segmentBox(withBounds)
        for (const v of b.verts) v.setCo(v.x - 3, v.y, v.z)
        const r = arrayCurve(withBounds, {faces: b.faces}, {
            path: [[0, 0, 0], [4, 0, 0]], count: 4, axis: 'x', useDeformBounds: true,
        })
        const xs = r.verts.map(v => v.x)
        expect(Math.min(...xs)).toBeCloseTo(0, 6)
        expect(Math.max(...xs)).toBeCloseTo(4, 6)
    })
})
