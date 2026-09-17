import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {radialLoops} from '../bmesh/structure'
import {AttrName, ElemFlag} from '../constants'
import {v3cross, v3dot, v3len, v3normalize, v3sub, Vec3} from '../math'
import {degenerateFaceProblems, eulerCharacteristic, windingProblems} from './topology.testutil'
import {
    angleNormalized,
    angleSignedOnAxis,
    calculateFrames,
    calculateNormalsMinimum,
    calculateNormalsZUp,
    calculateTangents,
    circleProfile,
    curveToMeshSweep,
    NormalMode,
    primitiveSweep,
    rotateDirectionAroundAxis,
    sweep,
    SweepOptions,
} from './sweep'

// region helpers

/** A path of `n` points along a straight line, which has an unambiguous frame everywhere. */
function line(n: number, step = 1): Vec3[] {
    return Array.from({length: n}, (_, i): Vec3 => [0, 0, i * step])
}

/** A helix: curvature and torsion both non-zero, which is where Z-up frames corkscrew. */
function helix(n: number, turns = 2, radius = 1, pitch = 0.25): Vec3[] {
    return Array.from({length: n}, (_, i): Vec3 => {
        const t = turns * 2 * Math.PI * i / (n - 1)
        return [radius * Math.cos(t), radius * Math.sin(t), pitch * t]
    })
}

/** An S bend in 3D: two opposite turns, in different planes. */
function sBend(n: number): Vec3[] {
    return Array.from({length: n}, (_, i): Vec3 => {
        const t = 4 * i / (n - 1)
        return [t, Math.sin(t * Math.PI / 2) * 0.8, Math.sin(t * Math.PI) * 0.5]
    })
}

/**
 * A closed, non-planar, asymmetric loop - the shape of a bent grab rail that meets itself.
 *
 * The asymmetry is deliberate. A symmetric wavy ring (`z = h * sin(2t)` on a circle) has a frame
 * holonomy of zero to the last bit, so it cannot tell a correct cyclic correction from a missing
 * one; this one accumulates about 0.73 radians over the loop, which is what makes the tests below
 * discriminating.
 */
function closedRail(n: number, radius = 2): Vec3[] {
    return Array.from({length: n}, (_, i): Vec3 => {
        const t = 2 * Math.PI * i / n
        return [
            radius * Math.cos(t),
            radius * Math.sin(t) + 0.4 * Math.cos(3 * t),
            0.9 * Math.sin(2 * t) + 0.3 * Math.cos(t),
        ]
    })
}

/**
 * Positions come back out of `MeshData` as float32, so anything measured on generated geometry
 * carries about 1e-7 of relative quantisation. Frame maths, which never leaves JS numbers, is held
 * to far tighter tolerances above.
 */
const F32_PLACES = 6

/** Signed angle from `a` to `b` about `axis`, folded into `(-PI, PI]`. */
function signedAngle(a: Vec3, b: Vec3, axis: Vec3): number {
    const angle = angleSignedOnAxis(a, b, axis)
    return angle > Math.PI ? angle - 2 * Math.PI : angle
}

/**
 * The twist the frame picks up between two consecutive points: how far the normal ends up from
 * where pure rotation-minimising transport would have put it. Zero everywhere is the whole point of
 * the minimum-twist mode.
 */
function frameTwists(positions: Vec3[], cyclic: boolean, normalMode: NormalMode): number[] {
    const {tangents, normals} = calculateFrames(positions, cyclic, normalMode)
    const out: number[] = []
    const n = positions.length
    const steps = cyclic ? n : n - 1
    for (let i = 0; i < steps; i++) {
        const j = (i + 1) % n
        const transported = transport(normals[i], tangents[i], tangents[j])
        out.push(signedAngle(transported, normals[j], tangents[j]))
    }
    return out
}

/**
 * Carry a normal from one tangent to the next by the shortest rotation. Written independently of
 * the port's own `calculateNextNormal` (which is not exported) so the twist measurements below are
 * not just the implementation checking itself.
 */
function transport(normal: Vec3, from: Vec3, to: Vec3): Vec3 {
    const axis = v3cross(from, to)
    const len = v3len(axis)
    if (len < 1e-12) return normal
    const angle = Math.atan2(len, v3dot(from, to))
    return v3normalize(rotateDirectionAroundAxis(normal, v3normalize(axis), angle))
}

