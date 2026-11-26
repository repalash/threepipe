import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace} from '../bmesh/types'
import {edgeIsManifold, radialLoops} from '../bmesh/structure'
import {Vec3} from '../math'
import {lathe, primitiveLathe, primitiveTorus} from './lathe'
import {
    boundaryEdgeCount,
    degenerateFaceProblems,
    signedVolume6,
    distinctPositionCount,
    eulerCharacteristic,
    faceCenter,
    heightAlongAxis,
    inwardFacingProblems,
    radiusFromAxis,
    sameFaceCycle,
    windingProblems,
} from './topology.testutil'

const Y: Vec3 = [0, 1, 0]
const Z: Vec3 = [0, 0, 1]
const ORIGIN: Vec3 = [0, 0, 0]

function faceSizeHistogram(bm: BMesh): Record<number, number> {
    const out: Record<number, number> = {}
    for (const f of bm.faces) out[f.len] = (out[f.len] ?? 0) + 1
    return out
}

/** Checks that hold for every lathe, whatever the profile. */
function assertSound(bm: BMesh) {
    expect(bm.validate()).toEqual([])
    expect(windingProblems(bm)).toEqual([])
    expect(degenerateFaceProblems(bm)).toEqual([])
    // Nothing should be left with three or more faces on one edge.
    for (const e of bm.edges) expect([...radialLoops(e)].length).toBeLessThanOrEqual(2)
}

/**
 * A profile that never doubles back towards the axis makes a surface whose every face points away
 * from it. Only meaningful for such a profile: the inner half of a torus faces the axis on purpose,
 * and that case is checked with {@link signedVolume6} instead.
 */
function assertFacesOutward(bm: BMesh, center: Vec3 = ORIGIN, axis: Vec3 = Y, caps: BMFace[] = []) {
    expect(inwardFacingProblems(bm, center, axis, new Set(caps))).toEqual([])
}

describe('lathe - open profile, full turn', () => {
    it('makes an open tube with two boundary loops and nothing but quads', () => {
        for (const segments of [3, 8, 32]) {
            const bm = new BMesh()
            const res = lathe(bm, {profile: [[1, -0.5], [1, 0.5]], segments})

            expect(bm.totvert).toBe(2 * segments)
            expect(bm.totedge).toBe(3 * segments)
            expect(bm.totface).toBe(segments)
            // Tube: no caps, two boundaries.
            expect(eulerCharacteristic(bm)).toBe(0)
            expect(boundaryEdgeCount(bm)).toBe(2 * segments)
            expect(faceSizeHistogram(bm)).toEqual({4: segments})
            // The seam was welded, so no two vertices share a position.
            expect(distinctPositionCount(bm)).toBe(bm.totvert)
            expect(res.columns.length).toBe(2)
            expect(res.columns[0].length).toBe(segments)
            assertSound(bm)
            assertFacesOutward(bm)
        }
    })

    it('matches the topology of Blender create_cone when the ends are capped', () => {
        // `bmo_create_cone_exec` with cap_ends and no cap_tris: 2n verts, 3n edges, n quads plus one
        // n-gon per cap, which is exactly a two-point profile revolved and capped.
        for (const segments of [3, 6, 32]) {
            const bm = new BMesh()
            const res = lathe(bm, {profile: [[0.75, -1], [0.75, 1]], segments, capEnds: true})

            expect(bm.totvert).toBe(2 * segments)
            expect(bm.totedge).toBe(3 * segments)
            expect(bm.totface).toBe(segments + 2)
            expect(eulerCharacteristic(bm)).toBe(2)
            expect(boundaryEdgeCount(bm)).toBe(0)
            for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
            expect(faceSizeHistogram(bm)).toEqual({4: segments, [segments]: 2})
            expect(res.caps.length).toBe(2)
            assertSound(bm)
            assertFacesOutward(bm, ORIGIN, Y, res.caps)
            expect(signedVolume6(bm)).toBeGreaterThan(0)

            // The caps face out along the axis, in opposite directions.
            const heights = res.caps.map(f => heightAlongAxis(
                {x: faceCenter(f)[0], y: faceCenter(f)[1], z: faceCenter(f)[2]}, ORIGIN, Y))
            expect(Math.sign(heights[0])).toBe(-Math.sign(heights[1]))
        }
    })

    it('gets the radii right all the way round', () => {
        const bm = new BMesh()
        const segments = 16
        lathe(bm, {profile: [[2, 0], [3, 1], [1.25, 2]], segments})
        const radii = [2, 3, 1.25]
        const heights = [0, 1, 2]
        for (const v of bm.verts) {
            const r = radiusFromAxis(v, ORIGIN, Y)
            const h = heightAlongAxis(v, ORIGIN, Y)
            const i = heights.indexOf(Math.round(h * 1e6) / 1e6)
            expect(i).toBeGreaterThanOrEqual(0)
            expect(r).toBeCloseTo(radii[i], 9)
        }
        assertSound(bm)
    })
})

