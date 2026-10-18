/**
 * Attribute mixers - port of `blenkernel/BKE_attribute_math.hh:536-880` and
 * `blenkernel/intern/attribute_math.cc` (`ColorGeometry4fMixer`, `ColorGeometry4bMixer`,
 * `float4x4Mixer`).
 *
 * A mixer accumulates weighted values per output element and turns them into averages on
 * `finalize()`. Which mixer a type gets is `DefaultMixerStruct` (`BKE_attribute_math.hh:794`), or
 * `DefaultPropagationMixerStruct` (`:858`), which differs only for booleans ("or" instead of
 * "at least half").
 */

import {f32, roundHalfAway, floatToUint8} from '../blender/f32'
import {quatFromExpmap, quatToExpmap} from '../blender/math/quaternion'
import {interpolateMat4} from '../blender/math/matrixInterpolate'
import {quatInterpolate} from '../blender/math/rotation'
import {mat4FromLocQuatScale, mat4ToLocQuatScaleSafe} from '../blender/math/matrix'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'

export interface Mixer {
    /** `set(index, value, weight)`: value is `src[srcIndex * components ...]`. */
    set(index: number, src: ArrayLike<number>, srcIndex: number, weight?: number): void
    /** `mix_in(index, value, weight)`. */
    mixIn(index: number, src: ArrayLike<number>, srcIndex: number, weight?: number): void
    /** Must be called before the buffer is read. */
    finalize(): void
}

/**
 * `SimpleMixer<T>` for float, float2, float3 (`BKE_attribute_math.hh:536`): accumulates in the output
 * buffer itself, in float. Also `ColorGeometry4fMixer` (`attribute_math.cc:80-125`), which is the same
 * arithmetic with a default colour of (0, 0, 0, 1) for untouched elements.
 */
class SimpleFloatMixer implements Mixer {
    private readonly weights: Float32Array
    constructor(private readonly buffer: Float32Array, private readonly c: number, private readonly defaultValue: readonly number[]) {
        this.weights = new Float32Array(buffer.length / c)
        // SimpleMixer fills `default_value_` (zero), ColorGeometry4fMixer fills zero too; the default
        // colour is only written for elements nothing was mixed into.
        buffer.fill(0)
    }

    set(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        const c = this.c
        for (let k = 0; k < c; k++) this.buffer[i * c + k] = f32(src[s * c + k] * w)
        this.weights[i] = w
    }

    mixIn(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        const c = this.c
        for (let k = 0; k < c; k++) this.buffer[i * c + k] = f32(this.buffer[i * c + k] + f32(src[s * c + k] * w))
        this.weights[i] = f32(this.weights[i] + w)
    }

    finalize(): void {
        const c = this.c
        for (let i = 0; i < this.weights.length; i++) {
            const w = this.weights[i]
            if (w > 0) {
                const inv = f32(1 / w)
                for (let k = 0; k < c; k++) this.buffer[i * c + k] = f32(this.buffer[i * c + k] * inv)
            } else {
                for (let k = 0; k < c; k++) this.buffer[i * c + k] = this.defaultValue[k]
            }
        }
    }
}

/**
 * `SimpleMixerWithAccumulationType<T, AccumT, to, from>` (`BKE_attribute_math.hh:664`) for the integer,
 * boolean and quaternion types. `accumDouble` selects `double` accumulation (int, int2) over `float`
 * (int8, short2, bool, quaternion's expmap).
 */
