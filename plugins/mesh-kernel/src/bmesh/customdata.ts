/**
 * Per-element attribute blocks for BMesh elements.
 *
 * The equivalent of Blender's `CustomData` (`blenkernel/BKE_customdata.hh`, accessed through the
 * `BM_ELEM_CD_GET_*` macros in `bmesh_class.hh:571-689`). Each domain owns a layout: an ordered list
 * of named layers, each with an offset into the element's data block. Blender addresses a block by
 * byte offset into `head.data`; here a block is a `Float32Array` plus an `Int32Array`, and an offset
 * is an element index into whichever of the two the layer uses.
 *
 * This is what keeps UVs, creases and colours correct through topology changes: an operator that
 * splits an edge asks the layout to interpolate, rather than knowing what layers exist.
 */

import {ATTR_TYPE_INFO, AttrType, ElemFlag} from '../constants'
import {BMElem} from './types'

/** Which of an element's two blocks a layer lives in. */
export type BMLayerStorage = 'float' | 'int'

export interface BMLayerDef {
    readonly name: string
    readonly type: AttrType
    readonly components: number
    /** Index of this layer's first component within the element's block. */
    readonly offset: number
    readonly storage: BMLayerStorage
    /** How a weighted blend combines this layer's values. See {@link BMLayerInterp}. */
    readonly interp: BMLayerInterp
    /** True when {@link interp} is anything other than `'none'`. */
    readonly interpolates: boolean
}

/**
 * How a weighted blend combines a layer's values.
 *
 * One case per `.interp` callback in Blender's `LAYERTYPEINFO` table
 * (`blenkernel/intern/customdata.cc:1528`). This matters because `CustomData_bmesh_interp`
 * (`customdata.cc:4004`) only touches a layer when its type declares a callback:
 *
 * ```c
 * if (typeInfo->interp) { ... CustomData_bmesh_interp_n(...) ... }
 * ```
 *
 * A type without one is left exactly as the destination was found - which after an operator has
 * copied an example block means "keep the copy". That is `'none'` here, and it is neither an
 * average nor "take the dominant source".
 */
export type BMLayerInterp = 'none' | 'float' | 'int' | 'bool' | 'byteColor' | 'quaternion'

function storageFor(type: AttrType): BMLayerStorage {
    switch (type) {
    case 'bool':
    case 'int8':
    case 'int32':
    case 'int32x2':
    case 'int16x2':
    case 'byteColor':
        return 'int'
    default:
        return 'float'
    }
}

/**
 * The blend rule Blender gives each type. Cited line numbers are into
 * `blenkernel/intern/customdata.cc`.
 */
function interpFor(type: AttrType): BMLayerInterp {
    switch (type) {
    // `layerInterp_propFloat` (:466), `_propfloat2` (:1381), `_propfloat3` (:1329) and
    // `_propcol` (:1272, the `CD_PROP_COLOR` float4) are all the same plain weighted sum.
    case 'float':
    case 'float2':
    case 'float3':
    case 'float4':
        return 'float'
    // `layerInterp_propInt` (:503) sums in float and then `int(round(result))`. An integer layer is
    // interpolated - it just cannot land between two integers.
    case 'int32':
        return 'int'
    // `layerInterp_propbool` (:1471): `result |= src && (weight > 0.0f)`.
    case 'bool':
        return 'bool'
    // `layerInterp_mloopcol` (:914): weighted sum per channel, then `round_fl_to_uchar_clamp`.
    case 'byteColor':
        return 'byteColor'
    // `layerInterp_propquaternion` (:1493): weighted mean through the exponential map.
    case 'quaternion':
        return 'quaternion'
    // `CD_PROP_INT8` (:1916), `CD_PROP_INT32_2D` (:1924) declare no `.interp` callback, so
    // `CustomData_bmesh_interp` skips them. `int16x2` has no Blender mesh-domain counterpart and
    // follows the same rule.
    case 'int8':
    case 'int32x2':
    case 'int16x2':
        return 'none'
    }
}

/**
 * The layer layout for one domain. Adding a layer after elements exist grows their blocks lazily:
 * a block is only allocated when a value is first written, and a short block reads as the default.
 */
export class BMCustomDataLayout {
    private _layers: BMLayerDef[] = []
    private _byName = new Map<string, BMLayerDef>()
    floatSize = 0
    intSize = 0

    get layers(): readonly BMLayerDef[] {
        return this._layers
    }

    get(name: string): BMLayerDef | undefined {
        return this._byName.get(name)
    }