describe('lathe - profile touching the axis', () => {
    it('turns the pole into a triangle fan instead of zero-area quads', () => {
        for (const segments of [3, 7, 24]) {
            const bm = new BMesh()
            // A cone: apex on the axis, open base.
            const res = lathe(bm, {profile: [[1, 0], [0, 1]], segments})

            // The pole ring welds down to one vertex.
            expect(bm.totvert).toBe(segments + 1)
            expect(bm.totedge).toBe(2 * segments)
            expect(bm.totface).toBe(segments)
            expect(eulerCharacteristic(bm)).toBe(1)
            expect(faceSizeHistogram(bm)).toEqual({3: segments})
            expect(distinctPositionCount(bm)).toBe(bm.totvert)
            expect(res.columns[0].length).toBe(segments)
            expect(res.columns[1].length).toBe(1)
            // The open base is the only boundary.
            expect(boundaryEdgeCount(bm)).toBe(segments)
            assertSound(bm)
            assertFacesOutward(bm)
        }
    })

    it('closes a cone with a cap, matching create_cone with radius2 = 0', () => {
        const segments = 12
        const bm = new BMesh()
        const res = lathe(bm, {profile: [[1, 0], [0, 1]], segments, capEnds: true})

        expect(bm.totvert).toBe(segments + 1)
        expect(bm.totedge).toBe(2 * segments)
        expect(bm.totface).toBe(segments + 1)
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(faceSizeHistogram(bm)).toEqual({3: segments, [segments]: 1})
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        assertSound(bm)
        assertFacesOutward(bm, ORIGIN, Y, res.caps)
        expect(signedVolume6(bm)).toBeGreaterThan(0)
    })

    it('makes a closed surface from a profile that touches the axis at both ends', () => {
        const segments = 8
        const bm = new BMesh()
        // A crude sphere: pole, equator, pole.
        lathe(bm, {profile: [[0, -1], [1, 0], [0, 1]], segments})

        expect(bm.totvert).toBe(segments + 2)
        expect(bm.totedge).toBe(3 * segments)
        expect(bm.totface).toBe(2 * segments)
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(boundaryEdgeCount(bm)).toBe(0)
        expect(faceSizeHistogram(bm)).toEqual({3: 2 * segments})
        assertSound(bm)
        assertFacesOutward(bm)
        expect(signedVolume6(bm)).toBeGreaterThan(0)
    })

    it('keeps quads in the middle and triangles only at the pole', () => {
        const segments = 10
        const bm = new BMesh()
        // Pole, then three rings off the axis.
        lathe(bm, {profile: [[1, -1.5], [1.5, 0], [1, 1.5], [0, 2]], segments})

        expect(faceSizeHistogram(bm)).toEqual({3: segments, 4: 2 * segments})
        expect(bm.totvert).toBe(3 * segments + 1)
        expect(bm.totedge).toBe(2 * (3 * segments))
        expect(eulerCharacteristic(bm)).toBe(1)
        assertSound(bm)
        assertFacesOutward(bm)
    })

    it('snaps a profile point that is nearly on the axis, within mergeDistance', () => {
        const bm = new BMesh()
        lathe(bm, {profile: [[1, 0], [1e-9, 1]], segments: 6, mergeDistance: 1e-6})
        expect(bm.totvert).toBe(7)
        const apex = [...bm.verts].find(v => radiusFromAxis(v, ORIGIN, Y) < 1e-12)
        expect(apex).toBeDefined()
        assertSound(bm)
    })

    it('refuses a profile that is entirely on the axis, or has two on-axis points in a row', () => {
        expect(() => lathe(new BMesh(), {profile: [[0, 0], [0, 1]]}))
            .toThrow(/lies on the axis/)
        expect(() => lathe(new BMesh(), {profile: [[1, 0], [0, 1], [0, 2]]}))
            .toThrow(/both lie on the axis/)
    })
})

