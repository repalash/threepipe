# createRenderTargetKey: omits `stencilBuffer` so temp targets can be reused with the wrong stencil config

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`createRenderTargetKey` builds the temp-target pooling key from sizeMultiplier, samples, colorSpace, type, format, depthBuffer, depthTexture, textureCount, and size — but not `stencilBuffer`. `getTempTarget` pools by this key and only re-applies texture filter options on reuse, never the framebuffer's stencil attachment. Two requests that differ only in `stencilBuffer` would share one pooled target with the first-created stencil config.

## Root Cause
```ts
export function createRenderTargetKey(op: CreateRenderTargetOptions = {}): string {
    return [op.sizeMultiplier, op.samples, op.colorSpace, op.type, op.format,
        op.depthBuffer, op.depthTexture, op.textureCount, op.size?.width, op.size?.height].join(';')
    // op.stencilBuffer not included
}
```
e.g. `ExtendedRenderPass` passes `stencilBuffer: composerTarget.stencilBuffer` to `getTempTarget`. Dormant today because stencil is a viewer-global flag, but a latent correctness bug if mixed.

## Impact
A temp target requested with `stencilBuffer: true` could be served a pooled target created without stencil (or vice versa) — wrong framebuffer stencil attachment.

## Fix
Include `op.stencilBuffer` in the key.

## Files
- `src/rendering/RenderTarget.ts:98-101` — key omits `stencilBuffer`
- `src/rendering/RenderTargetManager.ts:100-111` — `getTempTarget` pools by this key, reapplies only filter options
