# SVGMesh.colorForFaceIndex: per-group color compares a face index against index-buffer offsets (3× unit mismatch)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
For multi-material meshes, `colorForFaceIndex` matches a `faceIndex` (a *triangle number*) directly against `group.start` / `group.start + group.count`, which are in *index-buffer element* units (multiples of 3). Comparing triangle units against index-buffer units is a 3× mismatch, so most polygons get the wrong material color.

## Root Cause
```ts
colorForFaceIndex(faceIndex: number): null | Color {
    if (Array.isArray(this.material)) {
        for (const group of this.threeMesh.geometry.groups) {
            if (group.start <= faceIndex &&
                faceIndex < (group.start + group.count) &&
                group.materialIndex != undefined &&
                group.materialIndex < this.material.length) {
                return colorForMaterial(this.material[group.materialIndex]);
            }
        }
```
`faceIndex` comes from `assignPolygons.ts` (`intersection.faceIndex` from raycasting). In the modded three.js `Mesh.js`, `faceIndex = Math.floor(j / 3)` — a triangle number. But `geometry.groups[].start`/`.count` are index-buffer offsets per `BufferGeometry.addGroup` semantics (and `WebGLRenderer` uses `group.start * rangeFactor` as a draw offset into the index buffer). e.g. a group `{start:300, count:150}` covers triangles 100..149, but this code matches `faceIndex` 300..449.

## Impact
Multi-material meshes get the wrong material color assigned to most polygons (and small first groups never match). Only the array-material branch is affected; the single-material path ignores `faceIndex` and is fine.

## Fix
Compare in face units, e.g. `group.start <= faceIndex*3 && faceIndex*3 < group.start + group.count` (equivalently divide `group.start`/`group.count` by 3).

## Files
- `plugins/svg-renderer/src/three-svg-renderer/core/SVGMesh.ts:139-153` — `colorForFaceIndex` unit mismatch
- `plugins/svg-renderer/src/three-svg-renderer/core/viewmap/operations/assignPolygons.ts` — sole caller, passes the raycast `faceIndex` unchanged
