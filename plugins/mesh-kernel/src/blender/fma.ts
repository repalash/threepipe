/**
 * Fused multiply-add on float32 operands, as an arm64 `fmadd s` instruction (C `fmaf`) computes it: `a * b + c`
 * rounded once to float32.
 *
 * Needed where Blender links code that its dependency build compiled with Apple clang's default
 * `-ffp-contract=on` (OpenSubdiv: `issues/open/modelling-tools/15b-opensubdiv-port.md`), where clang turns
 * `a * b + c` inside one expression into `llvm.fmuladd`, which arm64 emits as one fused instruction.
 *
 * The product of two float32 values is exact in double (24 + 24 significant bits); the sum `p + c` is split exactly
 * into `s + err` (TwoSum). Rounding `s` to float32 gives the correctly rounded result unless `s` lies exactly halfway
 * between two float32 values, where the sign of `err` decides.
 */

import {f32} from './f32'

const buf = new Float32Array(1)
const bits = new Uint32Array(buf.buffer)

/** The float32 next to the finite float32 `x`, towards `+inf` when `up`. */
function nextFloat32(x: number, up: boolean): number {
    if (x === 0) {
        bits[0] = up ? 1 : 0x80000001
        return buf[0]
    }
    buf[0] = x
    const positive = (bits[0] >>> 31) === 0
    bits[0] = positive === up ? bits[0] + 1 : bits[0] - 1
    return buf[0]
}

/** `fmaf(a, b, c)` for float32 `a`, `b`, `c`. */
export function fmaf(a: number, b: number, c: number): number {
    const p = a * b
    const s = p + c
    const bb = s - p
    const err = (p - (s - bb)) + (c - bb)
    const r = f32(s)
    if (err === 0 || r === s || !Number.isFinite(s)) return r
    const other = nextFloat32(r, s > r)
    if (Math.abs(s - r) !== Math.abs(other - s)) return r
    return err > 0 ? Math.max(r, other) : Math.min(r, other)
}
