# GLTFDracoExportPlugin: registers a temp DRACO file per export (never unregistered) + onRemove asymmetric when GLB exporter was synthesized

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`_ctor` runs on every export and registers a new uniquely-named dummy `.drc` file in the importer, never unregistering it. Separately, when `onAdded` synthesizes a GLB exporter (because none existed), `onRemove` does nothing to remove it.

## Root Cause
```ts
protected _ctor: IExporter['ctor'] = (_, _exporter) => {
    if (!this._viewer) throw new Error('Viewer not set')
    const tempFile = generateUUID() + '.drc' // dummy
    const ex = new GLTFDracoExporter({},
        // todo unregister on dispose
        this._viewer.assetManager.importer.registerFile(tempFile) as DRACOLoader2)
    // ...
}
```
Each export registers a fresh `DRACOLoader2` under a unique name and never removes it, so the importer's file map grows by one per export for the viewer's lifetime. Separately:
```ts
// onAdded — synthesizes an exporter when none exists
if (!glbExporter) { glbExporter = {ext:['glb','gltf'], extensions:[], ctor:this._ctor}; exporter.addExporter(glbExporter) }
else { glbExporter.ctor = this._ctor }
```
```ts
// onRemove — only restores when _lastExporter is truthy
if (glbExporter && this._lastExporter) { glbExporter.ctor = this._lastExporter }
```
When the exporter was synthesized, `_lastExporter` stays `undefined`, so `onRemove` does nothing, leaving the plugin's `_ctor`-based exporter permanently registered after removal.

## Impact
Importer file map grows by one `DRACOLoader2` per export (slow unbounded growth); and a synthesized GLB exporter survives plugin removal — an onAdded/onRemove asymmetry.

## Fix
Track registered temp files and unregister them on dispose/onRemove; in `onRemove`, also remove the synthesized exporter when `_lastExporter` was undefined.

## Files
- `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts:100-109` — temp `.drc` registered per export, `// todo unregister on dispose`
- `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts:111-127` — `onAdded` may synthesize an exporter
- `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts:156-163` — `onRemove` only restores when `_lastExporter` is truthy
