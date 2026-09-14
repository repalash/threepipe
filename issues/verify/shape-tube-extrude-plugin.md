# ShapeTubeExtrudePlugin + New Geometry Generators

## Summary
Ported the webgi ShapeTubeExtrudePlugin to threepipe as a core plugin. Added three new geometry generators (tube, shape, tubeShape) to GeometryGeneratorPlugin.

---

## Checklist

### Core implementation
- [x] Create `EllipseCurve3D` helper (`src/core/geometry/EllipseCurve3D.ts`)
- [x] Create `CurveUiHelper` (`src/plugins/geometry/helpers/CurveUiHelper.ts`)
- [x] Create `ShapePresets` utility (`src/plugins/geometry/helpers/ShapePresets.ts`)
- [x] Create `TubeGeometryGenerator` (`src/plugins/geometry/primitives/TubeGeometryGenerator.ts`)
- [x] Create `ShapeGeometryGenerator` (`src/plugins/geometry/primitives/ShapeGeometryGenerator.ts`)
- [x] Create `TubeShapeGeometryGenerator` (`src/plugins/geometry/primitives/TubeShapeGeometryGenerator.ts`)
- [x] Register generators in `GeometryGeneratorPlugin` (tube, shape, tubeShape)
- [x] Port `ShapeTubeExtrudePlugin` (`src/plugins/geometry/ShapeTubeExtrudePlugin.ts`)
- [x] Add exports to `src/plugins/index.ts`
- [x] Add `EllipseCurve3D` export to `src/core/index.ts`
- [x] Delete `src/core/geometry/ShapeTubeExtrudePlugin.reference.ts`

### CONTRIBUTING.md checklist
- [x] Classes in subfolder at `src/plugins/geometry/`
- [x] Inherit from `AViewerPluginSync`
- [x] Unique `PluginType` set
- [x] JSDoc comments on classes
- [x] Exports in `src/plugins/index.ts`
- [x] Create example (`examples/shape-tube-extrude/`)
- [x] Add example to `examples/index.html`
- [x] Add to `README.md`
- [x] Add to `website/guide/core-plugins.md`
- [x] Create `website/plugin/ShapeTubeExtrudePlugin.md`
- [x] Add sidebar entry in `website/.vitepress/config.ts`
- [x] Update `CHANGELOG.md`

### Verification
- [x] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] Dev server starts, example works in browser
- [ ] Test: generate tube geometry from UI
- [ ] Test: generate shape geometry from UI
- [ ] Test: generate tubeShape geometry from UI
- [ ] Test: extrude a plane along a circle curve
- [ ] Test: multi-material splits
- [ ] Test: change curve type and shape type from UI

## Known limitations
- Curve/Shape objects in `generationParams` don't serialize to JSON (same as LineGeometryGenerator)
- `EllipseCurve3D` has a type mismatch (`Curve<Vector2>` vs `Curve<Vector3>`) — uses `as any` cast
