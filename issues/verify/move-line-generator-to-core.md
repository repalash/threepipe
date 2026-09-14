# Move LineGeometryGenerator to Core

## Rationale
Line/curve types are core three.js. CurveUiHelper is already in core. TubeGeometryGenerator and TubeShapeGeometryGenerator already handle curves in core. Having LineGeometryGenerator in the external package creates an unnecessary split — future curve editing widgets would need it.

After this, the external package only contains TextGeometryGenerator + FontLibrary (which depend on `three/examples/jsm`). Could be renamed to `@threepipe/plugin-text-generator` later.

## Checklist

### Move LineGeometryGenerator to core
- [x] Copy to `src/plugins/geometry/primitives/LineGeometryGenerator.ts` with rewritten imports
- [x] Add `line: LineGeometryGenerator` to `IGeometryGeneratorMap`
- [x] Add `line: new LineGeometryGenerator('line')` to `generators` map
- [x] Add exports to `src/plugins/index.ts`
- [x] Update JSDoc in `GeometryGeneratorPlugin` — only text needs extras now

### Update external package
- [x] Delete `plugins/geometry-generator/src/primitives/LineGeometryGenerator.ts`
- [x] Update `index.ts` — re-export `LineGeometryGenerator` from core, module augmentation only for `text`
- [x] Update `GeometryGeneratorExtrasPlugin.ts` — only registers text, updated warning
- [x] Update deprecated shim warning message

### Update examples
- [x] `examples/follow-path-constraint/` — import from `'threepipe'`, drop `GeometryGeneratorExtrasPlugin`, remove import map entry
- [x] `examples/object-constraints-plugin/` — same

### Update docs
- [x] `website/package/plugin-geometry-generator.md` — updated: text-only
- [x] `website/guide/threepipe-packages.md` — updated description
- [x] `website/plugin/GeometryGeneratorPlugin.md` — updated: line is core, lists all 10 generators
- [x] `README.md` — updated
- [x] `CHANGELOG.md` — noted line moved to core

### Verification
- [x] `npx tsc --noEmit` passes
