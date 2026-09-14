# Bug: `staticData.textureMap` in `tpImageInputGenerator.ts` grows unboundedly

## Summary

The module-level `staticData.textureMap` in `plugins/tweakpane/src/tpImageInputGenerator.ts` accumulates entries for every Texture / wrapper ever rendered into a tweakpane image input — and those entries are never evicted, even after the texture is disposed or the slot is unbound. Long-running editor sessions or scenes that load many textures will see this map (and the values it pins) grow without bound.

## Where the entries are added

Three sites, all in `plugins/tweakpane/src/tpImageInputGenerator.ts`:

1. **`setterTex` (line ~153):**
   ```ts
   if (v1.image) {
       if (!v1.image.id?.length) v1.image.id = generateUUID()
       if (!staticData.textureMap[v1.image.id]) staticData.textureMap[v1.image.id] = v1
   }
   ```
   Adds an entry keyed by the underlying image element's id whenever a Texture is set into a slot via `setterTex`.

2. **Proxy `get` accessor (line ~375):**
   ```ts
   const id = typeof ret === 'string' ? ret : ret.id ?? ret
   if (!staticData.textureMap[id]) staticData.textureMap[id] = config.__proxy.value_
   ```
   Adds an entry on every render of an image input — keyed by the preview data URL or `ret.id`. This is the registration that makes inter-slot drag-drop recovery work (see "Why it exists" below).

3. **`proxySetValue` (line ~195) — `imageMap`, separate map but same lifetime concern:**
   ```ts
   if (iMapKey) staticData.imageMap[iMapKey] = v
   ```
   Same problem on `imageMap`.

## Why no entry is ever removed

There is no `delete staticData.textureMap[...]` anywhere in the file. There is no hook tied to texture disposal, slot unbind, plugin teardown, or material removal. The pinned entries:

- Hold strong references to the Texture / wrapper objects, preventing GC even after the texture is removed from the scene and disposed.
- Hold strong references via the data URL string keys (large entries — a 160px PNG base64 is ~5–80 KB; LUT preview strings can be similar). Both the key and the value persist.

`staticData` itself is module-scope (`const staticData = { ... }`), so it lives for the lifetime of the page. Routines that dispose the viewer / re-init don't clear it.

## Where the leak hurts

- **Editor sessions with many texture imports** — every distinct Texture rendered to any image-input slot is pinned. Importing 100 textures and then "removing" them from the scene leaves all 100 alive.
- **Memory growth** — both the keys (data URL strings can be large) and the values (Textures with their `image` data, blobs, GPU upload tracking) stay resident.
- **Stale recovery** — drag-drop recovery via `textureMap[v.src]` could match an old entry whose underlying Texture has been disposed, returning a Texture in an invalid state.

## Why the registrations exist

The proxy `get` registration (#2 above) is **load-bearing** for inter-slot drag-drop:

- Tweakpane image plugin v1.1.404+ transfers the source panel `<img>` on drag (via `dataTransfer.setData('img-id', ...)` then `getElementById` on drop). The destination slot's `proxySetValue` receives `v = panel <img>` and looks up `staticData.textureMap[v.src]` to recover the original Texture / wrapper. Without the registration, the destination falls through to `new Texture(panelImg)` and silently produces a low-resolution wrap of the 160 px preview.
- See `tests/interactive.spec.ts` `tweakpane-editor` — disabling line 214's lookup makes the test fail; the registrations at lines 153 and 375 are what populate the map.

So we cannot simply remove the registrations. We need eviction.

## Suggested fixes

### Option A — Replace `textureMap` / `imageMap` plain objects with `WeakMap`

`WeakMap` would let GC reclaim entries when the value (Texture) is otherwise unreferenced. Problem: `WeakMap` keys must be objects, but our keys are strings (data URLs, ids). Would need a wrapper-key approach or a different structure.

Not directly drop-in. Skip.

### Option B — Bounded LRU with size cap

Replace plain object with a small LRU cap (say 256 entries). On insertion past cap, evict oldest. Recovery still works for recently-loaded textures. Old entries fall off naturally. Minimal code change; clear bound on memory.

Drawback: a slot holding a long-lived texture that hasn't been "touched" in a while could lose its entry and revert to wrap-on-drop. Mitigation: `set` should reset LRU position (already implicit if implemented as touch-on-access).

### Option C — Eviction hook on Texture dispose

Listen to `texture.dispose` event and remove entries whose value matches the disposed texture. Requires iterating the map on every dispose (O(N)) or maintaining a reverse index. Cleaner semantically but adds coupling.

### Option D — Periodic prune

On a timer or on viewer-level events (`scene.modelRoot` change, etc.), iterate `textureMap` and remove entries whose value `.disposed === true` (Texture has a `disposed` flag in three.js modded fork? check). Simpler than C, less precise.

### Recommended

**Option B** as a first pass — capped LRU, ~256 entries, ~few KB of code. Catches 99% of the unbounded-growth case without coupling to texture lifecycle. Revisit with C if memory profiling shows the cap is too aggressive.

## Acceptance criteria

- [ ] `staticData.textureMap` size never exceeds an explicit bound under any sequence of texture loads/unloads.
- [ ] `tweakpane-editor` interactive test still passes (drag-drop recovery still works for recently-rendered textures).
- [ ] Smoke test: load 1000 distinct textures into image inputs in a loop; confirm `textureMap` entry count stays under cap.
- [ ] Same fix applied to `staticData.imageMap` (same lifetime issue).

## Related

- The bug was identified during the webgi-side audit of inter-slot drag-drop (`tpImageInputGenerator`) on 2026-05-05.
- Both webgi and threepipe share this leak — fix should land in both with the same shape.