describe('lathe - closed profile', () => {
    it('makes a torus-like tube with no caps and the characteristic of a torus', () => {
        for (const [p, s] of [[4, 6], [8, 12], [3, 3]] as const) {
            const bm = new BMesh()
            const profile: [number, number][] = []
            for (let i = 0; i < p; i++) {
                const a = Math.PI * 2 * i / p
                profile.push([3 + Math.cos(a) * 0.75, Math.sin(a) * 0.75])
            }
            const res = lathe(bm, {profile, closed: true, segments: s})

            expect(bm.totvert).toBe(p * s)
            expect(bm.totedge).toBe(2 * p * s)
            expect(bm.totface).toBe(p * s)
            // Genus 1: closed, and V - E + F = 0.
            expect(eulerCharacteristic(bm)).toBe(0)
            expect(boundaryEdgeCount(bm)).toBe(0)
            for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
            expect(faceSizeHistogram(bm)).toEqual({4: p * s})
            expect(res.caps).toEqual([])
            expect(distinctPositionCount(bm)).toBe(bm.totvert)
            assertSound(bm)
            // The inner half of the tube faces the axis on purpose, so orientation is checked by
            // volume: a closed surface wound outwards encloses a positive volume.
            expect(signedVolume6(bm)).toBeGreaterThan(0)
        }
    })

    it('ignores capEnds for a closed profile, because there is nothing open to cap', () => {
        const bm = new BMesh()
        const profile: [number, number][] = [[2, 0], [2.5, 0.5], [2, 1], [1.5, 0.5]]
        const res = lathe(bm, {profile, closed: true, segments: 6, capEnds: true})
        expect(res.caps).toEqual([])
        expect(bm.totface).toBe(4 * 6)
        assertSound(bm)
    })
})

describe('lathe - partial sweep', () => {
    it('leaves the ends open with boundary edges, and does not cap them', () => {
        const segments = 8
        const bm = new BMesh()
        const res = lathe(bm, {profile: [[1, -0.5], [1, 0.5]], segments, angle: Math.PI, capEnds: true})

        // No merge on a partial sweep, so there is one more ring than there are steps.
        expect(bm.totvert).toBe(2 * (segments + 1))
        expect(bm.totedge).toBe(1 * (segments + 1) + 2 * segments)
        expect(bm.totface).toBe(segments)
        // An open sheet.
        expect(eulerCharacteristic(bm)).toBe(1)
        // The whole border: two long sides plus the two profile edges at the ends.
        expect(boundaryEdgeCount(bm)).toBe(2 * segments + 2)
        expect(res.caps).toEqual([])
        expect(faceSizeHistogram(bm)).toEqual({4: segments})
        assertSound(bm)
    })

    it('sweeps exactly the angle asked for', () => {
        const bm = new BMesh()
        const angle = Math.PI / 3
        const res = lathe(bm, {profile: [[2, 0], [2, 1]], segments: 6, angle, axis: Z})
        const ring = res.columns[0]
        expect(ring.length).toBe(7)
        for (let i = 0; i < ring.length; i++) {
            const a = angle * i / 6
            expect(ring[i].x).toBeCloseTo(2 * Math.cos(a), 9)
            expect(ring[i].y).toBeCloseTo(2 * Math.sin(a), 9)
        }
    })
})

