# Bug: image-input drop sets `userData.mimeType` to `image/jpeg` or `image/png` only

## Summary

Two sites in `plugins/tweakpane/src/tpImageInputGenerator.ts` write `userData.mimeType` based purely on whether the extension is `jpg`/`jpeg`. Everything else gets `image/png`.

**`setterFile` (line 168-171):**
```ts
const ext = path?.split('?')?.[0]?.split('.').pop() ?? ''
if ((texture as any).userData) {
    if (!(texture as any).userData.mimeType)
        (texture as any).userData.mimeType = 'image/' + (['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png')
}
```

**`proxySetValue` HTMLImageElement-wrap branch (line 236-238):**
```ts
const ext = v.src?.split('?')?.[0]?.split('.').pop() ?? ''
if (!tex.userData.mimeType)
    tex.userData.mimeType = 'image/' + (['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png')
```

A `.webp`, `.gif`, `.bmp`, `.tiff`, `.svg`, `.avif`, `.ktx2`, `.exr`, `.hdr` dropped image gets `image/png` MIME. On GLTF export the wrong MIME is emitted; on re-import, the embedded extension and decoder don't match.

## Fix

Replace with a proper extension → MIME lookup:

```ts
const MIME_BY_EXT: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff', tif: 'image/tiff',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',
    ktx2: 'image/ktx2',
    ktx: 'image/ktx',
    exr: 'image/x-exr',
    hdr: 'image/vnd.radiance',
    cube: 'application/x-cube-lut', // or whatever the convention is for LUT
}
function mimeFromExt(ext: string): string {
    return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}
```

Likely worth extracting to `src/utils/mime.ts` for reuse — `setterFile` already special-cased once; reading other places' MIME logic is good.

## Severity

High — affects round-trip correctness of GLTF exports for any non-jpg/png texture.

## Related

- `src/assetmanager/AssetImporter.ts:registerFile:479` — known operator-precedence bug also touches mime; covered separately in the audit.
