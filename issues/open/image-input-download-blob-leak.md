# Bug: `downloadImage` leaks the blob URL when exporting a DataTexture

## Summary

`plugins/tweakpane/src/tpImageInputGenerator.ts:286-301` exports DataTextures by encoding to EXR and creating a blob URL:

```ts
if (!src && tex.isDataTexture) {
    if (tex.type !== HalfFloatType && tex.type !== FloatType) {
        console.error('Only Float and HalfFloat Data texture export is supported', vcv, tex, config)
        return
    }
    const buffer = new EXRExporter2().parse(undefined as any, tex as DataTexture&ITexture)
    const val: Blob|undefined = new Blob([buffer], {type: 'image/x-exr'})
    if (!val) {
        console.error('cannot export data texture', vcv, tex, config)
        return
    }
    name = 'dataTexture.exr'
    src = URL.createObjectURL(val)   // ← blob URL created
    // revokeSrc NOT set to true here
}
```

Compare to the renderTarget branch (line 269-280) which DOES set `revokeSrc = true`. The data-texture branch is missing it, so the blob URL is never revoked. One blob URL per data-texture export → memory leak (small but cumulative).

## Fix

```ts
name = 'dataTexture.exr'
src = URL.createObjectURL(val)
revokeSrc = true   // ← add this
```

## Severity

Low — small memory leak, only triggers on user-initiated DataTexture downloads. Browser tab close cleans up. But cumulative if user exports many data textures in one session.
