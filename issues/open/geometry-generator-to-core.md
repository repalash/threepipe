# Move GeometryGeneratorPlugin to Core

## Summary
Move the geometry generator framework and basic primitive generators from `@threepipe/plugin-geometry-generator` into the core `threepipe` package. This enables future core plugins to depend on geometry generation without circular dependencies.

**Scope:** Framework + 6 basic generators move to core. `TextGeometryGenerator`, `LineGeometryGenerator`, and `FontLibrary` stay in the external package (heavy `three/examples/jsm` deps). This is a **breaking change** for the external package.

---

## Checklist

### Core changes
- [x] Add `generationParams?: { type: string }` to `IGeometryUserData` in `src/core/IGeometry.ts`
- [x] Create `src/plugins/geometry/` directory
- [x] Copy + rewrite `AGeometryGenerator.ts` (remove `declare module 'threepipe'` augmentation, change imports to relative)
- [x] Copy + rewrite `GeometryGeneratorPlugin.ts` (only 6 generators, no text/line, rewrite imports)
- [x] Copy + rewrite 6 primitive generators: Box, Circle, Cylinder, Plane, Sphere, Torus
- [x] Add JSDoc comments to all classes
- [x] Add exports to `src/plugins/index.ts` (geometry section)
- [x] Update `Object3DGeneratorPlugin.ts` JSDoc link to `{@link GeometryGeneratorPlugin}`

### External package restructure
- [x] Delete moved files from `plugins/geometry-generator/src/` (AGeometryGenerator, GeometryGeneratorPlugin, global.d.ts, 6 primitive generators)
- [x] Update `TextGeometryGenerator.ts` imports (`AGeometryGenerator` from `threepipe`)
- [x] Update `LineGeometryGenerator.ts` imports (`AGeometryGenerator` from `threepipe`)
- [x] Create `GeometryGeneratorExtrasPlugin.ts` (registers text+line with core plugin, uses `geometry-extra-` prefix for Object3DGeneratorPlugin)
- [x] Add module augmentation for `IGeometryGeneratorMap` (text/line types)
- [x] Rewrite `index.ts` (re-export core symbols + export extras)
- [x] Major version bump in `package.json`
- [x] Update `README.md` with breaking change notice and migration path
- [x] Update `CHANGELOG.md`

### Examples
- [x] Update examples using only `GeometryGeneratorPlugin` — move import to `threepipe`, remove import map entry:
  - [x] `examples/line-helper-widget/`
  - [x] `examples/simple-svg-text-plane/`
  - [x] `examples/troika-text-plane/`
  - [x] `examples/troika-text-shadow/`
  - [x] `examples/svg-geometry-playground/`
- [x] Update examples using Text/Line/Font — split imports, add `GeometryGeneratorExtrasPlugin`:
  - [x] `examples/geometry-generator-plugin/`
  - [x] `examples/tweakpane-editor/`
  - [x] `examples/follow-path-constraint/`
  - [x] `examples/object-constraints-plugin/`
- [x] Remove unused import map entries from:
  - [x] `examples/troika-text-plugin/index.html`
  - [x] `examples/monkey-type-3d/index.html`
  - [x] `examples/three-csm-basic/index.html`
  - [x] `examples/cascaded-shadows-plugin-basic/index.html`
  - [x] `examples/bone-helper-widget/index.html`
  - [x] `examples/skeleton-helper-widget/index.html`

### Documentation (per CONTRIBUTING.md checklist)
- [x] Create `website/plugin/GeometryGeneratorPlugin.md` (core plugin doc page)
- [x] Add sidebar entry in `website/.vitepress/config.ts`
- [x] Add entry in `website/guide/core-plugins.md`
- [x] Update `website/package/plugin-geometry-generator.md` (note split, extras plugin)
- [x] Update `website/guide/threepipe-packages.md`
- [x] Update `website/notes/fat-lines.md` — no changes needed (references LineGeometryGenerator which stays in external)
- [x] Update `website/notes/vanilla-threejs.md`
- [x] Update `website/plugin/Object3DGeneratorPlugin.md`
- [ ] Update `website/plugin/ObjectConstraintsPlugin.md` — skipped, cross-reference still valid
- [ ] Update `website/package/plugin-gltf-transform.md` — skipped, cross-reference still valid
- [ ] Update `website/package/plugin-configurator.md` — skipped, cross-reference still valid
- [ ] Update `website/package/plugin-svg-renderer.md` — skipped, cross-reference still valid
- [x] Update `README.md`
- [x] Update `CHANGELOG.md`

### Verification
- [x] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] External package builds
- [ ] Dev server starts, examples work in browser
- [ ] Test: geometry-generator-plugin example (text+line via extras)
- [ ] Test: follow-path-constraint example (line via extras)
- [ ] Test: troika-text-plane example (basic generators only)
- [ ] Test: tweakpane-editor

---

## Key decisions
- **Breaking change accepted** for external package (major version bump)
- `GeometryGeneratorExtrasPlugin` uses `geometry-extra-` prefix (not `geometry-`) for `Object3DGeneratorPlugin` registration to avoid prefix collision with `addObject3DGenerators`
- `IGeometryGeneratorMap` module augmentation in external package restores type safety for text/line
- Vite alias kept since external package still has unique exports

## Detailed plan
See `/home/aibox/.claude/plans/nested-churning-muffin.md`