describe('lathe - axes and centres', () => {
    it('works about any axis, with the radii measured from that axis', () => {
        const axes: Vec3[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [1, 1, 1], [-2, 0.5, 3]]
        for (const axis of axes) {
            const bm = new BMesh()
            const center: Vec3 = [0.25, -1, 2]
            lathe(bm, {profile: [[1.5, -1], [1.5, 1]], axis, center, segments: 9, capEnds: true})

            const len = Math.hypot(axis[0], axis[1], axis[2])
            const unit: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len]
            for (const v of bm.verts) expect(radiusFromAxis(v, center, unit)).toBeCloseTo(1.5, 9)
            expect(bm.totface).toBe(9 + 2)
            expect(eulerCharacteristic(bm)).toBe(2)
            const caps = [...bm.faces].filter(f => f.len === 9)
            assertSound(bm)
            assertFacesOutward(bm, center, unit, caps)
        }
    })

    it('takes 3D profile points as absolute positions', () => {
        const bm = new BMesh()
        lathe(bm, {
            profile: [[1, -0.5, 0] as Vec3, [1, 0.5, 0] as Vec3],
            axis: Y,
            segments: 8,
        })
        expect(bm.totvert).toBe(16)
        for (const v of bm.verts) expect(radiusFromAxis(v, ORIGIN, Y)).toBeCloseTo(1, 9)
        assertSound(bm)
    })

    it('rejects a profile that is too short, and too few segments', () => {
        expect(() => lathe(new BMesh(), {profile: [[1, 0]]})).toThrow(/at least 2 points/)
        expect(() => lathe(new BMesh(), {profile: [[1, 0], [1, 1]], segments: 2}))
            .toThrow(/at least 3 segments/)
    })
})

describe('primitiveLathe', () => {
    it('produces a valid MeshData', () => {
        const mesh = primitiveLathe({profile: [[1, -1], [1, 1]], segments: 12, capEnds: true})
        expect(mesh.validate()).toEqual([])
        expect(mesh.vertsNum).toBe(24)
        expect(mesh.edgesNum).toBe(36)
        expect(mesh.facesNum).toBe(14)
        expect(mesh.cornersNum).toBe(12 * 4 + 2 * 12)
    })

    it('lays vertices out ring by ring, each ring in profile order', () => {
        const segments = 5
        const mesh = primitiveLathe({profile: [[1, 0], [2, 1], [1, 2]], segments})
        expect(mesh.vertsNum).toBe(3 * segments)
        const positions = mesh.positions
        const radii = [1, 2, 1]
        for (let ring = 0; ring < segments; ring++) {
            for (let p = 0; p < 3; p++) {
                const i = ring * 3 + p
                const r = Math.hypot(positions[i * 3], positions[i * 3 + 2])
                expect(r).toBeCloseTo(radii[p], 5)
                expect(positions[i * 3 + 1]).toBeCloseTo(p, 5)
            }
        }
    })
})

/**
 * A direct transcription of `add_torus` from
 * `scripts/startup/bl_operators/add_mesh_torus.py`, used as the reference the port is checked against.
 * Nothing here is baked: it computes the same values Blender would, from the same parameters.
 */
