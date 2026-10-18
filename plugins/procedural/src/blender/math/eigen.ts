/**
 * The Eigen paths Blender's `math::invert(float4x4, bool &)` and `math::determinant(float4x4)`
 * (`blenlib/intern/math_matrix.cc:203`, `:131`) take, as built for Blender 5.2.2's reference platform
 * (macOS arm64). Blender 5.2.2 builds Eigen commit 8a1083e9 (`build_files/build_environment/cmake/
 * versions.cmake:1474`); on arm64 Eigen vectorises with NEON and, because `__ARM_FEATURE_FMA` is defined,
 * sets `EIGEN_VECTORIZE_FMA` and `EIGEN_SCALAR_MADD_USE_FMA` (`Core/util/ConfigureVectorization.h:516`,
 * `Core/util/Macros.h:67`), so scalar `pmadd` is `std::fma`.
 *
 * - `determinant_impl<Derived, 4>` (`LU/Determinant.h`): 2x2 minors, then `pmadd` (fused) chains.
 * - `compute_inverse_size4<Architecture::Target, float>` (`LU/arch/InverseSize4.h`): the SIMD block
 *   inverse, lane by lane, with `preciprocal` = FRECPE + two FRECPS Newton steps
 *   (`Core/arch/NEON/PacketMath.h:4500`).
 *
 * x86-64 builds differ (no FMA: separate multiply and add; `preciprocal` is `1 / x`), so Blender's own
 * results for these functions are platform dependent. This port follows arm64, the platform of the
 * ground truth.
 *
 * Licence: this file ports code from Eigen (https://gitlab.com/libeigen/eigen, commit 8a1083e9), which is
 * MPL-2.0. See issues/open/modelling-tools/procedural-eigen-port-licence.md.
 */

import {f32} from '../f32'

const f32buf = new Float32Array(1)
const u32buf = new Uint32Array(f32buf.buffer)

function bitsOf(x: number): number {
    f32buf[0] = x
    return u32buf[0]
}

function fromBits(b: number): number {
    u32buf[0] = b >>> 0
    return f32buf[0]
}

/** The float32 adjacent to `x` (a finite float32) towards +inf (`up`) or -inf. */
function nextFloat(x: number, up: boolean): number {
    if (x === 0) return up ? fromBits(1) : fromBits(0x80000001)
    const b = bitsOf(x)
    const positive = (b >>> 31) === 0
    return fromBits(positive === up ? b + 1 : b - 1)
}

/**
 * `fmaf(a, b, c)` for float32 operands: `a * b + c` rounded once. The product is exact in double
 * (24 + 24 significant bits); the sum is split exactly into `s + err` (TwoSum), and `s` rounded to
 * float32 is only wrong when `s` is exactly halfway between two floats, where `err` decides.
 */
export function fmaf(a: number, b: number, c: number): number {
    const p = a * b
    const s = p + c
    const bb = s - p
    const err = (p - (s - bb)) + (c - bb)
    const r = f32(s)
    if (err === 0 || r === s || !Number.isFinite(s)) return r
    const other = nextFloat(r, s > r)
    if (Math.abs(s - r) !== Math.abs(other - s)) return r
    // A tie for `s` alone: the exact value lies on the side of `err`.
    return err > 0 ? Math.max(r, other) : Math.min(r, other)
}

/**
 * FRECPE for a float32 (Arm ARM `FPRecipEstimate` / `RecipEstimate`, FPCR.FZ = 0, FPCR.AH = 0): an
 * 8-bit reciprocal estimate.
 */