/**
 * Adjacent faces must traverse their shared edge in opposite directions, or the two are wound
 * against each other and the surface is inside out along that seam.
 *
 * `windingProblems` is the shared generator assertion; the count check in front of it is here
 * because an empty problem list also means "no manifold edge was looked at", which would make the
 * assertion vacuous rather than passing.
 */
function expectConsistentWinding(bm: BMesh) {
    const manifold = [...bm.edges].filter(e => [...radialLoops(e)].length === 2)
    expect(manifold.length).toBeGreaterThan(0)
    expect(windingProblems(bm)).toEqual([])
    // `loop.v` is where each face starts its traversal of the shared edge, so the two starts
    // together must be the edge's two ends.
    for (const e of manifold) {
        const [a, b] = [...radialLoops(e)]
        expect(new Set([a.v, b.v])).toEqual(new Set([e.v1, e.v2]))
    }
}

/** Vertex position of the BMesh vertex, as a Vec3. */
const co = (v: {x: number, y: number, z: number}): Vec3 => [v.x, v.y, v.z]

function sweptBMesh(opts: SweepOptions) {
    const bm = new BMesh()
    const res = sweep(bm, opts)
    return {bm, ...res}
}

// endregion

describe('calculateTangents', () => {
    it('uses the segment direction at the ends of an open path and the bisector inside', () => {
        const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]]
        const t = calculateTangents(positions, false)
        expect(t[0][0]).toBeCloseTo(1, 12)
        expect(t[0][1]).toBeCloseTo(0, 12)
        // The middle point bisects +X and +Y.
        expect(t[1][0]).toBeCloseTo(Math.SQRT1_2, 12)
        expect(t[1][1]).toBeCloseTo(Math.SQRT1_2, 12)
        expect(t[2][1]).toBeCloseTo(1, 12)
        expect(t[2][0]).toBeCloseTo(0, 12)
    })

    it('bisects at both ends of a cyclic path, using the closing segment', () => {
        // A square. Every tangent bisects two perpendicular segments, including at index 0.
        const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
        const t = calculateTangents(positions, true)
        expect(t[0][0]).toBeCloseTo(Math.SQRT1_2, 12)
        expect(t[0][1]).toBeCloseTo(-Math.SQRT1_2, 12)
        expect(t[3][0]).toBeCloseTo(-Math.SQRT1_2, 12)
        expect(t[3][1]).toBeCloseTo(-Math.SQRT1_2, 12)
        for (const v of t) expect(v3len(v)).toBeCloseTo(1, 12)
    })

    it('keeps coincident points instead of dropping them, reusing the neighbouring direction', () => {
        // `delta_dir` rejects the first segment, so the search finds index 1 and copies backwards.
        const positions: Vec3[] = [[0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]
        const t = calculateTangents(positions, false)
        expect(t.length).toBe(4)
        for (const v of t) {
            expect(v[0]).toBeCloseTo(1, 12)
            expect(v[1]).toBeCloseTo(0, 12)
            expect(v[2]).toBeCloseTo(0, 12)
        }
    })

    it('reuses the last non-zero direction across a zero-length segment in the middle', () => {
        const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0]]
        const t = calculateTangents(positions, false)
        // Point 1 sees a zero next-segment, so it keeps the previous direction.
        expect(t[1][0]).toBeCloseTo(1, 12)
        expect(t[1][1]).toBeCloseTo(0, 12)
        // Point 2 cannot bisect against a non-adjacent segment, so it takes the next one raw.
        expect(t[2][0]).toBeCloseTo(0, 12)
        expect(t[2][1]).toBeCloseTo(1, 12)
    })

    it('falls back to +Z when every point is the same, and for a single point', () => {
        const t = calculateTangents([[1, 2, 3], [1, 2, 3], [1, 2, 3]], false)
        for (const v of t) expect(v).toEqual([0, 0, 1])
        expect(calculateTangents([[0, 0, 0]], false)).toEqual([[0, 0, 1]])
        expect(calculateTangents([], false)).toEqual([])
    })

    it('handles a 180 degree reversal through the cross-product branch rather than cancelling', () => {
        // prev + next is (almost) zero here, which is the case #146332 is about.
        const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1e-6, 0]]
        const t = calculateTangents(positions, false)
        expect(v3len(t[1])).toBeCloseTo(1, 6)
        expect(Number.isNaN(t[1][0])).toBe(false)
        // Perpendicular to both segment directions' difference: it points across the fold.
        expect(Math.abs(t[1][0])).toBeLessThan(1e-3)
    })
})

