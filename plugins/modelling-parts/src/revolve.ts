import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'

/**
 * A surface of revolution about +y with per-ring radius modulation - the shared builder of the round parts.
 *
 * `profile` is a list of `[radius, height]` points from one end to the other; a point with radius 0 at either end
 * becomes a single pole (closed by triangles), otherwise the ends are left open or closed with an n-gon (`caps`).
 * `angles` are the ring's angular samples in radians, ascending in [0, 2pi) (default uniform). `modulate(j, a)`
 * returns a radius offset for profile point `j` at angle `a` - knurling, ribs, flats. Faces wind outwards (seen
 * from outside, counter-clockwise), and a `uv` layer runs u round (0..1) and v along the profile length.
 */
export interface RevolveOptions {
    profile: [number, number][]
    segments?: number
    angles?: number[]
    modulate?: (j: number, angle: number) => number
    caps?: boolean
    /** The profile is a closed loop: the last point joins back to the first (a ring with a bore). */
    closed?: boolean
}

export interface RevolveResult {
    mesh: MeshData
    /** Face index ranges of the band between profile points j and j+1. */
    bandFaces: number[][]
    /** Vertex index of profile point j at angle sample i (a pole repeats one index). */
    vert: (j: number, i: number) => number
}

export function revolve(o: RevolveOptions): RevolveResult {
    const P = o.profile
    if (P.length < 2) throw new Error('revolve: a profile needs at least two points')
    const angles = o.angles ?? Array.from({length: o.segments ?? 32}, (_, i) => i / (o.segments ?? 32) * Math.PI * 2)
    const n = angles.length
    if (n < 3) throw new Error('revolve: at least three angular samples')
    const positions: number[] = []
    const index: number[][] = []
    for (let j = 0; j < P.length; j++) {
        const [r0, h] = P[j]
        const pole = r0 === 0 && (j === 0 || j === P.length - 1)
        if (pole) {
            index.push(Array(n).fill(positions.length / 3))
            positions.push(0, h, 0)
            continue
        }
        const row: number[] = []
        for (let i = 0; i < n; i++) {
            const a = angles[i]
            const r = r0 + (o.modulate?.(j, a) ?? 0)
            row.push(positions.length / 3)
            // angle 0 on +z, increasing towards +x: seen from +y the ring runs clockwise, so bands wind outwards
            positions.push(r * Math.sin(a), h, r * Math.cos(a))
        }
        index.push(row)
    }
    const faces: number[][] = []
    const bandFaces: number[][] = []
    const bands = o.closed ? P.length : P.length - 1
    for (let j = 0; j < bands; j++) {
        const band: number[] = []
        const A = index[j], B = index[(j + 1) % P.length]
        for (let i = 0; i < n; i++) {
            const i2 = (i + 1) % n
            const quad = [A[i], A[i2], B[i2], B[i]]
            const f = quad.filter((v, k) => quad.indexOf(v) === k)
            if (f.length < 3) continue
            band.push(faces.length)
            faces.push(f)
        }
        bandFaces.push(band)
    }
    if (o.caps && !o.closed) {
        const first = index[0], last = index[P.length - 1]
        if (new Set(first).size > 1) faces.push([...first].reverse())
        if (new Set(last).size > 1) faces.push([...last])
    }
    const mesh = MeshData.fromFaces({positions, faces})
    // uv: u by angle, v by profile arc length
    const len = [0]
    for (let j = 1; j < P.length; j++) len.push(len[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]))
    const total = (o.closed ? len[len.length - 1] + Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) : len[len.length - 1]) || 1
    const uv = mesh.attributes.ensure('uv', AttrDomain.Corner, 'float2').data
    const vj = new Map<number, [number, number]>()
    for (let j = 0; j < P.length; j++) for (let i = 0; i < n; i++) if (!vj.has(index[j][i])) vj.set(index[j][i], [j, i])
    const O = mesh.faceOffsets, CV = mesh.cornerVerts
    for (let f = 0; f < mesh.facesNum; f++) {
        // the seam: a face spanning the last and first samples takes u = 1 on its first-sample corners
        let maxI = 0
        for (let c = O[f]; c < O[f + 1]; c++) maxI = Math.max(maxI, vj.get(CV[c])![1])
        for (let c = O[f]; c < O[f + 1]; c++) {
            const [j, i] = vj.get(CV[c])!
            const u = i === 0 && maxI === n - 1 ? 1 : angles[i] / (Math.PI * 2)
            uv[2 * c] = u
            uv[2 * c + 1] = len[j] / total
        }
    }
    return {mesh, bandFaces, vert: (j, i) => index[j][i]}
}
