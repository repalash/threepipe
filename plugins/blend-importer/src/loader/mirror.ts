import {Ctx} from './ctx'

// MirrorModifierData.flag bits — DNA_modifier_types.h (MirrorModifierFlag).
export const MOD_MIR_CLIPPING = 1 << 0
export const MOD_MIR_MIRROR_U = 1 << 1
export const MOD_MIR_MIRROR_V = 1 << 2
export const MOD_MIR_AXIS_X = 1 << 3
export const MOD_MIR_AXIS_Y = 1 << 4
export const MOD_MIR_AXIS_Z = 1 << 5
export const MOD_MIR_NO_MERGE = 1 << 7

// Blender mirror axis (0=X,1=Y,2=Z) → the three.js position component to reflect, given the loader's
// Z-up→Y-up vertex mapping tx=bx, ty=bz, tz=-by: mirroring Blender X/Y/Z reflects three X/Z/Y.
const AXIS_TO_THREE_COMP = [0, 2, 1]

/**
 * Apply a Blender Mirror modifier to an indexed triangle BufferGeometry (already in three.js space),
 * porting `MOD_mirror.cc` / `BKE_mesh_mirror_apply_mirror_on_axis_for_modifier`: for each enabled axis the
 * geometry is duplicated and reflected across the object-origin plane, the duplicate's face winding is
 * reversed (so normals stay outward), and vertices within `tolerance` of the plane are MERGED into their
 * originals (unless NO_MERGE) to avoid a centre seam. Mirror-object planes (`mirror_ob`) are not supported
 * (falls back to the object's own origin). UVs are flipped per MIRROR_U / MIRROR_V. Returns a new geometry.
 */
export function mirrorGeometry(geometry: any, mmd: any, ctx: Ctx): any {
    const flag = (mmd.flag ?? MOD_MIR_AXIS_X) | 0
    const axes: number[] = []
    if (flag & MOD_MIR_AXIS_X) axes.push(0)
    if (flag & MOD_MIR_AXIS_Y) axes.push(1)
    if (flag & MOD_MIR_AXIS_Z) axes.push(2)
    if (!axes.length || !geometry.index || !geometry.attributes.position) return geometry

    let pos = geometry.attributes.position.array as Float32Array
    let uv = geometry.attributes.uv ? geometry.attributes.uv.array as Float32Array : null
    let index = geometry.index.array as Uint32Array | Uint16Array
    let groups = geometry.groups && geometry.groups.length ? geometry.groups.map((g: any) => ({...g})) : null
    const tol = (mmd.tolerance ?? 0.001)
    const merge = !(flag & MOD_MIR_NO_MERGE)
    const flipU = !!(flag & MOD_MIR_MIRROR_U), flipV = !!(flag & MOD_MIR_MIRROR_V)
    const uOff = mmd.uv_offset?.[0] || 0, vOff = mmd.uv_offset?.[1] || 0

    for (const axis of axes) {
        const comp = AXIS_TO_THREE_COMP[axis]
        const n = pos.length / 3
        // Mirrored copy index for original vertex v: itself if on the mirror plane and merging (welds the
        // seam), else a fresh vertex appended after the originals.
        const onPlane = new Uint8Array(n)
        const copyOf = new Int32Array(n)
        let extra = 0
        for (let v = 0; v < n; v++) {
            const c = pos[v * 3 + comp]
            if (merge && Math.abs(c) <= tol) { onPlane[v] = 1; copyOf[v] = v }
            else copyOf[v] = n + (extra++)
        }
        // Positions: originals + reflected copies (only the non-welded ones).
        const outPos = new Float32Array((n + extra) * 3)
        outPos.set(pos)
        const outUv = uv ? new Float32Array((n + extra) * 2) : null
        if (outUv && uv) outUv.set(uv)
        for (let v = 0; v < n; v++) {
            if (onPlane[v]) continue
            const d = copyOf[v]
            outPos[d * 3] = pos[v * 3]; outPos[d * 3 + 1] = pos[v * 3 + 1]; outPos[d * 3 + 2] = pos[v * 3 + 2]
            outPos[d * 3 + comp] = -pos[v * 3 + comp] // reflect
            if (outUv && uv) {
                let u = uv[v * 2], w = uv[v * 2 + 1]
                if (flipU) u = uOff + 1 - u
                if (flipV) w = vOff + 1 - w
                outUv[d * 2] = u; outUv[d * 2 + 1] = w
            }
        }
        // Faces: originals + reflected copies with REVERSED winding (a,b,c) -> (a',c',b').
        const triCount = index.length / 3
        const Ctor = (n + extra) > 65535 ? Uint32Array : Uint16Array
        const outIdx = new Ctor(index.length * 2)
        outIdx.set(index)
        for (let t = 0; t < triCount; t++) {
            const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2]
            const o = index.length + t * 3
            outIdx[o] = copyOf[a]; outIdx[o + 1] = copyOf[c]; outIdx[o + 2] = copyOf[b]
        }
        // Groups: duplicate each for the appended mirror faces (same material), shifted by the original
        // index length (group ranges are in index units).
        if (groups) {
            const extraGroups = groups.map((g: any) => ({...g, start: g.start + index.length}))
            groups = groups.concat(extraGroups)
        }
        pos = outPos; uv = outUv; index = outIdx
    }

    const out = new ctx.BufferGeometry()
    out.setAttribute('position', new ctx.BufferAttribute(pos, 3))
    if (uv) out.setAttribute('uv', new ctx.BufferAttribute(uv, 2))
    out.setIndex(new ctx.BufferAttribute(index, 1))
    if (groups) for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex)
    out.computeVertexNormals()
    out.name = geometry.name
    return out
}
