# Misc cleanup in `tpImageInputGenerator.ts`

Low-severity issues found while auditing the image-input flow. Group them so they can be fixed as one cleanup pass.

## 1. `cc.isCompressedTexture && !cc.image.tp_src` accesses `.image` without null-check

`plugins/tweakpane/src/tpImageInputGenerator.ts:54`:

```ts
if (cc.isCompressedTexture && !cc.image.tp_src) {
    cc.image.tp_src = staticData.compressedTexImage
}
```

If a CompressedTexture has no image (unusual but possible during async load or after dispose), `cc.image.tp_src` throws TypeError. Should be `cc.image && !cc.image.tp_src`.

## 2. Dead-code video checks inside non-video branches

`tpImageInputGenerator.ts:81-91`:

```ts
} else if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement) {
    cc.image.tp_src = imageBitmapToBase64(cc.image, 160)
    if (cc.image instanceof HTMLVideoElement) {                              // ← dead, can never be true here
        setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000)
    }
} else {
    cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90)
    if (cc.image instanceof HTMLVideoElement) {                              // ← dead in this branch (video would have hit ImageBitmap check)
        setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000)
    }
}
```

Both `instanceof HTMLVideoElement` checks are dead code. Either:
- Remove them, or
- Add `cc.image instanceof HTMLVideoElement` to the outer condition for video preview generation, then the cleanup makes sense.

The commented-out video-bitmap line at the top of the function (`// if (cc.isVideoTexture && !cc.image.tp_src) { ... }`) suggests video preview was started but not finished. Either complete or remove.

## 3. LUT-only slot guard misses multi-extension inputs

`tpImageInputGenerator.ts:135-138`:

```ts
const exts = (config as any).extensions as string[] | undefined
if (exts?.length === 1 && exts[0] === '.cube' && v1 && typeof v1 === 'object' && !(v1 as any).domainMin) {
    renderer.alert?.('Only .cube LUT files are supported for this input.')
    return
}
```

Only fires when `extensions: ['.cube']` (exactly one element). If an `@uiImage('LUT', {extensions: ['.cube', '.csv']})` is ever defined, the guard never fires. Probably won't bite anyone today (no such usage exists), but a more correct check would be `exts?.length && exts.every(e => /^\.(cube|csv)$/.test(e))` — i.e., all extensions are LUT-class.

## 4. Proxy `get` swallows exceptions silently

`tpImageInputGenerator.ts:381-384`:

```ts
} catch (e) {
    console.error('uiconfig-tweakpane - ImageInput Unknown error', e)
    return staticData.placeholderVal
}
```

Every render that throws falls back to placeholder. If something is wrong with a single texture, the slot just shows "no image" with no other indicator. Console.error is the only signal. Suggestion: include the texture / config / material ref in the error message so it's traceable when bug-reported.

## 5. `imageBitmapToBase64` returns `''` for not-yet-loaded images

This is a `ts-browser-helpers` issue but bites this code path:

`ts-browser-helpers/src/image.ts:52`:
```ts
if (!(bitmap.width || ...) || !(bitmap.height || ...)) return ''
```

If `cc.image` is a freshly-created HTMLImageElement that hasn't decoded yet, `cc.image.tp_src = ''`. Then on line 101 `cc.image.tp_src ||` falls back to `cc.image.src` — which works only if `cc.image.src` is set. For some loader paths `src` may be unset too → ret stays placeholder, then on next render the same situation repeats until the image loads. A retry/refresh hook (`addEventListener('load', ...)`) would help but not strictly necessary.

## Severity

All low — none break common flows. Bundle into one cleanup PR.
