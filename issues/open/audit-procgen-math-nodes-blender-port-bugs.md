# procedural-generation math_nodes.ts: Blender Math node port diverges from Blender source (MODULO, PINGPONG, SMOOTH_MIN/MAX, stepped clamp, safe_* domains)

**Severity:** high
**Found:** 2026-06-13 code audit

`plugins/procedural-generation/src/blender/math_nodes.ts` ports Blender's Math /
Map Range nodes. Several ops do not match the Blender C++ source they claim to
port. Per project rules these are Blender ports and must reproduce the Blender
formula exactly. Each sub-section below gives the offending TS, the exact Blender
source location, and a numeric counterexample.

Blender authoritative sources (present at `.repos/blender/source/blender/...`):
- `blenlib/intern/math_base_inline.cc` — `pingpongf` (277), `smoothminf` (330), `fractf` (265)
- `blenlib/intern/math_base_safe_inline.cc` — `safe_modf` (21), `safe_logf` (31), `safe_sqrtf` (39), `safe_inverse_sqrtf` (44), `safe_powf` (61)
- `nodes/shader/nodes/node_shader_map_range.cc` — Map Range clamp default (111: `data->clamp = 1`), stepped formula (262-277)
- `functions/intern/multi_function_common.cc` — registers every Math op by name (~165-363)

---

## H05 — MODULO uses Euclidean (always-positive) modulo; Blender uses fmod (sign of dividend)

### Bug
The MODULO op forces a non-negative result and even documents the wrong
semantics in the inline comment. Blender's MODULO carries the sign of the
dividend.

### Root Cause
```ts
// math_nodes.ts:155
case 'MODULO': return b !== 0 ? ((a % b) + b) % b : 0 // Blender modulo is always positive
```
Blender's Math MODULO is registered as `"float % float"` → `safe_modf`
(`math_base_safe_inline.cc:21`):
```c
return (b != 0.0f) ? fmodf(a, b) : 0.0f;
```
`fmodf` is truncated division — the result takes the **sign of the dividend `a`**,
not always-positive. The "always positive" behavior is FLOORED_MODULO, which the
port already implements separately and correctly on the next line (`:156`).

**Counterexample:** `mod(-5, 3)` → Blender `-2`, TS `+1`; `mod(5, -3)` → Blender `2`, TS `-1`.

### Fix
Port the exact Blender formula. JS native `%` already equals C `fmodf`:
```ts
case 'MODULO': return b !== 0 ? a % b : 0
```
Remove the incorrect comment.

---

## H06 — PINGPONG drops the (value − scale) phase offset

### Bug
The PINGPONG triangle wave is mirrored / phase-shifted because the TS wraps the
value directly instead of `(value − scale)`.

### Root Cause
```ts
// math_nodes.ts:160
case 'PINGPONG': return b !== 0 ? Math.abs(((a % (2 * b)) + 2 * b) % (2 * b) - b) : 0
```
Blender `pingpongf(value, scale)` (`math_base_inline.cc:277`):
```c
return (scale != 0.0f) ? fabsf(fractf((value - scale) / (scale * 2.0f)) * scale * 2.0f - scale) : 0.0f;
```
The crucial term is `fract((value − scale) / (2·scale))` — a phase shift by
`scale` inside the wrap. The TS omits the `(value − scale)` offset and wraps `a`
directly, yielding `|(value mod 2s) − s|` instead of `|((value − s) mod 2s) − s|`.

**Counterexample:** `pingpong(0, 1)` → Blender `0` (trough), TS `1` (peak); `pingpong(3.3, 1)` → Blender `0.7`, TS `0.3`.

### Fix
Port the exact Blender `pingpongf`:
```ts
case 'PINGPONG': {
    if (b === 0) return 0
    const s2 = 2 * b
    const f = (a - b) / s2
    return Math.abs((f - Math.floor(f)) * s2 - b)
}
```

---

## H07 — SMOOTH_MIN / SMOOTH_MAX use a quadratic blend, not Blender's cubic smoothminf

### Bug
`smoothMin` implements the polynomial smooth-min from a different iquilezles
article; Blender uses the cubic smooth-min. Outputs differ for all overlapping
`|a−b| < k`. SMOOTH_MAX derives from the wrong base, so it is wrong too.

### Root Cause
```ts
// math_nodes.ts:148-149
case 'SMOOTH_MIN': return smoothMin(a, b, c)
case 'SMOOTH_MAX': return -smoothMin(-a, -b, c)
...
// math_nodes.ts:177-181
function smoothMin(a: number, b: number, k: number): number {
    if (k <= 0) return Math.min(a, b)
    const h = Math.max(0, Math.min(1, (b - a + k) / (2 * k)))
    return a * h + b * (1 - h) - k * h * (1 - h)
}
```
Blender `smoothminf(a, b, c)` (`math_base_inline.cc:330`):
```c
if (c != 0.0f) {
    float h = max_ff(c - fabsf(a - b), 0.0f) / c;
    return min_ff(a, b) - h * h * h * c * (1.0f / 6.0f);
}
return min_ff(a, b);
```
Different `h` (`max(c − |a−b|, 0)/c` vs `clamp((b−a+k)/2k)`) and a different blend
(`min − h³c/6` vs a lerp). Blender's guard is `c != 0`; the TS guards `k <= 0`.
SMOOTH_MAX `−smoothminf(−a,−b,c)` matches Blender structurally
(`multi_function_common.cc:355`) but inherits the wrong base.

**Counterexample:** `smin(3, 3, 1)` → Blender `2.8333`, TS `2.75`.

