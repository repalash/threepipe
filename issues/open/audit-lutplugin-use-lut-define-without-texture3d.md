# LUTPlugin: sets `USE_LUT` define on wrapper truthiness even when the wrapper has no `texture3D` → shader samples a null sampler3D

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`_updateParams` sets the `USE_LUT` define purely from `this.lutMap`'s truthiness, but `_updateLUT` deliberately leaves the texture uniform `null` when the wrapper exists yet lacks `texture3D`. So a truthy-but-incomplete wrapper yields `USE_LUT = 1` while `lut3d.value` stays `null` — the shader declares and samples `sampler3D lut3d` against an unbound/null 3D sampler (undefined/garbage output), defeating the very fallback the defensive code claims to provide.

## Root Cause
```ts
private _updateParams() {
    this._updateLUT(this.lutMap, this.extraUniforms.lut3d, this.extraUniforms.lutSize)
    this.extraDefines.USE_LUT = this.lutMap ? 1 : 0     // <- only checks the wrapper, not its texture3D
    ...
}

private _updateLUT(wrapper, textureUniform, sizeUniform) {
    const tex3d = wrapper?.texture3D
    if (wrapper && tex3d) {
        textureUniform.value = tex3d
        ...
    } else {
        if (wrapper && !tex3d) console.warn('LUTPlugin: value has no .texture3D ...')
        textureUniform.value = null    // <- value stays null, but USE_LUT was already set to 1
    }
}
```
The define must track whether a usable texture was actually bound, not whether the wrapper reference is non-null. `lutSize` also stays at its default `1` in this path, compounding bad UVs.

## Impact
Assigning a wrapper that is set but lacks `texture3D` (a plain `Texture` dropped in, or the wrapper before its `texture3D` is populated) makes the shader sample a null sampler3D → black/garbage grading instead of a no-op pass-through.

## Fix
Set the define from the resolved texture — e.g. have `_updateLUT` return whether it bound a texture:
```ts
this.extraDefines.USE_LUT = this._updateLUT(this.lutMap, ...) ? 1 : 0   // 1 only when wrapper && wrapper.texture3D
```

## Files
- `src/plugins/postprocessing/LUTPlugin.ts:143-150` — `USE_LUT` (and USE_LUT1/USE_LUT2) gated on wrapper truthiness
- `src/plugins/postprocessing/LUTPlugin.ts:153-168` — `_updateLUT` leaves the uniform null when `texture3D` is missing
- `src/plugins/postprocessing/shaders/LUTPlugin.glsl:13-21,55-71` — declares/samples `sampler3D lut3d` under `USE_LUT`
