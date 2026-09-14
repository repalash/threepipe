# textureDataToImageData: sRGB encoding applied to the alpha channel

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`textureDataToImageData` applies the Linear→sRGB transfer function to every byte of the RGBA buffer, including the alpha byte. Alpha is not a color channel and must not be gamma/sRGB-encoded, so any semi-transparent pixel gets a wrong alpha value.

## Root Cause
```ts
for (let i = 0; i < data.length; i++) {
    // ... decode float/half/uint8 into data[i]
    if (colorSpace === LinearSRGBColorSpace) {
        data[i] = LinearToSRGB(data[i] / 255.0) * 255
    }
}
```

The loop walks every byte, so `i % 4 === 3` (alpha) is transformed too. For a fully-opaque pixel (alpha 255) `LinearToSRGB(1) = 1` so it is unchanged by luck, but e.g. alpha 128 (0.502 linear) becomes `LinearToSRGB(0.502) * 255 ≈ 187`.

## Impact
`textureDataToImageData` builds the final sRGB `ImageData` for screenshots (`src/rendering/RenderManager.ts:623`, called with `texture.colorSpace` for Half/Float targets). Captured/exported images with transparency get corrupted alpha. three.js's own conversions only transform RGB and copy alpha verbatim.

## Fix
Skip alpha when applying the transfer: only convert when `i % 4 !== 3` (or iterate per-pixel and convert r,g,b while passing a through unchanged).

## Files
- `src/three/utils/texture.ts:27-42` — sRGB transfer applied to alpha byte
- `src/rendering/RenderManager.ts:623` — caller passing `texture.colorSpace` for screenshots