describe('calculateNormalsZUp', () => {
    it('turns the tangent a quarter turn about Z, with +X for vertical tangents', () => {
        const n = calculateNormalsZUp([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]])
        const expectVec = (got: Vec3, want: Vec3) => {
            for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 12)
        }
        expectVec(n[0], [0, -1, 0])
        expectVec(n[1], [1, 0, 0])
        // No horizontal component to turn: the documented +X fallback, same epsilon as `vec_to_quat`.
        expect(n[2]).toEqual([1, 0, 0])
        expect(n[3]).toEqual([1, 0, 0])
    })
})

describe('calculateNormalsMinimum', () => {
    it('keeps a constant normal through a planar bend, where Z-up flips', () => {
        // A right-angle bend from +X to +Z, entirely in the XZ plane. Every transport axis is -Y,
        // and the normal starts parallel to it, so rotation-minimising transport cannot move it.
        const tangents = calculateTangents([[0, 0, 0], [1, 0, 0], [1, 0, 1]], false)
        const min = calculateNormalsMinimum(tangents, false)
        for (const n of min) {
            expect(n[0]).toBeCloseTo(0, 9)
            expect(n[1]).toBeCloseTo(-1, 9)
            expect(n[2]).toBeCloseTo(0, 9)
        }
        // Z-up cannot: the final tangent is vertical, so it snaps to +X instead.
        const zUp = calculateNormalsZUp(tangents)
        expect(zUp[0]).toEqual([0, -1, 0])
        expect(zUp[2]).toEqual([1, 0, 0])
    })

    it('keeps every normal perpendicular to its tangent and unit length along a helix', () => {
        const positions = helix(60)
        const {tangents, normals} = calculateFrames(positions, false, 'minimumTwist')
        for (let i = 0; i < positions.length; i++) {
            expect(v3len(normals[i])).toBeCloseTo(1, 9)
            expect(v3dot(normals[i], tangents[i])).toBeCloseTo(0, 8)
        }
    })

    it('adds no twist on a helix, where Z-up adds a lot', () => {
        const positions = helix(80, 2)
        const min = frameTwists(positions, false, 'minimumTwist')
        const zUp = frameTwists(positions, false, 'zUp')

        const maxAbs = (a: number[]) => Math.max(...a.map(Math.abs))
        const total = (a: number[]) => Math.abs(a.reduce((s, x) => s + x, 0))

        // Rotation-minimising: the per-step twist is zero to floating point.
        expect(maxAbs(min)).toBeLessThan(1e-9)
        expect(total(min)).toBeLessThan(1e-9)

        // Z-up: visibly different, and the twist accumulates rather than cancelling.
        expect(maxAbs(zUp)).toBeGreaterThan(0.03)
        expect(total(zUp)).toBeGreaterThan(1)
    })

    it('adds no twist on an S bend either, where Z-up does', () => {
        const positions = sBend(60)
        const min = frameTwists(positions, false, 'minimumTwist')
        const zUp = frameTwists(positions, false, 'zUp')
        expect(Math.max(...min.map(Math.abs))).toBeLessThan(1e-9)
        expect(Math.max(...zUp.map(Math.abs))).toBeGreaterThan(0.01)
    })

    it('spreads the cyclic holonomy evenly instead of leaving it in the seam', () => {
        const positions = closedRail(48)
        const tangents = calculateTangents(positions, true)

        // Forward-only transport: the frame does not come back to where it started. That residue
        // is the holonomy of the path, and it is what the cyclic correction exists for.
        const uncorrected = calculateNormalsMinimum(tangents, false)
        const last = positions.length - 1
        const closed = transport(uncorrected[last], tangents[last], tangents[0])
        const gap = Math.abs(signedAngle(closed, uncorrected[0], tangents[0]))
        expect(gap).toBeGreaterThan(0.05)

        // With the correction, the twist per step is the same everywhere, wrap-around included,
        // and it accounts for exactly the whole gap.
        const twists = frameTwists(positions, true, 'minimumTwist')
        expect(twists.length).toBe(positions.length)
        const step = twists[0]
        for (const t of twists) expect(t).toBeCloseTo(step, 9)
        expect(Math.abs(step)).toBeCloseTo(gap / positions.length, 9)

        // Without it, every step would be zero except the seam, which would carry all of `gap`.
        const uncorrectedTwists: number[] = []
        for (let i = 0; i < positions.length; i++) {
            const j = (i + 1) % positions.length
            uncorrectedTwists.push(Math.abs(signedAngle(
                transport(uncorrected[i], tangents[i], tangents[j]), uncorrected[j], tangents[j])))
        }
        for (let i = 0; i < last; i++) expect(uncorrectedTwists[i]).toBeLessThan(1e-9)
        expect(uncorrectedTwists[last]).toBeCloseTo(gap, 9)
    })

    it('closes a planar cyclic path exactly, because its holonomy is zero', () => {
        // A circle in XY: every transport axis is +Z, so the frame returns to its starting normal
        // and the correction is a no-op. The normals are the radial directions.
        const positions = Array.from({length: 24}, (_, i): Vec3 => {
            const t = 2 * Math.PI * i / 24
            return [Math.cos(t), Math.sin(t), 0]
        })
        const {tangents, normals} = calculateFrames(positions, true, 'minimumTwist')
        for (const t of frameTwists(positions, true, 'minimumTwist')) expect(Math.abs(t)).toBeLessThan(1e-9)
        for (let i = 0; i < positions.length; i++) {
            // Radially outward or inward; the sign follows from the Z-up seed at index 0.
            expect(Math.abs(v3dot(normals[i], v3normalize(positions[i])))).toBeCloseTo(1, 9)
            expect(v3dot(normals[i], tangents[i])).toBeCloseTo(0, 9)
        }
    })
})