class AccumulatingMixer implements Mixer {
    private readonly accum: Float64Array
    private readonly weights: Float32Array
    constructor(
        private readonly buffer: TypedArray,
        private readonly c: number,
        private readonly ac: number,
        private readonly accumDouble: boolean,
        private readonly toAccum: (src: ArrayLike<number>, s: number, out: number[]) => void,
        private readonly fromAccum: (acc: number[], out: TypedArray, i: number) => void,
        private readonly defaultValue: readonly number[],
    ) {
        const n = buffer.length / c
        this.accum = new Float64Array(n * ac)
        this.weights = new Float32Array(n)
        for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) buffer[i * c + k] = defaultValue[k]
    }

    private readonly tmp: number[] = []

    private round(x: number): number {
        return this.accumDouble ? x : f32(x)
    }

    set(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        this.toAccum(src, s, this.tmp)
        for (let k = 0; k < this.ac; k++) this.accum[i * this.ac + k] = this.round(this.tmp[k] * w)
        this.weights[i] = w
    }

    mixIn(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        this.toAccum(src, s, this.tmp)
        for (let k = 0; k < this.ac; k++) {
            const j = i * this.ac + k
            this.accum[j] = this.round(this.accum[j] + this.round(this.tmp[k] * w))
        }
        this.weights[i] = f32(this.weights[i] + w)
    }

    finalize(): void {
        const n = this.weights.length
        const acc: number[] = new Array(this.ac)
        for (let i = 0; i < n; i++) {
            const w = this.weights[i]
            if (w > 0) {
                const inv = f32(1 / w)
                for (let k = 0; k < this.ac; k++) acc[k] = this.round(this.accum[i * this.ac + k] * inv)
                this.fromAccum(acc, this.buffer, i)
            } else {
                for (let k = 0; k < this.c; k++) this.buffer[i * this.c + k] = this.defaultValue[k]
            }
        }
    }
}

/** `ColorGeometry4bMixer` (`attribute_math.cc:127-205`): float4 accumulation, truncating back to bytes. */
class ByteColorMixer implements Mixer {
    private readonly accum: Float32Array
    private readonly weights: Float32Array
    constructor(private readonly buffer: Uint8Array, private readonly defaultColor = [0, 0, 0, 255]) {
        const n = buffer.length / 4
        this.accum = new Float32Array(n * 4)
        this.weights = new Float32Array(n)
        buffer.fill(0)
    }

    set(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        for (let k = 0; k < 4; k++) this.accum[i * 4 + k] = f32(src[s * 4 + k] * w)
        this.weights[i] = w
    }

    mixIn(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        for (let k = 0; k < 4; k++) this.accum[i * 4 + k] = f32(this.accum[i * 4 + k] + f32(src[s * 4 + k] * w))
        this.weights[i] = f32(this.weights[i] + w)
    }

    finalize(): void {
        for (let i = 0; i < this.weights.length; i++) {
            const w = this.weights[i]
            if (w > 0) {
                const inv = f32(1 / w)
                for (let k = 0; k < 4; k++) this.buffer[i * 4 + k] = floatToUint8(f32(this.accum[i * 4 + k] * inv))
            } else {
                for (let k = 0; k < 4; k++) this.buffer[i * 4 + k] = this.defaultColor[k]
            }
        }
    }
}

/** `float4x4Mixer` (`attribute_math.cc:207-260`): location, rotation expmap and scale averaged separately. */
class Float4x4Mixer implements Mixer {
    private readonly loc: Float32Array
    private readonly exp: Float32Array
    private readonly scale: Float32Array
    private readonly weights: Float32Array
    constructor(private readonly buffer: Float32Array) {
        const n = buffer.length / 16
        this.loc = new Float32Array(n * 3)
        this.exp = new Float32Array(n * 3)
        this.scale = new Float32Array(n * 3)
        this.weights = new Float32Array(n)
    }

    private decompose(src: ArrayLike<number>, s: number) {
        const m = new Float32Array(16)
        for (let k = 0; k < 16; k++) m[k] = src[s * 16 + k]
        const {loc, rot, scale} = mat4ToLocQuatScaleSafe(m, true)
        return {loc, exp: quatToExpmap(rot), scale}
    }

    set(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        // `set` uses `to_quaternion(value).expmap()` and `to_scale(value)` directly, not the safe
        // decomposition (`attribute_math.cc:221-226`); for the matrices GN builds the two agree, and
        // nothing in Blender's GN code calls `float4x4Mixer::set`.
        const {loc, exp, scale} = this.decompose(src, s)
        for (let k = 0; k < 3; k++) {
            this.loc[i * 3 + k] = f32(loc[k] * w)
            this.exp[i * 3 + k] = f32(exp[k] * w)
            this.scale[i * 3 + k] = f32(scale[k] * w)
        }
        this.weights[i] = w
    }