export function frecpe(x: number): number {
    if (Number.isNaN(x)) return NaN
    const bits = bitsOf(x)
    const sign = bits >>> 31
    if (x === 0) return sign ? -Infinity : Infinity
    if (!Number.isFinite(x)) return sign ? -0 : 0
    // |x| < 2^-128: overflow, round-to-nearest gives infinity.
    if (Math.abs(x) < 2 ** -128) return sign ? -Infinity : Infinity
    let exp = (bits >>> 23) & 0xff
    // `fraction = operand<22:0> : Zeros(29)` as a 23-bit field here (bit 22 = fraction<51>).
    let fraction = bits & 0x7fffff
    if (exp === 0) {
        if ((fraction & 0x400000) === 0) {
            exp = -1
            fraction = (fraction << 2) & 0x7fffff
        } else {
            fraction = (fraction << 1) & 0x7fffff
        }
    }
    const scaled = 256 | (fraction >>> 15)
    let resultExp = 253 - exp
    // RecipEstimate: round-to-nearest fixed-point reciprocal.
    const a = scaled * 2 + 1
    const est = Math.floor((Math.floor(2 ** 19 / a) + 1) / 2)
    let frac = (est & 0xff) << 15
    if (resultExp === 0) {
        frac = (1 << 22) | (frac >>> 1)
    } else if (resultExp === -1) {
        frac = (1 << 21) | (frac >>> 2)
        resultExp = 0
    }
    return fromBits((sign << 31) | ((resultExp & 0xff) << 23) | frac)
}

/** FRECPS (`FPRecipStepFused`): `2 - a * b` rounded once; 2 for infinity times zero. */
export function frecps(a: number, b: number): number {
    if ((!Number.isFinite(a) && b === 0) || (a === 0 && !Number.isFinite(b))) {
        if (!Number.isNaN(a) && !Number.isNaN(b)) return 2
    }
    return fmaf(-a, b, 2)
}

/** Eigen `preciprocal<Packet4f>` on NEON: estimate, then two Newton-Raphson steps. */
export function neonReciprocal(x: number): number {
    let r = frecpe(x)
    r = f32(frecps(x, r) * r)
    r = f32(frecps(x, r) * r)
    return r
}

/** `determinant_impl<Derived, 4>::run` (`Eigen/src/LU/Determinant.h`), `m` column major (`m(r, c) = m[c * 4 + r]`). */
export function eigenDeterminant4(m: ArrayLike<number>): number {
    const at = (r: number, c: number) => m[c * 4 + r]
    const det2 = (i0: number, i1: number) => f32(f32(at(i0, 0) * at(i1, 1)) - f32(at(i1, 0) * at(i0, 1)))
    const det3 = (i0: number, d0: number, i1: number, d1: number, i2: number, d2: number) =>
        fmaf(at(i0, 2), d0, fmaf(-at(i1, 2), d1, f32(at(i2, 2) * d2)))
    const d01 = det2(0, 1), d02 = det2(0, 2), d03 = det2(0, 3)
    const d12 = det2(1, 2), d13 = det2(1, 3), d23 = det2(2, 3)
    const d30 = det3(1, d23, 2, d13, 3, d12)
    const d31 = det3(0, d23, 2, d03, 3, d02)
    const d32 = det3(0, d13, 1, d03, 3, d01)
    const d33 = det3(0, d12, 1, d02, 2, d01)
    return f32(fmaf(-at(0, 3), d30, f32(at(1, 3) * d31)) + fmaf(-at(2, 3), d32, f32(at(3, 3) * d33)))
}

type P4 = [number, number, number, number]
const pmul = (a: P4, b: P4): P4 => [f32(a[0] * b[0]), f32(a[1] * b[1]), f32(a[2] * b[2]), f32(a[3] * b[3])]
const padd = (a: P4, b: P4): P4 => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2]), f32(a[3] + b[3])]
const psub = (a: P4, b: P4): P4 => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2]), f32(a[3] - b[3])]
/** `vec4f_swizzle2(a, b, p, q, r, s)` = `[a[p], a[q], b[r], b[s]]`. */
const sw = (a: P4, b: P4, p: number, q: number, r: number, s: number): P4 => [a[p], a[q], b[r], b[s]]
/** `vec4f_movelh(a, b)` = `[a0, a1, b0, b1]`; `vec4f_movehl(a, b)` = `[b2, b3, a2, a3]`. */
const movelh = (a: P4, b: P4): P4 => [a[0], a[1], b[0], b[1]]
const movehl = (a: P4, b: P4): P4 => [b[2], b[3], a[2], a[3]]
const duplane = (a: P4, p: number): P4 => [a[p], a[p], a[p], a[p]]

