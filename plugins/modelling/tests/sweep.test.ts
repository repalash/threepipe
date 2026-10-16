import {describe, expect, it} from 'vitest'
import type {MeshData} from '@threepipe/mesh-kernel'
import {sweepYUp} from '../src/commands/create'

/**
 * Which way a custom `sweep` section faces in a Y-up world.
 *
 * The kernel is Blender's Curve to Mesh, whose frames are Z-up (`curve_poly.cc`,
 * `calculate_normals_z_up` / `calculate_normals_minimum`). The command converts the path into
 * Blender's axes and the result back, so "up" means threepipe's +Y. Before that conversion a path
 * in the XY plane and the same path in the YZ plane put a one-sided section on different sides,
 * because threepipe's +Z (horizontal) was being treated as up.
 */

type V = [number, number, number]

function vertices(mesh: MeshData): V[] {
    const out: V[] = []
    for (let i = 0; i < mesh.vertsNum; i++) {
        out.push([mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]])
    }
    return out
}

function extent(points: V[], axis: 0 | 1 | 2): [number, number] {
    let lo = Infinity, hi = -Infinity
    for (const p of points) {
        lo = Math.min(lo, p[axis])
        hi = Math.max(hi, p[axis])
    }
    return [lo, hi]
}

/** A section 0.5 deep on one side of the path and 0.2 thick: the Eiffel arch's shape. */
const ONE_SIDED: [number, number][] = [[0, -0.1], [0.5, -0.1], [0.5, 0.1], [0, 0.1]]

/** A climbing path in a vertical plane, given as (along, up) pairs. */
const CLIMB: [number, number][] = [[0, 0], [1, 1], [2, 1.5], [3, 1.6]]

describe('sweep in a Y-up world', () => {
    it('puts a one-sided section across the plane of an XY-plane path', () => {
        const mesh = sweepYUp({path: CLIMB.map(([a, u]): V => [a, u, 0]), profile: ONE_SIDED, capEnds: true})
        expect(mesh.validate()).toEqual([])
        const [zLo, zHi] = extent(vertices(mesh), 2)
        // Planar path, minimum twist: the normal stays the plane normal, so profile x is all along Z.
        expect(zHi - zLo).toBeCloseTo(0.5, 6)
    })

    it('puts the same section across the plane of the same path drawn in the YZ plane', () => {
        const mesh = sweepYUp({path: CLIMB.map(([a, u]): V => [0, u, a]), profile: ONE_SIDED, capEnds: true})
        expect(mesh.validate()).toEqual([])
        const [xLo, xHi] = extent(vertices(mesh), 0)
        expect(xHi - xLo).toBeCloseTo(0.5, 6)
    })

    it('XY and YZ are the same sweep turned a quarter turn about Y', () => {
        const xy = vertices(sweepYUp({path: CLIMB.map(([a, u]): V => [a, u, 0]), profile: ONE_SIDED}))
        const yz = vertices(sweepYUp({path: CLIMB.map(([a, u]): V => [0, u, a]), profile: ONE_SIDED}))
        // Rotating (x, y, z) by -90 degrees about Y maps x -> z, z -> -x: the YZ path is the XY path
        // rotated, and the frames are built from world up only, so the sweep must rotate with it.
        expect(yz.length).toBe(xy.length)
        for (let i = 0; i < xy.length; i++) {
            expect(yz[i][0]).toBeCloseTo(-xy[i][2], 6)
            expect(yz[i][1]).toBeCloseTo(xy[i][1], 6)
            expect(yz[i][2]).toBeCloseTo(xy[i][0], 6)
        }
    })

    it('on a horizontal path profile x points right of travel and y points down, as in Blender', () => {
        // Travelling +X with +Y up, right is +Z. A single-point profile lands exactly on the frame.
        const right = vertices(sweepYUp({path: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], profile: [[1, 0]], capEnds: false}))
        for (const v of right) {
            expect(v[1]).toBeCloseTo(0, 6)
            expect(v[2]).toBeCloseTo(1, 6)
        }
        const down = vertices(sweepYUp({path: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], profile: [[0, 1]], capEnds: false}))
        for (const v of down) {
            expect(v[1]).toBeCloseTo(-1, 6)
            expect(v[2]).toBeCloseTo(0, 6)
        }
    })

    it('`zUp` keeps every normal horizontal on a helix about Y', () => {
        const path: V[] = []
        for (let i = 0; i <= 48; i++) {
            const a = i * Math.PI / 12
            path.push([Math.cos(a), i * 0.05, Math.sin(a)])
        }
        // A single-point profile at x = 1 sits one unit along the normal from each path point.
        const ring = vertices(sweepYUp({path, profile: [[1, 0]], normalMode: 'zUp', capEnds: false}))
        expect(ring.length).toBe(path.length)
        for (let i = 0; i < path.length; i++) expect(ring[i][1]).toBeCloseTo(path[i][1], 6)
    })

    it('keeps radii and tube sizes: the conversion is a rotation', () => {
        const mesh = sweepYUp({path: [[5, 0, 0], [5, 1, 0], [5, 2, 0]], radius: 0.5, steps: 12, radii: [1, 0.5, 0.1]})
        const top = vertices(mesh).filter(v => v[1] > 1.99)
        expect(top.length).toBe(12)
        for (const v of top) expect(Math.hypot(v[0] - 5, v[2])).toBeCloseTo(0.05, 6)
    })
})