function blenderAddTorus(majorRad: number, minorRad: number, majorSeg: number, minorSeg: number) {
    const pi2 = Math.PI * 2
    const verts: number[] = []
    const faces: number[][] = []
    let i1 = 0
    const totVerts = majorSeg * minorSeg
    for (let majorIndex = 0; majorIndex < majorSeg; majorIndex++) {
        // `Matrix.Rotation((major_index / major_seg) * pi_2, 3, 'Z')`
        const theta = (majorIndex / majorSeg) * pi2
        const cos = Math.cos(theta)
        const sin = Math.sin(theta)

        for (let minorIndex = 0; minorIndex < minorSeg; minorIndex++) {
            const angle = pi2 * minorIndex / minorSeg
            const x = majorRad + Math.cos(angle) * minorRad
            const z = Math.sin(angle) * minorRad
            verts.push(cos * x, sin * x, z)

            let i2: number, i3: number, i4: number
            if (minorIndex + 1 === minorSeg) {
                i2 = majorIndex * minorSeg
                i3 = i1 + minorSeg
                i4 = i2 + minorSeg
            } else {
                i2 = i1 + 1
                i3 = i1 + minorSeg
                i4 = i3 + 1
            }
            if (i2 >= totVerts) i2 -= totVerts
            if (i3 >= totVerts) i3 -= totVerts
            if (i4 >= totVerts) i4 -= totVerts

            faces.push([i1, i3, i4, i2])
            i1 += 1
        }
    }
    return {verts, faces}
}

describe('primitiveTorus', () => {
    it('reproduces add_torus vertex for vertex and face for face', () => {
        for (const [majorSeg, minorSeg] of [[8, 4], [12, 6], [48, 12], [3, 3]] as const) {
            const majorRadius = 1.4
            const minorRadius = 0.35
            const reference = blenderAddTorus(majorRadius, minorRadius, majorSeg, minorSeg)
            const mesh = primitiveTorus({majorRadius, minorRadius, majorSegments: majorSeg, minorSegments: minorSeg})

            expect(mesh.vertsNum).toBe(majorSeg * minorSeg)
            expect(mesh.facesNum).toBe(majorSeg * minorSeg)

            const positions = mesh.positions
            for (let i = 0; i < mesh.vertsNum * 3; i++) {
                expect(positions[i]).toBeCloseTo(reference.verts[i], 5)
            }

            // Faces come out in the same order, and each one is the same cycle in the same direction.
            // The start corner differs by a rotation of one, because the spin builds each quad from
            // the edge it is sweeping rather than from the corner Blender happens to start at.
            for (let f = 0; f < mesh.facesNum; f++) {
                const ours = mesh.faceVerts(f)
                expect(sameFaceCycle(ours, reference.faces[f])).toBe(true)
            }
        }
    })

    it('is a closed genus-1 surface of quads', () => {
        const mesh = primitiveTorus({majorSegments: 16, minorSegments: 8})
        expect(mesh.validate()).toEqual([])
        expect(mesh.vertsNum).toBe(128)
        expect(mesh.facesNum).toBe(128)
        expect(mesh.edgesNum).toBe(256)
        expect(mesh.vertsNum - mesh.edgesNum + mesh.facesNum).toBe(0)
        for (let f = 0; f < mesh.facesNum; f++) expect(mesh.faceSize(f)).toBe(4)
    })

    it('uses the same defaults as the Blender add-on', () => {
        const mesh = primitiveTorus()
        // major_segments 48, minor_segments 12, major_radius 1.0, minor_radius 0.25.
        expect(mesh.vertsNum).toBe(48 * 12)
        expect(mesh.facesNum).toBe(48 * 12)
        const positions = mesh.positions
        expect(positions[0]).toBeCloseTo(1.25, 6)
        expect(positions[1]).toBeCloseTo(0, 6)
        expect(positions[2]).toBeCloseTo(0, 6)
    })

    it('can be built about another axis', () => {
        const bm = new BMesh()
        const profile: [number, number][] = []
        for (let i = 0; i < 6; i++) {
            const a = Math.PI * 2 * i / 6
            profile.push([1 + Math.cos(a) * 0.25, Math.sin(a) * 0.25])
        }
        lathe(bm, {profile, closed: true, segments: 10, axis: Y})
        expect(eulerCharacteristic(bm)).toBe(0)
        assertSound(bm)
    })
})
