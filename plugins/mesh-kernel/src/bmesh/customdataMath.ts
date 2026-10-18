/**
 * The "math" callbacks of Blender's custom-data layer types, for the loop layers that have them:
 * `CustomData_layer_has_math`, `CustomData_data_equals`, `_initminmax`, `_dominmax`, `_multiply`, `_add`
 * and `_copy_value` (`blenkernel/intern/customdata.cc:3827`, `:3886`-`:3968`) with the per-type
 * callbacks they dispatch to: `CD_PROP_FLOAT2` (`layer*_propfloat2`), `CD_PROP_COLOR`
 * (`layer*_propcol`) and `CD_PROP_BYTE_COLOR` (`layer*_mloopcol`). The kernel's `float2`, `float4` and
 * `byteColor` layers are those three; it has no `CD_MLOOP_ORIGSPACE`, the fourth type with math.
 *
 * Values are a layer's components as numbers. Float layers are float32 in Blender and in the kernel's
 * blocks; byte colours are `uchar`, so multiply truncates and add wraps, as the C does.
 */

import type {BMLayerDef} from './customdata'

const FLT_MAX = 3.4028234663852886e38
const FLT_MIN = 1.1754943508222875e-38

/** `CustomData_layer_has_math` (`customdata.cc:3827`): the type declares equal, add, multiply, initminmax, dominmax. */
export function layerHasMath(layer: BMLayerDef): boolean {
    return layer.type === 'float2' || layer.type === 'float4' || layer.type === 'byteColor'
}

/**
 * `CustomData_data_equals` for the math layers: `layerEqual_propfloat2` (squared distance under
 * 0.00001), `layerEqual_propcol` and `layerEqual_mloopcol` (under 0.001), all in float32.
 */
export function layerDataEquals(layer: BMLayerDef, a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    let tot = 0
    for (let i = 0; i < layer.components; i++) {
        const d = Math.fround(a[i] - b[i])
        tot = Math.fround(tot + Math.fround(d * d))
    }
    return tot < Math.fround(layer.type === 'float2' ? 0.00001 : 0.001)
}

/**
 * `CustomData_data_initminmax`: `INIT_MINMAX2` for float2, `FLT_MAX` / `FLT_MIN` for a float colour
 * (sic: `layerInitMinMax_propcol` starts the max at the smallest *positive* float), 255 / 0 for a byte
 * colour.
 */
export function layerInitMinMax(layer: BMLayerDef): {min: number[], max: number[]} {
    const n = layer.components
    if (layer.type === 'byteColor') return {min: new Array(n).fill(255), max: new Array(n).fill(0)}
    if (layer.type === 'float4') return {min: new Array(n).fill(FLT_MAX), max: new Array(n).fill(FLT_MIN)}
    return {min: new Array(n).fill(FLT_MAX), max: new Array(n).fill(-FLT_MAX)}
}

/** `CustomData_data_dominmax`: per-component min and max. */
export function layerDoMinMax(layer: BMLayerDef, v: ArrayLike<number>, min: number[], max: number[]): void {
    for (let i = 0; i < layer.components; i++) {
        if (v[i] < min[i]) min[i] = v[i]
        if (v[i] > max[i]) max[i] = v[i]
    }
}

/** `CustomData_data_multiply`: `uchar = float(uchar) * fac` truncates for a byte colour. */
export function layerMultiply(layer: BMLayerDef, v: number[], fac: number): void {
    for (let i = 0; i < layer.components; i++) {
        v[i] = layer.type === 'byteColor' ? Math.trunc(Math.fround(v[i] * fac)) & 0xff : Math.fround(v[i] * fac)
    }
}

/** `CustomData_data_add`: `a += b`; a byte colour wraps. */
export function layerAdd(layer: BMLayerDef, a: number[], b: ArrayLike<number>): void {
    for (let i = 0; i < layer.components; i++) {
        a[i] = layer.type === 'byteColor' ? (a[i] + b[i]) & 0xff : Math.fround(a[i] + b[i])
    }
}

/** `min * 0.5 + max * 0.5`, the midpoint every math-layer "collapse" snaps to (`bmo_removedoubles.cc:445`, `:637`). */
export function layerMidpoint(layer: BMLayerDef, min: number[], max: number[]): number[] {
    const a = [...min]
    const b = [...max]
    layerMultiply(layer, a, 0.5)
    layerMultiply(layer, b, 0.5)
    layerAdd(layer, a, b)
    return a
}
