# procedural-generation Distribute.ts: alongCurve off-by-one, random density couples RNG to positions, transform corrupts normals, onGrid drops jitter

**Severity:** medium
**Found:** 2026-06-13 code audit

Four bugs in `plugins/procedural-generation/src/points/Distribute.ts`. M16 and M17
are medium; the transform-normal and onGrid-jitter items are low (latent / silent
parameter drop).

---

## M16 — alongCurve produces count+1 points when `count` is specified

### Bug
`count` is documented as "Exact number of points" but the loop runs
`pointCount + 1` iterations, so requesting `count: N` yields `N + 1` points (and
`2*(N+1)` for `side: 'both'`).

### Root Cause
```ts
// Distribute.ts:417
pointCount = Math.max(1, Math.floor(options.count))
// Distribute.ts:428
for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount
    ...
}
```
The `<=` yields `pointCount + 1` iterations. With `count: 10` → `i = 0..10` = 11
points, contradicting the `count` doc at `:390-391`. The `<=` is correct for the
spacing branch (`:419`) where endpoints at `t=0` and `t=1` are wanted, but it is
wrong for the explicit-`count` contract; both paths share the same loop.

### Fix
Branch the loop bound: use `< pointCount` (open) for the count path and
`<= pointCount` (closed) for spacing — or decrement `pointCount` by 1 in the count
branch. Mind the `Math.max(1, ...)`: with the closed loop `count: 1` currently
yields 2 points.

---

## M17 — onFaces 'random' couples the spatial RNG to the density field; the poisson sibling deliberately decouples

### Bug
In `_sampleRandom`, the density-rejection draw is pulled from the **same** `rng`
that the spatial sampler uses, interleaved per iteration. So supplying or changing
`densityField` consumes an extra `rng.next()` per iteration and shifts every
subsequent point's *position* — even a `densityField` returning `1.0` everywhere
(which rejects nothing) moves every point after the first. The poisson sibling
explicitly avoids this with a forked RNG.

### Root Cause
```ts
// Distribute.ts:210-216 — _sampleRandom: density draw shares rng with sampler
while (cloud.length < targetCount && attempts < maxAttempts) {
    sampler.sample(rng, pos, normal)      // draws from rng
    attempts++
    if (options.densityField) {
        if (rng.next() > options.densityField(pos)) continue   // SAME rng
    }
    ...
}
```
vs the decoupled poisson path:
```ts
// Distribute.ts:309-317 — _samplePoisson: density uses a forked rng
// Phase 2: Apply density field as a separate pass using a separate RNG.
// This ensures density field changes don't affect spatial positions.
const densityRng = rng.fork()
for (const candidate of candidates) {
    if (options.densityField) {
        if (densityRng.next() > options.densityField(candidate.position)) continue
    }
    ...
}
```
The random path contradicts the documented contract that the poisson path upholds.

### Fix
Mirror the poisson approach: draw positions from `rng`, and apply the density
rejection from a `rng.fork()` so the density field cannot perturb spatial sampling.

---

## LOW — Distribute.transform corrupts normals (applies full 4×4 inverse-transpose via applyMatrix4)

### Bug
`transform()` applies the 4×4 inverse-transpose matrix to normals with
`Vector3.applyMatrix4`, which adds the translation column and divides by the
perspective `w` row. For a normal (a *direction*), only the upper-3×3
inverse-transpose should apply. Any translation in `matrix` corrupts the normal
direction; positions are fine.

### Root Cause
```ts
// Distribute.ts:554-561
export function transform(cloud: PointCloud, matrix: Matrix4): PointCloud {
    const normalMatrix = new Matrix4().copy(matrix).invert().transpose()
    for (const pt of cloud) {
        pt.position.applyMatrix4(matrix)
        pt.normal.applyMatrix4(normalMatrix).normalize()   // adds translation column
    }
    return cloud
}
```
`Vector3.applyMatrix4` (`three.js-modded/src/math/Vector3.js`) applies the full
4×4 including the translation column and perspective divide. `transform` is not
currently called from the plugin or examples (latent bug in an exported utility).

### Fix
Use the 3×3 normal matrix:
```ts
const nm = new Matrix3().getNormalMatrix(matrix)
pt.normal.applyMatrix3(nm).normalize()
```
(or `pt.normal.transformDirection(matrix).normalize()` if no non-uniform scale).

---

## LOW — onGrid silently ignores jitter when jitter>0 but seed omitted

### Bug
`rng` is created only when `options?.seed !== undefined`, and the jitter block is
guarded by `if (jitter > 0 && rng)`. Calling `onGrid(..., {jitter: 0.5})` with no
`seed` produces a perfect (un-jittered) grid with no warning — the `jitter` input
is silently dropped. The doc says seed is "required if jitter > 0" but nothing
enforces or warns.

### Root Cause
```ts
// Distribute.ts:356
const rng = options?.seed !== undefined ? new SeededRandom(options.seed) : undefined
// Distribute.ts:368
if (jitter > 0 && rng) {
    px += (rng.next() - 0.5) * spacingX * jitter
    pz += (rng.next() - 0.5) * spacingZ * jitter
}
```

### Fix
Either default the seed (`new SeededRandom(options?.seed ?? 0)` whenever
`jitter > 0`), or throw/warn when `jitter > 0 && seed === undefined`.

---

## Impact
`count`-based curve distribution is always off by one (M16). Toggling/changing a
density field on `onFaces` 'random' silently relocates all points, breaking
determinism contracts that the poisson path documents and upholds (M17). The two
LOW items are a latent normal-corruption bug in an exported util and a
silently-ignored jitter parameter.

## Files
- `plugins/procedural-generation/src/points/Distribute.ts:416-428` — alongCurve count+1 loop (M16)
- `plugins/procedural-generation/src/points/Distribute.ts:210-216` — _sampleRandom shares rng for density (M17)
- `plugins/procedural-generation/src/points/Distribute.ts:309-317` — _samplePoisson forks rng (correct reference for M17)
- `plugins/procedural-generation/src/points/Distribute.ts:554-561` — transform corrupts normals (LOW)
- `plugins/procedural-generation/src/points/Distribute.ts:356,368` — onGrid drops jitter without seed (LOW)
