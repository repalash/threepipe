import {Ctx} from './ctx'

// SolidifyModifierData.flag bits — DNA_modifier_types.h.
const MOD_SOLIDIFY_RIM = 1 << 0
const MOD_SOLIDIFY_FLIP = 1 << 5
const MOD_SOLIDIFY_NOSHELL = 1 << 6
const MOD_SOLIDIFY_MODE_NONMANIFOLD = 1

// Smooth per-vertex normals (area-weighted via the un-normalized face normals), used to offset the shells.
function vertexNormals(pos: Float32Array, index: Uint32Array | Uint16Array): Float32Array {
    const n = pos.length / 3
    const nor = new Float32Array(n * 3)
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2]
        const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
        const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az
        const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx // not normalized → area weight
        for (const i of [a, b, c]) { nor[i * 3] += nx; nor[i * 3 + 1] += ny; nor[i * 3 + 2] += nz }
    }
    for (let i = 0; i < n; i++) {
        const x = nor[i * 3], y = nor[i * 3 + 1], z = nor[i * 3 + 2]
        const l = Math.hypot(x, y, z) || 1
        nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l
    }
    return nor
}

/**
 * Apply a Blender Solidify modifier (Simple/Extrude mode) to an indexed triangle BufferGeometry (already in
 * three.js space), porting `MOD_solidify_extrude.cc`: build two shells offset along the vertex normals by
 * `ofs_orig` and `ofs_new` (derived from `offset`/`offset_fac`), the offset shell with reversed winding, and
 * connect open boundary edges with a rim. (Non-manifold mode, even-thickness, vertex groups, per-shell
 * material offsets and crease are not supported.) Returns a new geometry.
 */
export function solidifyGeometry(geometry: any, smd: any, ctx: Ctx): any {
    if (!geometry.index || !geometry.attributes.position) return geometry
    if (smd.mode === MOD_SOLIDIFY_MODE_NONMANIFOLD) {
        console.warn('BlendLoader - Solidify "Complex"/non-manifold mode is unsupported; using simple extrude')
    }
    const pos = geometry.attributes.position.array as Float32Array
    const index = geometry.index.array as Uint32Array | Uint16Array
    const flag = (smd.flag ?? MOD_SOLIDIFY_RIM) | 0
    const offset = typeof smd.offset === 'number' ? smd.offset : 0.01
    const offsetFac = typeof smd.offset_fac === 'number' ? smd.offset_fac : -1
    const doRim = !!(flag & MOD_SOLIDIFY_RIM)
    const doShell = !(doRim && (flag & MOD_SOLIDIFY_NOSHELL))
    const flip = (flag & MOD_SOLIDIFY_FLIP) ? -1 : 1
    const ofsOrig = -(((-offsetFac + 1) * 0.5) * offset)
    const ofsNew = offset + ofsOrig

    const nor = geometry.attributes.normal ? geometry.attributes.normal.array as Float32Array : vertexNormals(pos, index)
    const n = pos.length / 3
    // Shell A = originals offset by ofsOrig; shell B = copies offset by ofsNew (indices + n).
    const outPos = new Float32Array(n * 2 * 3)
    for (let v = 0; v < n; v++) {
        for (let k = 0; k < 3; k++) {
            const base = pos[v * 3 + k], nk = nor[v * 3 + k] * flip
            outPos[v * 3 + k] = base + ofsOrig * nk
            outPos[(n + v) * 3 + k] = base + ofsNew * nk
        }
    }

    const tris: number[] = []
    const triCount = index.length / 3
    const idxLen = index.length
    if (doShell) {
        for (let t = 0; t < triCount; t++) tris.push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2]) // shell A
        for (let t = 0; t < triCount; t++) tris.push(n + index[t * 3], n + index[t * 3 + 2], n + index[t * 3 + 1]) // shell B reversed
    }
    // Rim: boundary edges (appear in exactly one triangle). Connect A↔B with two triangles per edge, wound to
    // continue the boundary face's orientation outward.
    if (doRim) {
        const key = (x: number, y: number) => x < y ? x * n + y : y * n + x
        const edgeCount = new Map<number, number>()
        const edgeDir = new Map<number, [number, number]>()
        const addEdge = (x: number, y: number) => {
            const k = key(x, y)
            edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
            if (!edgeDir.has(k)) edgeDir.set(k, [x, y])
        }
        for (let t = 0; t < triCount; t++) {
            const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2]
            addEdge(a, b); addEdge(b, c); addEdge(c, a)
        }
        for (const [k, cnt] of edgeCount) {
            if (cnt !== 1) continue
            const [x, y] = edgeDir.get(k)! // boundary edge in a face's winding order
            tris.push(x, y, n + y); tris.push(x, n + y, n + x)
        }
    }

    const Ctor = n * 2 > 65535 ? Uint32Array : Uint16Array
    const out = new ctx.BufferGeometry()
    out.setAttribute('position', new ctx.BufferAttribute(outPos, 3))
    out.setIndex(new ctx.BufferAttribute(new Ctor(tris), 1))
    // Material groups (only when the mesh is multi-material): shell A keeps the originals' assignment, shell B
    // is the same shifted by the shell-A length, and the rim takes the first material. (Per-shell/rim material
    // offsets unsupported.) Without groups (single material), every triangle just uses the one material.
    if (geometry.groups && geometry.groups.length) {
        const shellLen = doShell ? idxLen : 0
        if (doShell) for (const g of geometry.groups) {
            out.addGroup(g.start, g.count, g.materialIndex)            // shell A
            out.addGroup(idxLen + g.start, g.count, g.materialIndex)   // shell B
        }
        const rimLen = tris.length - shellLen * 2
        if (rimLen > 0) out.addGroup(shellLen * 2, rimLen, geometry.groups[0].materialIndex) // rim
    }
    out.computeVertexNormals()
    out.name = geometry.name
    return out
}