    has(name: string): boolean {
        return this._byName.has(name)
    }

    /** Add a layer, or return the existing one when the name and type already match. */
    add(name: string, type: AttrType): BMLayerDef {
        const existing = this._byName.get(name)
        if (existing) {
            if (existing.type !== type) {
                throw new Error(`mesh-kernel: layer '${name}' already exists with type '${existing.type}', not '${type}'`)
            }
            return existing
        }
        const components = ATTR_TYPE_INFO[type].components
        const storage = storageFor(type)
        const offset = storage === 'float' ? this.floatSize : this.intSize
        if (storage === 'float') this.floatSize += components
        else this.intSize += components

        const interp = interpFor(type)
        const def: BMLayerDef = {name, type, components, offset, storage, interp, interpolates: interp !== 'none'}
        this._layers.push(def)
        this._byName.set(name, def)
        return def
    }

    /** Layers that a blend should interpolate rather than copy. */
    interpolatingLayers(): BMLayerDef[] {
        return this._layers.filter(l => l.interpolates)
    }

    clone(): BMCustomDataLayout {
        const out = new BMCustomDataLayout()
        out._layers = [...this._layers]
        out._byName = new Map(this._byName)
        out.floatSize = this.floatSize
        out.intSize = this.intSize
        return out
    }
}

/** Allocate (or grow) an element's blocks so every layer of `layout` fits. */
export function ensureBlocks(elem: BMElem, layout: BMCustomDataLayout): void {
    if (layout.floatSize > 0 && (!elem.fdata || elem.fdata.length < layout.floatSize)) {
        const next = new Float32Array(layout.floatSize)
        if (elem.fdata) next.set(elem.fdata)
        elem.fdata = next
    }
    if (layout.intSize > 0 && (!elem.idata || elem.idata.length < layout.intSize)) {
        const next = new Int32Array(layout.intSize)
        if (elem.idata) next.set(elem.idata)
        elem.idata = next
    }
}

/** Read one component. Returns the type's default when the element has no block yet. */
export function getComponent(elem: BMElem, layer: BMLayerDef, component = 0): number {
    const i = layer.offset + component
    if (layer.storage === 'float') {
        return elem.fdata && i < elem.fdata.length ? elem.fdata[i] : ATTR_TYPE_INFO[layer.type].defaultValue
    }
    return elem.idata && i < elem.idata.length ? elem.idata[i] : ATTR_TYPE_INFO[layer.type].defaultValue
}

/** Write one component, allocating the block on first write. */
export function setComponent(
    elem: BMElem, layout: BMCustomDataLayout, layer: BMLayerDef, component: number, value: number,
): void {
    ensureBlocks(elem, layout)
    const i = layer.offset + component
    if (layer.storage === 'float') elem.fdata![i] = value
    else elem.idata![i] = value
}

/** Read every component of a layer into `out` (allocated when omitted). */
export function getValue(elem: BMElem, layer: BMLayerDef, out?: number[]): number[] {
    const target = out ?? new Array(layer.components)
    for (let c = 0; c < layer.components; c++) target[c] = getComponent(elem, layer, c)
    return target
}

/** Write every component of a layer. */
export function setValue(
    elem: BMElem, layout: BMCustomDataLayout, layer: BMLayerDef, values: ArrayLike<number>,
): void {
    ensureBlocks(elem, layout)
    for (let c = 0; c < layer.components; c++) {
        const i = layer.offset + c
        const v = values[c] ?? 0
        if (layer.storage === 'float') elem.fdata![i] = v
        else elem.idata![i] = v
    }
}

/**
 * Which header flags a copy leaves alone, per domain - Blender's `hflag_mask`.
 *
 * `BM_elem_attrs_copy` (`bmesh_construct.cc:333-364`) is one line repeated four times:
 *
 * ```c
 * dst->head.hflag = (dst->head.hflag & hflag_mask) | (src->head.hflag & ~hflag_mask);
 * ```
 *
 * So the destination **keeps its own selection** and takes **everything else** from the source,
 * including `BM_ELEM_TAG`. Both halves matter and both are easy to get backwards: an operator that
 * tags geometry before separating it needs the tag to survive, and a new face must not arrive
 * selected just because its example was - the selection counters are maintained by `faceSelectSet`
 * and friends, not by `faceCreate`, so an inherited bit desynchronises them silently.
 *
 * The mask widens with the domain because Blender has more selection bits further down. This kernel
 * has no `BM_ELEM_SELECT_UV_EDGE`, so the loop mask is the face mask.
 */
