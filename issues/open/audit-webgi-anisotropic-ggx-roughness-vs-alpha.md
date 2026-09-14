# webgi anisotropyBsdf.glsl: anisotropic GGX uses perceptual roughness instead of alpha for at/ab (computed `alpha` is dead)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The anisotropic GGX tangent/bitangent roughnesses `at`/`ab` are derived from perceptual `roughness × aspect`, but the GGX visibility/distribution functions expect alpha-space (roughness²) inputs. The locally-computed `alpha = pow2(roughness)` is never used.

## Root Cause
```glsl
float alpha = pow2( roughness ); // computed...
// ...
float aspect = sqrt(1.0 - min(1.-MIN_ROUGHNESS, abs(anisotropyFactor) * 0.9));
if (anisotropyFactor > 0.0) aspect = 1.0 / aspect;
float at = roughness * aspect;   // ...but at/ab use roughness, not alpha
float ab = roughness / aspect;
// ...
float V = V_GGX_SmithCorrelated_Anisotropic( at, ab, ... );
float D = D_GGX_Anisotropic( at, ab, ... );
```
The modded three.js `V_GGX_SmithCorrelated_Anisotropic`/`D_GGX_Anisotropic` expect alpha-space `alphaT`/`alphaB` (three.js's own anisotropy code passes `material.alphaT` and `alpha` = roughness²). Here `at`/`ab` are perceptual roughness × aspect, so the GGX lobe is far too sharp/narrow (under-rough specular). The discarded `alpha` strongly suggests the intended code was `at = alpha * aspect; ab = alpha / aspect`. (Filament uses `roughness` directly only because its `material.roughness` is already alpha; three.js's is perceptual, so the port must square it.)

## Impact
Anisotropic specular is rendered too sharp/narrow for a given roughness — incorrect BSDF.

## Fix
Derive `at`/`ab` from `alpha`, e.g. `float at = max(alpha*aspect, MIN_ROUGHNESS*MIN_ROUGHNESS); float ab = max(alpha/aspect, MIN_ROUGHNESS*MIN_ROUGHNESS);` (and drop the now-used `alpha` comment).

## Files
- `experiments/threepipe-webgi/src/plugins/extras/shaders/anisotropyBsdf.glsl:24` — `alpha = pow2(roughness)` computed
- `experiments/threepipe-webgi/src/plugins/extras/shaders/anisotropyBsdf.glsl:48-58` — `at`/`ab` use `roughness`, not `alpha`