### Fix
Replace the `smoothMin` body with the exact Blender `smoothminf` (the negate-trick
for SMOOTH_MAX is correct once the base is fixed):
```ts
function smoothMin(a: number, b: number, c: number): number {
    if (c !== 0) {
        const h = Math.max(c - Math.abs(a - b), 0) / c
        return Math.min(a, b) - h * h * h * c * (1 / 6)
    }
    return Math.min(a, b)
}
```

---

## M13 — mapRangeStepped never clamps, though Blender's Map Range clamps by default

### Bug
`mapRangeStepped` has no clamp parameter and never clamps, so for inputs where the
factor overshoots `[0,1]` it returns values outside `[toMin, toMax]` that Blender
would clamp. The sibling `mapRange` and `mapRangeSmoothstep` both clamp; STEPPED is
the odd one out.

### Root Cause
```ts
// math_nodes.ts:29-34
export function mapRangeStepped(value, fromMin, fromMax, toMin, toMax, steps) {
    if (fromMax === fromMin || steps <= 0) return toMin
    const t = (value - fromMin) / (fromMax - fromMin)
    const stepped = Math.floor(t * (steps + 1)) / steps
    return toMin + stepped * (toMax - toMin)
}
```
Blender's Map Range ships with Clamp ON by default
(`node_shader_map_range.cc:111` `data->clamp = 1`). The STEPPED build clamps the
result to `[to_min, to_max]` when Clamp is on (`build_float_stepped`,
`node_shader_map_range.cc:262-275` → `result = clamp_range(result, to_min, to_max)`).
`clamp_range` swaps the bounds when `to_min > to_max`. The stepped floor formula
itself matches Blender.

### Fix
Add a `clamp = true` parameter (default on, matching Blender) and clamp the result
to `[min(toMin,toMax), max(toMin,toMax)]`. (Note: Blender clamps the *result*, not
the factor — the LINEAR `mapRange` at `:24` clamps the factor to `[0,1]`, which is
subtly off when `toMin > toMax`; align both with Blender's `clamp_range`.)

---

## M14 — mathOp SQRT/POWER/LOGARITHM emit NaN/-Inf where Blender's safe_* return 0

### Bug
Three Math ops use the unsafe JS primitives and emit NaN/-Inf on out-of-domain
inputs that then propagate, where Blender's Math node uses the `safe_*` variants
and produces `0`. INVERSE_SQRT (`:139`) already matches `safe_inverse_sqrtf`, so
the safe-handling was applied inconsistently.

### Root Cause
```ts
// math_nodes.ts:136-138
case 'POWER': return Math.pow(a, b)
case 'LOGARITHM': return b > 0 ? Math.log(a) / Math.log(b) : 0
case 'SQRT': return Math.sqrt(a)
```
Blender's Math node uses `safe_*` (`math_base_safe_inline.cc`):
- SQRT → `safe_sqrtf(a) = sqrtf(max(a, 0))` → `0` for `a < 0`; TS `Math.sqrt(-1)` = NaN.
- POWER → `safe_powf` returns `0` when `base < 0 && exponent != int(exponent)`; TS `Math.pow(-2, 0.5)` = NaN.
- LOGARITHM → `safe_logf` returns `0` when `a <= 0 || base <= 0`; TS guards the base but not `a`, so `log(-1, 2)` = NaN and `log(0, 2)` = -Inf.

(DIVIDE `:134`, ARCSINE/ARCCOSINE `:164-165` already match Blender's safe forms — these three are the outliers.)

### Fix
Port the exact `safe_*` variants:
```ts
case 'POWER': return (a < 0 && b !== Math.trunc(b)) ? 0 : Math.pow(a, b)
case 'LOGARITHM': return (a > 0 && b > 0) ? Math.log(a) / Math.log(b) : 0
case 'SQRT': return Math.sqrt(Math.max(a, 0))
```

---

## LOW — COMPARE uses `<=` without Blender's `max(c, 1e-5)` epsilon floor

### Bug
`COMPARE` compares against the raw tolerance; Blender's GPU/MaterialX form floors
the epsilon at `1e-5`. The boundary case (`|a−b|` exactly `c`, with `c < 1e-5`)
differs. Edge-only; flagged for completeness.

### Root Cause
```ts
// math_nodes.ts:147
case 'COMPARE': return Math.abs(a - b) <= c ? 1 : 0
```
Blender GPU `math_compare` clamps the epsilon: `(abs(a - b) <= max(c, 1e-5)) ? 1 : 0`.

### Fix
Match the GPU form if exact parity is desired: `Math.abs(a - b) <= Math.max(c, 1e-5) ? 1 : 0`.

---

## Impact
`mathOp`, `mapRange*`, `smoothMin` are re-exported from `src/index.ts` and
`src/graph/index.ts` (public API), so any consumer or graph-extraction path that
exercises MODULO / PINGPONG / SMOOTH_MIN / SMOOTH_MAX / stepped Map Range / SQRT /
POWER / LOGARITHM gets results that diverge from Blender ground truth — silently
wrong values (H05/H06/H07/M13) or NaN/-Inf propagation (M14).

## Files
- `plugins/procedural-generation/src/blender/math_nodes.ts:155` — MODULO Euclidean instead of fmod (H05)
- `plugins/procedural-generation/src/blender/math_nodes.ts:160` — PINGPONG drops phase offset (H06)
- `plugins/procedural-generation/src/blender/math_nodes.ts:148-149,177-181` — SMOOTH_MIN/MAX quadratic vs cubic (H07)
- `plugins/procedural-generation/src/blender/math_nodes.ts:29-34` — mapRangeStepped never clamps (M13)
- `plugins/procedural-generation/src/blender/math_nodes.ts:136-138` — SQRT/POWER/LOGARITHM unsafe (M14)
- `plugins/procedural-generation/src/blender/math_nodes.ts:147` — COMPARE epsilon floor (LOW)
