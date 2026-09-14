import {Ctx} from './ctx'

// ArrayModifierData.offset_type bits — DNA_modifier_types.h (ArrayModifierOffsetType).
const MOD_ARR_OFF_CONST = 1 << 0
const MOD_ARR_OFF_RELATIVE = 1 << 1
const MOD_ARR_OFF_OBJ = 1 << 2
// fit_type — ArrayModifierFitType.
const MOD_ARR_FITLENGTH = 1, MOD_ARR_FITCURVE = 2

function bboxSize(pos: Float32Array): [number, number, number] {
    let xn = Infinity, yn = Infinity, zn = Infinity, xx = -Infinity, yx = -Infinity, zx = -Infinity
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2]
        if (x < xn) xn = x; if (x > xx) xx = x
        if (y < yn) yn = y; if (y > yx) yx = y
        if (z < zn) zn = z; if (z > zx) zx = z
    }
    return [xx - xn, yx - yn, zx - zn]
}

/**
 * Apply a Blender Array modifier to an indexed triangle BufferGeometry (already in three.js space), porting
 * `MOD_array.cc`: build the per-duplicate offset = (const offset) + (relative factor × bounding-box size),
 * then emit `count` copies, copy `c` translated by `c × offset`. `count` is fixed (FIXEDCOUNT) or computed
 * from `length / |offset|` (FITLENGTH). Object-offset (`MOD_ARR_OFF_OBJ`), fit-to-curve, caps, and the merge
 * option are not supported (warned). UVs shift by `uv_offset` per copy. Returns a new geometry.
 */
export function arrayGeometry(geometry: any, amd: any, ctx: Ctx): any {
    if (!geometry.index || !geometry.attributes.position) return geometry
    const pos = geometry.attributes.position.array as Float32Array
    const uv = geometry.attributes.uv ? geometry.attributes.uv.array as Float32Array : null
    const index = geometry.index.array as Uint32Array | Uint16Array

    const offType = (amd.offset_type ?? MOD_ARR_OFF_RELATIVE) | 0
    // three-space bbox → Blender axis sizes (three tx=bx, ty=bz, tz=-by ⇒ blender X/Y/Z = three X/Z/Y sizes).
    const [tsx, tsy, tsz] = bboxSize(pos)
    const bSize = [tsx, tsz, tsy]
    // Accumulate the offset in BLENDER space, then convert the vector to three (x, z, -y).
    const bo = [0, 0, 0]
    if (offType & MOD_ARR_OFF_CONST && amd.offset) for (let j = 0; j < 3; j++) bo[j] += amd.offset[j]
    if (offType & MOD_ARR_OFF_RELATIVE && amd.scale) for (let j = 0; j < 3; j++) bo[j] += amd.scale[j] * bSize[j]
    if (offType & MOD_ARR_OFF_OBJ) console.warn('BlendLoader - Array object-offset (rotation/scale per copy) is unsupported; using translation only')
    const off = [bo[0], bo[2], -bo[1]]

    let count = amd.count ?? 2
    if (amd.fit_type === MOD_ARR_FITLENGTH) {
        const len = Math.hypot(off[0], off[1], off[2])
        count = len > 1e-6 ? Math.floor((amd.length || 0) / len) + 1 : 1
    } else if (amd.fit_type === MOD_ARR_FITCURVE) {
        console.warn('BlendLoader - Array fit-to-curve is unsupported; using the fixed count')
    }
    count = Math.max(1, Math.min(1000, count | 0)) // cap runaway counts
    if (count <= 1) return geometry

    const n = pos.length / 3
    const uOff = amd.uv_offset?.[0] || 0, vOff = amd.uv_offset?.[1] || 0
    const outPos = new Float32Array(n * 3 * count)
    const outUv = uv ? new Float32Array(n * 2 * count) : null
    for (let c = 0; c < count; c++) {
        const vb = c * n
        for (let v = 0; v < n; v++) {
            outPos[(vb + v) * 3] = pos[v * 3] + c * off[0]
            outPos[(vb + v) * 3 + 1] = pos[v * 3 + 1] + c * off[1]
            outPos[(vb + v) * 3 + 2] = pos[v * 3 + 2] + c * off[2]
            if (outUv && uv) { outUv[(vb + v) * 2] = uv[v * 2] + c * uOff; outUv[(vb + v) * 2 + 1] = uv[v * 2 + 1] + c * vOff }
        }
    }
    const Ctor = n * count > 65535 ? Uint32Array : Uint16Array
    const outIdx = new Ctor(index.length * count)
    for (let c = 0; c < count; c++) {
        const ib = c * index.length, vb = c * n
        for (let k = 0; k < index.length; k++) outIdx[ib + k] = index[k] + vb
    }

    const out = new ctx.BufferGeometry()
    out.setAttribute('position', new ctx.BufferAttribute(outPos, 3))
    if (outUv) out.setAttribute('uv', new ctx.BufferAttribute(outUv, 2))
    out.setIndex(new ctx.BufferAttribute(outIdx, 1))
    if (geometry.groups && geometry.groups.length) {
        for (let c = 0; c < count; c++)
            for (const g of geometry.groups) out.addGroup(g.start + c * index.length, g.count, g.materialIndex)
    }
    out.computeVertexNormals()
    out.name = geometry.name
    return out
}
