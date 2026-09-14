# Geometry Generator Serialization — Verification Needed

## Summary
Curve and Shape objects stored in `geometry.userData.generationParams` should serialize/deserialize automatically via threepipe's `ThreeSerialization` system. All standard three.js Curve/Shape classes have `toJSON()`/`fromJSON()` and are registered in `SerializableClasses`. However this hasn't been verified end-to-end with the new generators.

## How it works
1. **Save:** `GLTFWriter2.serializeUserData()` calls `ThreeSerialization.Serialize(userData)`. Curve/Shape instances are not primitives, so the serializer calls their `toJSON()` method, producing JSON with a `type` field (e.g. `"LineCurve3"`).
2. **Load:** `GLTFLoader2.deserializeUserData()` calls `ThreeSerialization.Deserialize()`. It sees the `type` field, looks up the constructor in `SerializableClasses`, creates a new instance, and calls `fromJSON()` on it.

## Fixed
- [x] `EllipseCurve3D` was missing `type` property override and `SerializableClasses` registration. Would serialize as `"EllipseCurve"` and deserialize as a plain `EllipseCurve` (losing the Vector3 override). Fixed by adding `type = 'EllipseCurve3D'` and registration in static block.

## TODO — Verification
- [ ] Create a test in examples that generates tube/shape/tubeShape geometries, exports the scene as glTF/glb, reimports it, and verifies:
  - `geometry.userData.generationParams` is restored correctly
  - `generationParams.path` is the correct Curve subclass (not a plain object)
  - `generationParams.shape` (if present) is a proper Shape instance
  - Calling `generator.updateGeometry(geometry)` after reimport regenerates correctly
  - UI configs rebuild properly for the deserialized curves
- [ ] Test with each path type: `LineCurve3`, `CubicBezierCurve3`, `CatmullRomCurve3`, `EllipseCurve3D`
- [ ] Test with custom Shape (from `ConvertGeometryToFlatShape`)
- [ ] Verify `__generationParamsUiType` (double-underscore prefixed) is correctly stripped during serialization

## Context
- `ThreeSerialization.Init()` registers: Shape, Curve, CurvePath, Path, ArcCurve, CatmullRomCurve3, CubicBezierCurve, CubicBezierCurve3, EllipseCurve, LineCurve, LineCurve3, QuadraticBezierCurve, QuadraticBezierCurve3, SplineCurve, AnimationClip
- `CurvePath3` self-registers in `src/three/utils/curve.ts`
- `EllipseCurve3D` self-registers in `src/core/geometry/EllipseCurve3D.ts` (after fix)
- Generators store params via `Object.assign(geometry.userData.generationParams, params)` in `AGeometryGenerator.generate()`
- The geometry vertex data is already in the glTF buffer — `generationParams` is only needed for UI regeneration, not for display