    mixIn(i: number, src: ArrayLike<number>, s: number, w = 1): void {
        const {loc, exp, scale} = this.decompose(src, s)
        for (let k = 0; k < 3; k++) {
            this.loc[i * 3 + k] = f32(this.loc[i * 3 + k] + f32(loc[k] * w))
            this.exp[i * 3 + k] = f32(this.exp[i * 3 + k] + f32(exp[k] * w))
            this.scale[i * 3 + k] = f32(this.scale[i * 3 + k] + f32(scale[k] * w))
        }
        this.weights[i] = f32(this.weights[i] + w)
    }

    finalize(): void {
        for (let i = 0; i < this.weights.length; i++) {
            const w = this.weights[i]
            const out = this.buffer.subarray(i * 16, i * 16 + 16)
            if (w > 0) {
                const inv = f32(1 / w)
                const l = [0, 1, 2].map(k => f32(this.loc[i * 3 + k] * inv))
                const e = [0, 1, 2].map(k => f32(this.exp[i * 3 + k] * inv))
                const sc = [0, 1, 2].map(k => f32(this.scale[i * 3 + k] * inv))
                mat4FromLocQuatScale(l, quatFromExpmap(e), sc, out)
            } else {
                out.fill(0)
                out[0] = out[5] = out[10] = out[15] = 1
            }
        }
    }
}

/** `BooleanPropagationMixer` (`BKE_attribute_math.hh:611`): logical or. */
class BooleanPropagationMixer implements Mixer {
    constructor(private readonly buffer: Uint8Array) {
        buffer.fill(0)
    }

    set(i: number, src: ArrayLike<number>, s: number): void {
        this.buffer[i] = src[s] ? 1 : 0
    }

    mixIn(i: number, src: ArrayLike<number>, s: number): void {
        if (src[s]) this.buffer[i] = 1
    }

    finalize(): void {}
}

const copyComponents = (c: number) => (src: ArrayLike<number>, s: number, out: number[]) => {
    for (let k = 0; k < c; k++) out[k] = src[s * c + k]
}
const roundComponents = (c: number) => (acc: number[], out: TypedArray, i: number) => {
    for (let k = 0; k < c; k++) out[i * c + k] = roundHalfAway(acc[k])
}

/**
 * `attribute_math::DefaultMixer<T>` over `buffer` (`size * components` values). The buffer's previous
 * contents are overwritten; elements nothing is mixed into get the mixer's default value.
 */
export function createDefaultMixer(type: DataType, buffer: TypedArray): Mixer {
    const c = DATA_TYPES[type].components
    switch (type) {
    case 'float':
    case 'float2':
    case 'float3':
        return new SimpleFloatMixer(buffer as Float32Array, c, DATA_TYPES[type].defaultValue)
    case 'float4':
        return new SimpleFloatMixer(buffer as Float32Array, 4, [0, 0, 0, 1])
    case 'byteColor':
        return new ByteColorMixer(buffer as Uint8Array)
    case 'float4x4':
        return new Float4x4Mixer(buffer as Float32Array)
    case 'int32':
        // `int_to_double` / `double_to_int` = `int(std::round(value))` (`BKE_attribute_math.hh:325-332`).
        return new AccumulatingMixer(buffer, 1, 1, true, copyComponents(1), roundComponents(1), [0])
    case 'int32x2':
        return new AccumulatingMixer(buffer, 2, 2, true, copyComponents(2), roundComponents(2), [0, 0])
    case 'int8':
        return new AccumulatingMixer(buffer, 1, 1, false, copyComponents(1), roundComponents(1), [0])
    case 'int16x2':
        return new AccumulatingMixer(buffer, 2, 2, false, copyComponents(2), roundComponents(2), [0, 0])
    case 'bool':
        // `bool_to_float` / `float_to_bool` = `value >= 0.5f` (`BKE_attribute_math.hh:841-853`).
        return new AccumulatingMixer(buffer, 1, 1, false,
            (src, s, out) => {
                out[0] = src[s] ? 1 : 0
            },
            (acc, out, i) => {
                out[i] = acc[0] >= 0.5 ? 1 : 0
            }, [0])
    case 'quaternion':
        // `quat_to_expmap` / `expmap_to_quat` (`BKE_attribute_math.hh:367-374`).
        return new AccumulatingMixer(buffer, 4, 3, false,
            (src, s, out) => {
                const e = quatToExpmap([src[s * 4], src[s * 4 + 1], src[s * 4 + 2], src[s * 4 + 3]])
                out[0] = e[0]
                out[1] = e[1]
                out[2] = e[2]
            },
            (acc, out, i) => {
                const q = quatFromExpmap(acc)
                for (let k = 0; k < 4; k++) out[i * 4 + k] = q[k]
            },
            // `SimpleMixerWithAccumulationType(buffer, T default_value = {})` (`BKE_attribute_math.hh:677`):
            // `math::Quaternion{}` value-initialises its defaulted constructor (`BLI_math_quaternion_types.hh:39`)
            // to (0, 0, 0, 0), not the identity `CPPType::default_value` uses.
            [0, 0, 0, 0])
    default:
        throw new Error(`attribute mixer: no default mixer for type '${type as string}'`)
    }
}

