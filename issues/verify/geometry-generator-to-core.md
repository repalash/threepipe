# Move GeometryGeneratorPlugin to Core

## Summary
Moved the geometry generator framework, all generators except text, and ShapeTubeExtrudePlugin from `@threepipe/plugin-geometry-generator` into core `threepipe`.

**Final state:**
- Core `GeometryGeneratorPlugin` has 10 generators: plane, box, sphere, circle, torus, cylinder, tube, shape, tubeShape, line
- External package provides only: `TextGeometryGenerator`, `FontLibrary`, `GeometryGeneratorExtrasPlugin` (registers text)
- New core plugins: `ShapeTubeExtrudePlugin`, `TubeGeometryGenerator`, `ShapeGeometryGenerator`, `TubeShapeGeometryGenerator`
- New core helpers: `CurveUiHelper` (shared curve UI configs), `ShapePresets`, `EllipseCurve3D`

---

## Checklist

### Core changes
- [x] Add `generationParams` to `IGeometryUserData` in `src/core/IGeometry.ts`
- [x] Create `src/plugins/geometry/` with AGeometryGenerator, GeometryGeneratorPlugin, ShapeTubeExtrudePlugin
- [x] Move 6 basic primitive generators: Box, Circle, Cylinder, Plane, Sphere, Torus
- [x] Add 3 new generators: Tube, Shape, TubeShape
- [x] Move LineGeometryGenerator to core (line/curve types are core three.js)
- [x] Create CurveUiHelper (shared curve UI configs for all generators)
- [x] Create ShapePresets (rectangle, circle, polygon shape creation)
- [x] Create EllipseCurve3D with proper serialization (type + SerializableClasses)
- [x] Fix missing `removeEventListener('geometryUpdate')` in GeometryGeneratorPlugin.onRemove
- [x] Fix ArcCurve UI: use `xRadius` not `aRadius`, sync `yRadius` for circular arcs
- [x] Fix ShapePresets polygon duplicate vertex (`i <= sides` → `i < sides`)
- [x] Add exports to `src/plugins/index.ts`
- [x] JSDoc on all classes

### External package
- [x] Slim to text-only: TextGeometryGenerator + FontLibrary + GeometryGeneratorExtrasPlugin
- [x] GeometryGeneratorExtrasPlugin only registers `text` generator
- [x] Deprecated `GeometryGeneratorPlugin` shim with migration warning
- [x] Re-export core symbols for backward compatibility
- [x] Module augmentation only for `text` in `IGeometryGeneratorMap`
- [x] Updated README, CHANGELOG, package.json descriptions

### Examples
- [x] `geometry-generator-plugin/` — shows all 11 generators in 4x3 grid with auto-fov
- [x] `shape-tube-extrude/` — Tube + Shape = TubeShape demo with 3D text labels
- [x] `shape-tube-extrude-plugin/` — interactive extrusion workflow
- [x] `follow-path-constraint/` — imports LineGeometryGenerator from core, dropped extras plugin
- [x] `object-constraints-plugin/` — same
- [x] `line-helper-widget/`, `simple-svg-text-plane/`, `troika-text-plane/`, `troika-text-shadow/`, `svg-geometry-playground/` — import GeometryGeneratorPlugin from core
- [x] `tweakpane-editor/` — uses both core plugin and extras for text
- [x] Removed unused import map entries from 6 examples

### Documentation
- [x] `website/plugin/GeometryGeneratorPlugin.md` — lists all 10 core generators
- [x] `website/plugin/ShapeTubeExtrudePlugin.md` — interactive + programmatic usage
- [x] `website/package/plugin-geometry-generator.md` — text-only package
- [x] `website/guide/core-plugins.md` — all 10 generators listed
- [x] `website/guide/threepipe-packages.md` — updated description
- [x] `website/notes/fat-lines.md` — fixed stale import, grammar
- [x] `website/notes/widgets-and-helpers.md` — comprehensive widget system docs
- [x] `website/.vitepress/config.ts` — sidebar entries
- [x] `README.md` — updated generator list and package description
- [x] `CHANGELOG.md` — all changes noted

### Verification
- [x] `npx tsc --noEmit` passes
- [x] All examples type-check
- [x] Audited by 3 parallel subagents: source, examples, docs

---

## Related issues
- `issues/open/geometry-generator-serialization.md` — verification test for Curve/Shape serialization round-trip
- `issues/open/interactive-curve-shape-widgets.md` — future CurveHelper/ShapeHelper widgets
- `issues/open/move-line-generator-to-core.md` — completed, can be moved to verify/resolved
