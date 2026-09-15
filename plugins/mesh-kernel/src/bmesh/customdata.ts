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

import {ATTR_TYPE_INFO, AttrType} from '../constants'
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
    /**
     * Whether a value of this layer is meaningful to blend. Positions and UVs interpolate;
     * material indices and flags do not, and take the value of the dominant source instead.
     */
    readonly interpolates: boolean
}

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

function interpolatesFor(type: AttrType): boolean {
    // Integer-valued layers are categorical: blending a material index produces a meaningless slot.
    return storageFor(type) === 'float'
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

        const def: BMLayerDef = {name, type, components, offset, storage, interpolates: interpolatesFor(type)}
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
 * Blend `sources` into `dst` with the given weights, for every interpolating layer.
 *
 * Port of the weighted path in `bmesh_interp.cc` (`BM_data_interp_from_verts`,
 * `BM_data_interp_face_vert_col` and friends all reduce to this). Non-interpolating layers take the
 * value of the highest-weighted source, which is what Blender's `CustomData_interp` does for
 * categorical layers rather than averaging them into nonsense.
 *
 * Weights are used as given; pass normalised weights if you want a convex combination.
 */
export function interpElemAttrs(
    dst: BMElem, sources: readonly BMElem[], weights: readonly number[], layout: BMCustomDataLayout,
): void {
    if (sources.length === 0) return
    if (sources.length !== weights.length) {
        throw new Error(`mesh-kernel: ${sources.length} sources but ${weights.length} weights`)
    }
    ensureBlocks(dst, layout)

    let dominant = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[dominant]) dominant = i

    for (const layer of layout.layers) {
        if (!layer.interpolates) {
            // Categorical: take the dominant source verbatim.
            const src = sources[dominant]
            for (let c = 0; c < layer.components; c++) {
                const i = layer.offset + c
                const v = getComponent(src, layer, c)
                if (layer.storage === 'float') dst.fdata![i] = v
                else dst.idata![i] = v
            }
            continue
        }
        for (let c = 0; c < layer.components; c++) {
            let acc = 0
            for (let s = 0; s < sources.length; s++) acc += getComponent(sources[s], layer, c) * weights[s]
            dst.fdata![layer.offset + c] = acc
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