/** `attribute_math::DefaultPropagationMixer<T>` (`BKE_attribute_math.hh:858`). */
export function createPropagationMixer(type: DataType, buffer: TypedArray): Mixer {
    if (type === 'bool') return new BooleanPropagationMixer(buffer as Uint8Array)
    return createDefaultMixer(type, buffer)
}

/**
 * `attribute_math::mix2(factor, a, b)` (`BKE_attribute_math.hh:64-121`, `attribute_math.cc:17-55`) on
 * element `ia` of `a` and `ib` of `b`, written to element `io` of `out`.
 */
export function mix2(type: DataType, factor: number, a: ArrayLike<number>, ia: number, b: ArrayLike<number>, ib: number, out: TypedArray, io: number): void {
    const c = DATA_TYPES[type].components
    const t = f32(factor)
    const omt = f32(1 - t)
    switch (type) {
    case 'bool':
        out[io] = f32(f32(omt * (a[ia] ? 1 : 0)) + f32(t * (b[ib] ? 1 : 0))) >= 0.5 ? 1 : 0
        return
    case 'int8':
    case 'int32':
        out[io] = roundHalfAway(f32(f32(omt * a[ia]) + f32(t * b[ib])))
        return
    case 'int16x2':
    case 'int32x2':
        // `math::interpolate(VecBase)` (`BLI_math_vector.hh:631`): `a * (1 - t) + b * t`, where
        // `VecBase<int> * float` stores each product back into an int component (truncation,
        // `BLI_math_vector_types.hh:473`) before the integer add.
        for (let k = 0; k < c; k++) out[io * c + k] = Math.trunc(a[ia * c + k] * omt) + Math.trunc(b[ib * c + k] * t)
        return
    case 'float':
    case 'float2':
    case 'float3':
    case 'float4':
        for (let k = 0; k < c; k++) out[io * c + k] = f32(f32(a[ia * c + k] * omt) + f32(b[ib * c + k] * t))
        return
    case 'byteColor':
        // `math::interpolate(ColorSceneLinearByteEncoded4b)` (`BLI_math_color.hh:29`) interpolates each
        // `uint8_t` channel with the scalar `interpolate` (`BLI_math_base.hh:274`), which rounds for
        // integral types.
        for (let k = 0; k < c; k++) out[io * c + k] = roundHalfAway(f32(f32(a[ia * c + k] * omt) + f32(b[ib * c + k] * t)))
        return
    case 'quaternion': {
        // `mix2(factor, Quaternion, Quaternion)` (`attribute_math.cc:18`): `math::interpolate(a, b, factor)`.
        const q = quatInterpolate([a[ia * 4], a[ia * 4 + 1], a[ia * 4 + 2], a[ia * 4 + 3]], [b[ib * 4], b[ib * 4 + 1], b[ib * 4 + 2], b[ib * 4 + 3]], t)
        for (let k = 0; k < 4; k++) out[io * 4 + k] = q[k]
        return
    }
    case 'float4x4': {
        // `mix2(factor, float4x4, float4x4)` (`attribute_math.cc:45`): `math::interpolate(a, b, factor)`, the polar
        // decomposition interpolation (`math_matrix.cc:380`).
        const m = interpolateMat4(Array.prototype.slice.call(a, ia * 16, ia * 16 + 16), Array.prototype.slice.call(b, ib * 16, ib * 16 + 16), t)
        for (let k = 0; k < 16; k++) out[io * 16 + k] = m[k]
        return
    }
    default:
        throw new Error(`attribute_math::mix2 for '${type}' is not ported`)
    }
}