describe('sweep topology', () => {
    /**
     * Blender's counts, straight from `calculate_result_offsets`: one vertex per (path point,
     * profile point); ring edges over every path point plus longitudinal edges over every path
     * segment; one quad per (path segment, profile segment); two cap n-gons.
     */
    const expected = (pathPoints: number, steps: number, closed: boolean, caps: boolean) => {
        const mainSegments = closed ? (pathPoints > 2 ? pathPoints : pathPoints - 1) : pathPoints - 1
        const capped = caps && !closed && steps > 2
        return {
            verts: pathPoints * steps,
            edges: pathPoints * steps + mainSegments * steps,
            faces: mainSegments * steps + (capped ? 2 : 0),
            corners: mainSegments * steps * 4 + (capped ? steps * 2 : 0),
        }
    }

    for (const steps of [3, 4, 8, 16]) {
        it(`open path, ${steps} steps, no caps: exact counts and chi = 0`, () => {
            const {bm} = sweptBMesh({path: line(5), radius: 0.3, steps})
            const e = expected(5, steps, false, false)
            expect({verts: bm.totvert, edges: bm.totedge, faces: bm.totface, corners: bm.totloop}).toEqual(e)
            // An uncapped tube is an annulus: Euler characteristic 0.
            expect(eulerCharacteristic(bm)).toBe(0)
            expect(bm.validate()).toEqual([])
        })

        it(`open path, ${steps} steps, capped: exact counts and chi = 2`, () => {
            const {bm} = sweptBMesh({path: line(5), radius: 0.3, steps, capEnds: true})
            const e = expected(5, steps, false, true)
            expect({verts: bm.totvert, edges: bm.totedge, faces: bm.totface, corners: bm.totloop}).toEqual(e)
            // A capped tube is a sphere topologically: chi = 2.
            expect(eulerCharacteristic(bm)).toBe(2)
            expect(bm.validate()).toEqual([])
        })

        it(`closed path, ${steps} steps: exact counts and chi = 0 (a torus)`, () => {
            const {bm} = sweptBMesh({path: closedRail(7), radius: 0.3, steps, closed: true})
            const e = expected(7, steps, true, false)
            expect({verts: bm.totvert, edges: bm.totedge, faces: bm.totface, corners: bm.totloop}).toEqual(e)
            expect(eulerCharacteristic(bm)).toBe(0)
            expect(bm.validate()).toEqual([])
        })
    }

    it('ignores capEnds on a closed path, because there is nothing to cap', () => {
        const open = sweptBMesh({path: closedRail(7), radius: 0.3, steps: 8, closed: true, capEnds: true})
        const plain = sweptBMesh({path: closedRail(7), radius: 0.3, steps: 8, closed: true})
        expect(open.bm.totface).toBe(plain.bm.totface)
        expect(open.bm.describe()).toBe(plain.bm.describe())
    })

    it('emits quads for every side face and one n-gon per cap', () => {
        const steps = 9
        const {bm, faces} = sweptBMesh({path: helix(12), radius: 0.2, steps, capEnds: true})
        const sideFaces = faces.slice(0, faces.length - 2)
        const caps = faces.slice(-2)

        expect(sideFaces.length).toBe(11 * steps)
        for (const f of sideFaces) expect(f.len).toBe(4)
        for (const f of caps) expect(f.len).toBe(steps)
        // And nothing anywhere else in the mesh is a triangle.
        expect([...bm.faces].filter(f => f.len === 3).length).toBe(0)
    })

    it('winds every face consistently with its neighbours', () => {
        for (const opts of [
            {path: helix(10), radius: 0.2, steps: 7, capEnds: true},
            {path: helix(10), radius: 0.2, steps: 7},
            {path: closedRail(9), radius: 0.2, steps: 7, closed: true},
            {path: sBend(8), radius: 0.15, steps: 5, capEnds: true},
        ] as SweepOptions[]) {
            const {bm} = sweptBMesh(opts)
            expectConsistentWinding(bm)
            expect(degenerateFaceProblems(bm)).toEqual([])
        }
    })

    it('leaves a capped tube closed: every edge has exactly two faces', () => {
        const {bm} = sweptBMesh({path: helix(10), radius: 0.2, steps: 6, capEnds: true})
        for (const e of bm.edges) expect([...radialLoops(e)].length).toBe(2)
    })

    it('leaves an uncapped tube open only at the two end rings', () => {
        const steps = 6
        const {bm} = sweptBMesh({path: line(4), radius: 0.2, steps})
        const boundary = [...bm.edges].filter(e => [...radialLoops(e)].length === 1)
        expect(boundary.length).toBe(steps * 2)
    })

    it('produces a clean MeshData through primitiveSweep, with matching counts', () => {
        for (const opts of [
            {path: helix(9), radius: 0.3, steps: 8, capEnds: true},
            {path: helix(9), radius: 0.3, steps: 8},
            {path: closedRail(11), radius: 0.3, steps: 5, closed: true},
        ] as SweepOptions[]) {
            const mesh = primitiveSweep(opts)
            expect(mesh.validate()).toEqual([])
            const {bm} = sweptBMesh(opts)
            expect(mesh.vertsNum).toBe(bm.totvert)
            expect(mesh.edgesNum).toBe(bm.totedge)
            expect(mesh.facesNum).toBe(bm.totface)
            expect(mesh.cornersNum).toBe(bm.totloop)
        }
    })

    it('marks the caps flat and the cap rings sharp, the way Blender does', () => {
        const steps = 8
        const mesh = primitiveSweep({path: line(4), radius: 0.3, steps, capEnds: true})
        const sharpFace = mesh.attributes.get(AttrName.sharpFace)!
        const sharpEdge = mesh.attributes.get(AttrName.sharpEdge)!
        expect([...sharpFace.data].filter(Boolean).length).toBe(2)
        // The two cap faces are the last two.
        expect(sharpFace.data[mesh.facesNum - 1]).toBe(1)
        expect(sharpFace.data[mesh.facesNum - 2]).toBe(1)
        // One ring of sharp edges at each end.
        expect([...sharpEdge.data].filter(Boolean).length).toBe(steps * 2)

        // And the flag survives into the BMesh as the absence of SMOOTH.
        const {faces, edges} = sweptBMesh({path: line(4), radius: 0.3, steps, capEnds: true})
        expect(faces.filter(f => !(f.hflag & ElemFlag.Smooth)).length).toBe(2)
        expect(edges.filter(e => !(e.hflag & ElemFlag.Smooth)).length).toBe(steps * 2)
    })

    it('adds to an existing BMesh without disturbing it', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(1, 1, 0)
        bm.faceCreate([a, b, c])
        const before = {v: bm.totvert, e: bm.totedge, f: bm.totface}

        const res = sweep(bm, {path: line(3), radius: 0.2, steps: 5})
        expect(bm.totvert).toBe(before.v + res.verts.length)
        expect(bm.totedge).toBe(before.e + res.edges.length)
        expect(bm.totface).toBe(before.f + res.faces.length)
        expect(bm.validate()).toEqual([])
    })
})

