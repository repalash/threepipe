# ThreeViewer in Node.js — Status & Required Changes

## What Works
ThreeViewer can be created and used in Node.js for headless operations (asset loading, scene graph manipulation, geometry inspection) without WebGL rendering.

**Verified working:**
- ThreeViewer creation with `DummyRenderManager` (skips WebGL)
- AssetManager initialization
- GLB file loading via `addAsset(File)` — meshes, materials, scene graph all parsed
- Scene traversal, geometry attribute reading (positions, normals, UVs)

## Changes Made to threepipe Source

### Iterator compatibility (Node 20)
`Set.values()` and `Map.values()` return iterators in Node 20 which don't have `.map()`, `.find()`, `.flatMap()`, `.toArray()`. These are available in Node 22+ but not 20.

| File | Line | Change |
|---|---|---|
| `src/core/material/iMaterialCommons.ts` | 210 | `new Set(values().toArray())` → `new Set([...values()])` |
| `src/assetmanager/import/JSONMaterialLoader.ts` | 7-8 | `.values().flatMap()` and `.values().map()` → `[...values()].flatMap()` |
| `src/assetmanager/MaterialManager.ts` | 283, 305-306 | `.values().find()` → `[...values()].find()` |

**Recommendation:** Search for all `.values().` and `.keys().` and `.entries().` calls that chain Array methods. Use `[...iter]` spread consistently. Or set tsconfig target to ES2023 which includes iterator helpers, but that would require Node 22+ runtime.

### Potential future issues
- Any new code using `Iterator.prototype.map/filter/find/toArray` will break in Node 20
- `Array.fromAsync()` is Node 22+ only — check if used anywhere
- `Set.prototype.intersection/union/difference` is Node 22+ only

## Node.js Polyfill (`plugins/procedural-generation/src/utils/node-polyfill.ts`)

This polyfill provides browser API stubs needed by three.js and threepipe:

| Global | Purpose |
|---|---|
| `ImageData` | three.js Texture constructor |
| `HTMLElement` + subclasses | DOM element stubs (canvas, image) |
| `HTMLDocument` | `document.createElement`, `getElementById`, `querySelector` |
| `HTMLCanvasElement.getContext('2d')` | Stub 2D context |
| `getComputedStyle` | ThreeViewer constructor |
| `requestAnimationFrame` / `cancelAnimationFrame` | Animation loop |
| `window.addEventListener` | ThreeViewer event binding |
| `ProgressEvent` | three.js FileLoader progress events |
| `FileReader` | Asset import pipeline |
| `URL.createObjectURL` / `revokeObjectURL` | Blob URL handling |
| `fetch` wrapper | Blob URL resolution |
| `DummyRenderManager` (exported) | Replaces ViewerRenderManager — no WebGL needed |

### Usage
```typescript
import {DummyRenderManager} from '@threepipe/plugin-procedural-generation/utils/node-polyfill'
import {ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.createElement('canvas'),
    rmClass: DummyRenderManager,
    tonemap: false,
})
// viewer.assetManager, viewer.load(), viewer.scene all work
```

### GLB Loading in Node.js
```typescript
import * as fs from 'fs'
const buffer = fs.readFileSync('model.glb')
const file = new File([buffer], 'model.glb', {type: 'model/gltf-binary'})
const [scene] = await viewer.assetManager.addAsset(file)
scene.traverse(child => {
    if (child.isMesh) {
        const pos = child.geometry.getAttribute('position')
        console.log(child.name, pos.count, 'vertices')
    }
})
```

## What Doesn't Work (by design)
- **WebGL rendering** — no GPU in Node.js, use `DummyRenderManager`
- **Tone mapping plugin** — requires renderer, pass `tonemap: false`
- **Environment maps** — requires WebGL texture upload
- **Shadow maps** — requires WebGL renderer
- **Any plugin that accesses `renderManager.webglRenderer`** — returns `null` with DummyRenderManager

## tsconfig for Comparison Scripts
The porting scripts tsconfig (`porting/scripts/tsconfig.json`) needs:
```json
"paths": {
    "threepipe": ["../../../../dist/index.mjs"]
}
```
This is because `node_modules/threepipe` is a symlink to `../../../src` (monorepo dev setup), and tsx cannot compile threepipe source (decorators). Pointing to the compiled dist bypasses this.

## Future Improvements
- [ ] Move `DummyRenderManager` into threepipe core (not just the procedural-generation polyfill) so any package can create headless viewers
- [ ] Add a `ThreeViewer.createHeadless()` factory method that auto-configures DummyRenderManager + skips tonemap
- [ ] Add `file://` protocol support to AssetImporter for direct file path loading (currently requires `File` object)
- [ ] Consider setting tsconfig `target: "ES2023"` to use iterator helpers natively (requires Node 22+)
- [ ] Grep for all `.values().`, `.keys().`, `.entries().` calls in threepipe source to find remaining Node 20 incompatibilities