export const HFLAG_COPY_MASK = {
    vert: ElemFlag.Select,
    edge: ElemFlag.Select,
    face: ElemFlag.Select | ElemFlag.SelectUV,
    loop: ElemFlag.Select | ElemFlag.SelectUV,
} as const

/**
 * Copy `src`'s header flags onto `dst`, keeping `dst`'s own selection.
 *
 * The header half of `BM_elem_attrs_copy`; {@link copyElemAttrs} is the custom-data half. Blender
 * also copies the cached `no` for verts and faces, and so does this - `nx`/`ny`/`nz` on the element,
 * which operators that read a normal before recomputing it depend on.
 */
export function copyElemHeader(
    src: {hflag: number, nx?: number, ny?: number, nz?: number},
    dst: {hflag: number, nx?: number, ny?: number, nz?: number},
    domain: keyof typeof HFLAG_COPY_MASK,
): void {
    const mask = HFLAG_COPY_MASK[domain]
    dst.hflag = (dst.hflag & mask) | (src.hflag & ~mask)
    if (src.nx !== undefined && dst.nx !== undefined) {
        dst.nx = src.nx
        dst.ny = src.ny!
        dst.nz = src.nz!
    }
}

/**
 * Copy every layer from `src` to `dst`. Port of `BM_elem_attrs_copy`
 * (`bmesh_construct.cc:333`). Both elements must be on the same domain.
 */
export function copyElemAttrs(src: BMElem, dst: BMElem, layout: BMCustomDataLayout): void {
    if (src === dst) return
    if (src.fdata && layout.floatSize > 0) {
        ensureBlocks(dst, layout)
        dst.fdata!.set(src.fdata.subarray(0, Math.min(src.fdata.length, dst.fdata!.length)))
    }
    if (src.idata && layout.intSize > 0) {
        ensureBlocks(dst, layout)
        dst.idata!.set(src.idata.subarray(0, Math.min(src.idata.length, dst.idata!.length)))
    }
}

/**
 * C's `round()`: halves go away from zero, where JS `Math.round` sends them towards `+Infinity`.
 * `layerInterp_propInt` uses `round()`, and `-0.5` must come out as `-1` rather than `-0`.
 */