describe('sweep geometry', () => {
    it('puts every ring vertex exactly `radius` from its path point', () => {
        const radius = 0.37
        const steps = 11
        const path = helix(15)
        const {verts} = sweptBMesh({path, radius, steps})
        for (let i = 0; i < path.length; i++) {
            for (let j = 0; j < steps; j++) {
                const d = v3len(v3sub(co(verts[i * steps + j]), path[i]))
                expect(d).toBeCloseTo(radius, F32_PLACES)
            }
        }
    })

    it('puts every ring in the plane perpendicular to its own tangent', () => {
        const steps = 9
        const path = sBend(14)
        const tangents = calculateTangents(path, false)
        const {verts} = sweptBMesh({path, radius: 0.25, steps})
        for (let i = 0; i < path.length; i++) {
            for (let j = 0; j < steps; j++) {
                const offset = v3sub(co(verts[i * steps + j]), path[i])
                expect(v3dot(offset, tangents[i])).toBeCloseTo(0, F32_PLACES)
            }
        }
    })

    it('lays the ring out along the frame normal and binormal, in profile order', () => {
        const radius = 0.5
        const steps = 6
        const path = helix(9)
        const {tangents, normals} = calculateFrames(path, false, 'minimumTwist')
        const {verts} = sweptBMesh({path, radius, steps})
        for (let i = 0; i < path.length; i++) {
            const binormal = v3normalize(v3cross(tangents[i], normals[i]))
            for (let j = 0; j < steps; j++) {
                const theta = 2 * Math.PI * j / steps
                const offset = v3sub(co(verts[i * steps + j]), path[i])
                expect(v3dot(offset, normals[i])).toBeCloseTo(radius * Math.cos(theta), F32_PLACES)
                expect(v3dot(offset, binormal)).toBeCloseTo(radius * Math.sin(theta), F32_PLACES)
            }
        }
    })

    it('does not corkscrew: a minimum-twist tube keeps its seam aligned, a Z-up one does not', () => {
        const radius = 0.3
        const steps = 12
        const path = helix(60, 2)
        const seamDrift = (normalMode: NormalMode) => {
            const {tangents} = calculateFrames(path, false, normalMode)
            const {verts} = sweptBMesh({path, radius, steps, normalMode})
            // Direction from each path point to its first ring vertex, transported forward and
            // compared with the next ring's. This is the visible corkscrew, measured on geometry.
            let worst = 0
            for (let i = 0; i < path.length - 1; i++) {
                const a = v3normalize(v3sub(co(verts[i * steps]), path[i]))
                const b = v3normalize(v3sub(co(verts[(i + 1) * steps]), path[i + 1]))
                worst = Math.max(worst, Math.abs(angleNormalized(transport(a, tangents[i], tangents[i + 1]), b)))
            }
            return worst
        }
        // The residue is float32 quantisation of the stored positions, four orders of magnitude
        // below what the Z-up frame does to the same tube.
        expect(seamDrift('minimumTwist')).toBeLessThan(1e-5)
        expect(seamDrift('zUp')).toBeGreaterThan(0.03)
    })

    it('meets itself at the seam of a closed loop, to within the distributed twist', () => {
        const radius = 0.25
        const steps = 10
        const path = closedRail(40)
        const {verts} = sweptBMesh({path, radius, steps, closed: true})
        const {tangents} = calculateFrames(path, true, 'minimumTwist')
        const last = path.length - 1

        // How far the frame fails to close if nothing corrects it - a property of the path.
        const uncorrected = calculateNormalsMinimum(tangents, false)
        const gap = Math.abs(signedAngle(
            transport(uncorrected[last], tangents[last], tangents[0]), uncorrected[0], tangents[0]))
        expect(gap).toBeGreaterThan(0.5)

        // Measured on the generated geometry: how far ring `i + 1`'s first vertex sits from where
        // transporting ring `i`'s would put it. The wrap-around step is no worse than any other,
        // and every step carries exactly its share of the gap. Without the cyclic correction the
        // first 39 would be zero and this one would carry all 0.7 radians.
        const stepDrift = (i: number) => {
            const j = (i + 1) % path.length
            const a = v3normalize(v3sub(co(verts[i * steps]), path[i]))
            const b = v3normalize(v3sub(co(verts[j * steps]), path[j]))
            return Math.abs(angleNormalized(transport(a, tangents[i], tangents[j]), b))
        }
        const drifts = Array.from({length: path.length}, (_, i) => stepDrift(i))
        for (const d of drifts) expect(d).toBeCloseTo(gap / path.length, 5)
        expect(drifts[last]).toBeCloseTo(drifts[0], 5)
    })

    it('has no seam at all on a planar closed loop', () => {
        const radius = 0.3
        const steps = 8
        const path = Array.from({length: 16}, (_, i): Vec3 => {
            const t = 2 * Math.PI * i / 16
            return [2 * Math.cos(t), 2 * Math.sin(t), 0]
        })
        const {verts} = sweptBMesh({path, radius, steps, closed: true})
        // Every ring's first vertex sits at the outside of the torus, at the same height.
        for (let i = 0; i < path.length; i++) {
            const p = co(verts[i * steps])
            expect(v3len([p[0], p[1], 0])).toBeCloseTo(2 + radius, F32_PLACES)
            expect(p[2]).toBeCloseTo(0, F32_PLACES)
        }
    })
})

