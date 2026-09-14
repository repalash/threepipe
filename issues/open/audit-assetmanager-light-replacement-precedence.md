# AssetManager: light replacement `??`/ternary precedence always builds a DirectionalLight2

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
The light-replacement expression has the same `??`/ternary precedence trap as the camera path: a cached `iLight` is never reused, and whenever a cached `iLight` is present the code always constructs a `DirectionalLight2` regardless of the real source light type (point/spot/ambient/hemisphere/rect).

## Root Cause
```ts
const newLight: ILight | undefined = (light as any).iLight ??
(light as any).isDirectionalLight ? new DirectionalLight2() :
    (light as any).isPointLight ? new PointLight2() :
        (light as any).isSpotLight ? new SpotLight2() :
            (light as any).isAmbientLight ? new AmbientLight2() :
                (light as any).isHemisphereLight ? new HemisphereLight2() :
                    (light as any).isRectAreaLight ? new RectAreaLight2() :
                        undefined
if (light === newLight || !newLight) continue
```
`??` binds tighter than `?:`, so this parses as:
```ts
((light.iLight ?? light.isDirectionalLight) ? new DirectionalLight2() : <rest of chain>)
```
When `light.iLight` is a truthy cached object, the first ternary condition is truthy → it **always** builds `DirectionalLight2` and never falls through to the type-specific branches, and never returns the cached `iLight`. The `if (light === newLight || !newLight) continue` guard is dead for the cached case (a fresh object never `===` the source).

## Impact
Re-importing/re-processing a scene with a parented non-directional light (point, spot, ambient, hemisphere, rect-area) that already has a cached `iLight` replaces it with a `DirectionalLight2`, corrupting the lighting. The intended cache-reuse never happens.

## Fix
Group explicitly so `??` is the fallback for `iLight`:
```ts
const newLight: ILight | undefined = (light as any).iLight ??
    ((light as any).isDirectionalLight ? new DirectionalLight2() :
        (light as any).isPointLight ? new PointLight2() :
            (light as any).isSpotLight ? new SpotLight2() :
                (light as any).isAmbientLight ? new AmbientLight2() :
                    (light as any).isHemisphereLight ? new HemisphereLight2() :
                        (light as any).isRectAreaLight ? new RectAreaLight2() :
                            undefined)
```

## Files
- `src/assetmanager/AssetManager.ts:775` — mis-parenthesized light replacement expression (`if (light === newLight || !newLight) continue` guard at 783 is dead for the cached case)