function roundAwayFromZero(x: number): number {
    return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** `round_fl_to_uchar_clamp` (`blenlib/intern/math_base_inline.cc:201`): `floor(a + 0.5)`, clamped. */
function roundToUcharClamp(a: number): number {
    const r = Math.floor(a + 0.5)
    if (r <= 0) return 0
    if (r >= 255) return 255
    return r
}

const QUAT_EPS = 0.0005

/**
 * `QuaternionBase::expmap()` (`blenlib/BLI_math_quaternion.hh:698`) via `to_axis_angle` (`:630`):
 * the rotation axis scaled by the rotation angle. Components are `(w, x, y, z)`.
 */
function quatToExpmap(w: number, x: number, y: number, z: number, out: [number, number, number]): void {
    const sinHalf = Math.sqrt(x * x + y * y + z * z)
    if (sinHalf < QUAT_EPS) {
        // `to_axis_angle` degenerate branch: the identity axis with a zero angle, so a zero expmap.
        out[0] = out[1] = out[2] = 0
        return
    }
    const angle = Math.atan2(sinHalf, w) * 2
    out[0] = x / sinHalf * angle
    out[1] = y / sinHalf * angle
    out[2] = z / sinHalf * angle
}

/** `QuaternionBase::expmap(const float3 &)` (`blenlib/BLI_math_quaternion.hh:686`). */
function expmapToQuat(ex: number, ey: number, ez: number, out: [number, number, number, number]): void {
    const angleRaw = Math.sqrt(ex * ex + ey * ey + ez * ez)
    if (angleRaw === 0) {
        out[0] = 1
        out[1] = out[2] = out[3] = 0
        return
    }
    const ax = ex / angleRaw, ay = ey / angleRaw, az = ez / angleRaw
    // `AngleRadianBase::wrapped()` (`blenlib/BLI_math_angle_types.hh:80`), i.e. into (-pi, pi].
    const twoPi = 2 * Math.PI
    const shifted = angleRaw + Math.PI
    const angle = shifted - Math.floor(shifted / twoPi) * twoPi - Math.PI
    const half = angle / 2
    const s = Math.sin(half)
    out[0] = Math.cos(half)
    out[1] = ax * s
    out[2] = ay * s
    out[3] = az * s
}

/**
 * Blend `sources` into `dst` with the given weights, one layer at a time.
 *
 * Port of `CustomData_bmesh_interp` (`blenkernel/intern/customdata.cc:4004`) and the per-type
 * `layerInterp_*` callbacks it dispatches to. Every `BM_data_interp_*` entry point in
 * `bmesh_interp.cc` bottoms out here; see `bmesh/interp.ts` for those.
 *
 * Structural difference from Blender: a source is an element rather than a raw block pointer, and a
 * layer addresses a slot in the element's `fdata`/`idata` rather than a byte offset. The rules per
 * type are unchanged - see {@link BMLayerInterp}.
 *
 * A layer whose type carries no `.interp` callback in Blender is skipped, leaving whatever `dst`
 * already held. Operators copy an example block before interpolating (`bm_loop_create(..., l, ...)`
 * inside SEMV, for instance), so "skipped" means "keeps the copy", not "zeroed".
 *
 * Weights are used as given; pass normalised weights if you want a convex combination. `dst` may
 * itself be one of `sources` - each component is fully accumulated before it is written back, which
 * is the same guarantee Blender's callbacks make ("delay writing to the destination in case dest is
 * in sources").
 */
export function interpElemAttrs(
    dst: BMElem, sources: readonly BMElem[], weights: readonly number[], layout: BMCustomDataLayout,
): void {
    if (sources.length === 0) return
    if (sources.length !== weights.length) {
        throw new Error(`mesh-kernel: ${sources.length} sources but ${weights.length} weights`)
    }
    ensureBlocks(dst, layout)

    for (const layer of layout.layers) {
        switch (layer.interp) {
        case 'none':
            break

        case 'float':
            for (let c = 0; c < layer.components; c++) {
                let acc = 0
                for (let s = 0; s < sources.length; s++) acc += getComponent(sources[s], layer, c) * weights[s]
                dst.fdata![layer.offset + c] = acc
            }
            break

        case 'int':
            for (let c = 0; c < layer.components; c++) {
                let acc = 0
                for (let s = 0; s < sources.length; s++) acc += getComponent(sources[s], layer, c) * weights[s]
                dst.idata![layer.offset + c] = roundAwayFromZero(acc)
            }
            break

        case 'bool':
            for (let c = 0; c < layer.components; c++) {
                let acc = 0
                for (let s = 0; s < sources.length; s++) {
                    if (getComponent(sources[s], layer, c) !== 0 && weights[s] > 0) acc = 1
                }
                dst.idata![layer.offset + c] = acc
            }
            break

        case 'byteColor':
            for (let c = 0; c < layer.components; c++) {
                let acc = 0
                for (let s = 0; s < sources.length; s++) acc += getComponent(sources[s], layer, c) * weights[s]
                dst.idata![layer.offset + c] = roundToUcharClamp(acc)
            }
            break

        case 'quaternion': {
            // `SimpleMixerWithAccumulationType<Quaternion, float3, quat_to_expmap, expmap_to_quat>`
            // (`blenkernel/BKE_attribute_math.hh:862`): average in expmap space, divide by the total
            // weight, map back. Zero total weight falls back to the mixer's default, the identity.
            const e: [number, number, number] = [0, 0, 0]
            let ax = 0, ay = 0, az = 0, totalWeight = 0
            for (let s = 0; s < sources.length; s++) {
                const w = weights[s]
                quatToExpmap(
                    getComponent(sources[s], layer, 0), getComponent(sources[s], layer, 1),
                    getComponent(sources[s], layer, 2), getComponent(sources[s], layer, 3), e,
                )
                ax += e[0] * w
                ay += e[1] * w
                az += e[2] * w
                totalWeight += w
            }
            const q: [number, number, number, number] = [1, 0, 0, 0]
            if (totalWeight > 0) {
                const inv = 1 / totalWeight
                expmapToQuat(ax * inv, ay * inv, az * inv, q)
            }
            for (let c = 0; c < 4; c++) dst.fdata![layer.offset + c] = q[c]
            break
        }
        }
    }
}

/**
 * Blend two elements evenly. The common case when splitting an edge: the new vertex or corner takes
 * the midpoint of the two it sits between.
 */
export function interpElemAttrsMidpoint(
    dst: BMElem, a: BMElem, b: BMElem, layout: BMCustomDataLayout, t = 0.5,
): void {
    interpElemAttrs(dst, [a, b], [1 - t, t], layout)
}