describe('sweep profiles', () => {
    it('takes an arbitrary 2D section in place of the circle', () => {
        const square: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
        const path = line(4)
        const {bm, verts} = sweptBMesh({path, profile: square, capEnds: true})
        // The profile replaces the circle entirely: four points per ring, not `steps`.
        expect(bm.totvert).toBe(4 * 4)
        expect(bm.totface).toBe(3 * 4 + 2)
        for (const f of [...bm.faces].slice(0, 12)) expect(f.len).toBe(4)
        expect(bm.validate()).toEqual([])

        // The path runs up +Z, so the section lands in an axis-aligned XY square around it.
        for (let i = 0; i < path.length; i++) {
            const ring = [0, 1, 2, 3].map(j => co(verts[i * 4 + j]))
            for (const p of ring) {
                expect(Math.abs(p[0])).toBeCloseTo(0.5, F32_PLACES)
                expect(Math.abs(p[1])).toBeCloseTo(0.5, F32_PLACES)
                expect(p[2]).toBeCloseTo(path[i][2], F32_PLACES)
            }
        }
    })

    it('accepts a profile with a Z component, which offsets along the path', () => {
        const profile: Vec3[] = [[1, 0, 0.5], [0, 1, 0.5], [-1, 0, 0.5]]
        const path = line(3)
        const {verts} = sweptBMesh({path, profile})
        // Profile Z maps onto the tangent, which is +Z here.
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                expect(co(verts[i * 3 + j])[2]).toBeCloseTo(path[i][2] + 0.5, F32_PLACES)
            }
        }
    })

    it('degenerates to a polyline for a single profile point, as Blender does', () => {
        const mesh = curveToMeshSweep(
            [{positions: line(5)}], [{positions: [[0, 0, 0]], cyclic: false}])!
        expect(mesh.vertsNum).toBe(5)
        expect(mesh.edgesNum).toBe(4)
        expect(mesh.facesNum).toBe(0)
        expect(mesh.validate()).toEqual([])
    })

    it('does not close a two-point cyclic path with a duplicate edge', () => {
        // `segments_num_no_duplicate_edge` is the reason: one segment, not two.
        const mesh = primitiveSweep({path: [[0, 0, 0], [0, 0, 1]], radius: 0.2, steps: 6, closed: true})
        expect(mesh.vertsNum).toBe(12)
        expect(mesh.edgesNum).toBe(2 * 6 + 1 * 6)
        expect(mesh.facesNum).toBe(6)
        expect(mesh.validate()).toEqual([])
    })

    it('keeps coincident path points as their own rings rather than dropping them', () => {
        const steps = 5
        const path: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 1], [0, 0, 2]]
        const mesh = primitiveSweep({path, radius: 0.4, steps})
        expect(mesh.vertsNum).toBe(4 * steps)
        expect(mesh.facesNum).toBe(3 * steps)
        expect(mesh.validate()).toEqual([])
        // Rings 0 and 1 coincide, because their path points do.
        const p = mesh.positions
        for (let j = 0; j < steps * 3; j++) expect(p[j]).toBeCloseTo(p[steps * 3 + j], F32_PLACES)
    })

    it('rejects an empty path or an empty profile', () => {
        expect(() => primitiveSweep({path: []})).toThrow(/at least one path point/)
        expect(() => primitiveSweep({path: line(3), profile: []})).toThrow(/at least one profile point/)
    })

    it('matches Blender Curve Circle for the default profile', () => {
        const c = circleProfile(2, 4)
        expect(c[0][0]).toBeCloseTo(2, 12)
        expect(c[0][1]).toBeCloseTo(0, 12)
        expect(c[1][0]).toBeCloseTo(0, 12)
        expect(c[1][1]).toBeCloseTo(2, 12)
        expect(c[2][0]).toBeCloseTo(-2, 12)
        expect(c[3][1]).toBeCloseTo(-2, 12)
    })
})