/**
 * `compute_inverse_size4<Architecture::Target, float, ...>::run` (`Eigen/src/LU/arch/InverseSize4.h`) for a
 * column-major matrix (storage orders match), NEON flavour. `m` and the result are column major.
 */
export function eigenInverse4Simd(m: ArrayLike<number>): Float32Array {
    const L1: P4 = [m[0], m[1], m[2], m[3]]
    const L2: P4 = [m[4], m[5], m[6], m[7]]
    const L3: P4 = [m[8], m[9], m[10], m[11]]
    const L4: P4 = [m[12], m[13], m[14], m[15]]
    const A = movelh(L1, L2), B = movehl(L2, L1), C = movelh(L3, L4), D = movehl(L4, L3)

    let AB = pmul(sw(A, A, 3, 3, 0, 0), B)
    AB = psub(AB, pmul(sw(A, A, 1, 1, 2, 2), sw(B, B, 2, 3, 0, 1)))
    let DC = pmul(sw(D, D, 3, 3, 0, 0), C)
    DC = psub(DC, pmul(sw(D, D, 1, 1, 2, 2), sw(C, C, 2, 3, 0, 1)))

    const subDet = (X: P4): P4 => {
        const t = pmul(sw(X, X, 3, 3, 1, 1), X)
        return psub(t, movehl(t, t))
    }
    const dA = subDet(A), dB = subDet(B), dC = subDet(C), dD = subDet(D)

    let d = pmul(sw(DC, DC, 0, 2, 1, 3), AB)
    d = padd(d, movehl(d, d))
    d = padd(d, sw(d, d, 1, 0, 0, 0))
    const d1 = pmul(dA, dD)
    const d2 = pmul(dB, dC)
    const det = duplane(psub(padd(d1, d2), d), 0)
    const r = neonReciprocal(det[0])
    // `pxor(rd, {0, -0, -0, 0})`: lanes 1 and 2 negated.
    const rd: P4 = [r, -r, -r, r]

    let iD = pmul(sw(C, C, 0, 0, 2, 2), movelh(AB, AB))
    iD = padd(iD, pmul(sw(C, C, 1, 1, 3, 3), movehl(AB, AB)))
    iD = psub(pmul(D, duplane(dA, 0)), iD)

    let iA = pmul(sw(B, B, 0, 0, 2, 2), movelh(DC, DC))
    iA = padd(iA, pmul(sw(B, B, 1, 1, 3, 3), movehl(DC, DC)))
    iA = psub(pmul(A, duplane(dD, 0)), iA)

    let iB = pmul(D, sw(AB, AB, 3, 0, 3, 0))
    iB = psub(iB, pmul(sw(D, D, 1, 0, 3, 2), sw(AB, AB, 2, 1, 2, 1)))
    iB = psub(pmul(C, duplane(dB, 0)), iB)

    let iC = pmul(A, sw(DC, DC, 3, 0, 3, 0))
    iC = psub(iC, pmul(sw(A, A, 1, 0, 3, 2), sw(DC, DC, 2, 1, 2, 1)))
    iC = psub(pmul(B, duplane(dC, 0)), iC)

    iA = pmul(iA, rd)
    iB = pmul(iB, rd)
    iC = pmul(iC, rd)
    iD = pmul(iD, rd)

    const out = new Float32Array(16)
    out.set(sw(iA, iB, 3, 1, 3, 1), 0)
    out.set(sw(iA, iB, 2, 0, 2, 0), 4)
    out.set(sw(iC, iD, 3, 1, 3, 1), 8)
    out.set(sw(iC, iD, 2, 0, 2, 0), 12)
    return out
}

/**
 * `math::invert(const float4x4 &, bool &r_success)` (`blenlib/intern/math_matrix.cc:203`):
 * `computeInverseWithCheck(R, r_success, 0.0f)` - the Eigen determinant decides invertibility
 * (`|det| > 0`, `LU/InverseImpl.h:209`), the SIMD inverse computes the result; zeros when not invertible.
 */
export function invertMat4(m: ArrayLike<number>): {m: Float32Array, success: boolean} {
    const det = eigenDeterminant4(m)
    const success = Math.abs(det) > 0
    return {m: success ? eigenInverse4Simd(m) : new Float32Array(16), success}
}
