# Undo of `material` restores only the colour

**Status: fixed on `demo-edit-chain` (f58e33b)**: `EntrySnapshot.material` holds colour (linear
floats, so exact), metalness, roughness, opacity, transparent, flatShading and wireframe, and restore
writes them all - also when undo revives a deleted object. Test: `plugins/modelling/tests/undo-fidelity.test.ts`.

**Found by**: edit-chain harness, steps `main-25`, `hazard-05` (undo check: "material differs").
**Severity**: medium. `undo` reports success and the document is not what it was.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c'})
await run({op: 'material', object: 'c', color: '#3a3a40', roughness: 0.4, metalness: 0.15})
await run({op: 'undo'})
// colour is back to #b7bcc4; roughness stays 0.4 and metalness 0.15 (were 0.55 and 0.1)
```

## Cause

`EntrySnapshot` (`plugins/modelling/src/document.ts`) stores `materialColor` and nothing else of the
material, and `restore` / `_applyTransform` only set the colour back. `material` also changes
`metalness`, `roughness`, `opacity`/`transparent`, `flatShading` and `wireframe`. Redo has the same gap
in the other direction.

## Expected

Blender's undo restores the whole material datablock (global undo, `memfile_undo`), so every property
the command set comes back. Snapshot every field `material` writes.