describe('curveToMeshSweep', () => {
    it('scales the section per path point, Blender\'s radius attribute', () => {
        const path = line(3)
        const steps = 6
        const mesh = curveToMeshSweep(
            [{positions: path}],
            [{positions: circleProfile(1, steps), cyclic: true}],
            {scales: [0.5, 1, 2]})!
        const p = mesh.positions
        for (let i = 0; i < 3; i++) {
            const expectedRadius = [0.5, 1, 2][i]
            for (let j = 0; j < steps; j++) {
                const v: Vec3 = [p[(i * steps + j) * 3], p[(i * steps + j) * 3 + 1], p[(i * steps + j) * 3 + 2]]
                expect(v3len(v3sub(v, path[i]))).toBeCloseTo(expectedRadius, F32_PLACES)
            }
        }
    })

    it('emits one tube per curve combination, packed end to end', () => {
        const steps = 5
        const mesh = curveToMeshSweep(
            [{positions: line(3)}, {positions: line(4)}],
            [{positions: circleProfile(0.2, steps), cyclic: true}],
            {fillCaps: true})!
        // 3 + 4 rings of 5, and (2 + 3) * 5 quads plus two caps each.
        expect(mesh.vertsNum).toBe((3 + 4) * steps)
        expect(mesh.facesNum).toBe((2 + 3) * steps + 4)
        expect(mesh.cornersNum).toBe((2 + 3) * steps * 4 + 4 * steps)
        expect(mesh.validate()).toEqual([])

        const bm = new BMesh()
        const path = line(3)
        sweep(bm, {path, radius: 0.2, steps, capEnds: true})
        sweep(bm, {path: line(4), radius: 0.2, steps, capEnds: true})
        expect(bm.totface).toBe(mesh.facesNum)
        expect(bm.validate()).toEqual([])
        // Two separate closed components.
        expect(eulerCharacteristic(bm)).toBe(4)
    })

    it('sweeps an open section into a ribbon, which cannot be capped', () => {
        const steps = 4
        const mesh = curveToMeshSweep(
            [{positions: line(3)}],
            [{positions: circleProfile(0.5, steps), cyclic: false}],
            {fillCaps: true})!
        // An open profile has one fewer segment, and `has_caps` refuses to cap it.
        expect(mesh.vertsNum).toBe(3 * steps)
        expect(mesh.facesNum).toBe(2 * (steps - 1))
        expect(mesh.attributes.get(AttrName.sharpFace)).toBeTruthy()
        expect([...mesh.attributes.get(AttrName.sharpFace)!.data].filter(Boolean).length).toBe(0)
        expect(mesh.validate()).toEqual([])
    })
})
