# modelling editor: Solid shading in edit mode draws a grey quad and striped faces (SwiftShader)

**Found**: 2026-10-18, track0-followups, writing the `modelling-edit-normals` e2e.

In the `modelling-edit-normals` example (any modelling-editor example), switch the header's shading to
**Solid** and press Tab on the cube: a large translucent grey quad appears standing behind the cube, the
cube's faces show dense stripes (depth fighting between the surface and the edit-mode face overlay), and
the edge and vertex overlays are mostly missing. In **Material preview** the same view is clean.
Screenshots (SwiftShader, Playwright Chromium on Linux): `tmp/issue-shots/solid-edit-mode.png` and
`tmp/issue-shots/material-edit-mode.png` in the `track0-followups` worktree.

The scene has no extra mesh in that state (the visible objects are the cube, the `MeshEdit Overlays`
fat lines and face mesh, and the grid), so the quad is likely a full-object draw of the solid shading
override (or of the overlay with the override's material) rather than a stray object. Not checked on a
GPU yet. The surface offset `MeshEditPlugin._offsetSurface` sets on the object's materials while editing
may not reach the material the Solid override swaps in.

**Next**: reproduce on the Mac GPU browser; check how `EditorViewportPlugin.setShading('solid')` replaces
materials and whether `_offsetSurface` / the overlays' depth settings apply to it.

## Fixed 2026-10-18 (track0-followups) - not SwiftShader-only

**GPU check**: on the Mac VM (Chromium, `--use-angle=metal`, "ANGLE Metal Renderer: Apple Paravirtual
device") the same view showed the same thing: a dark quad standing behind the cube, striped faces, most of
the vertex and edge overlays gone (`tmp/gpu/edit-shading-solid.png` in the worktree). Object-mode Solid was
clean. So it was not a SwiftShader artefact.

**Cause**: three.js-modded applies `scene.overrideMaterial` (how the editor does Solid and Wireframe
shading) to every material with `allowOverride === true`, which is the default for `ShaderMaterial` and for
threepipe's materials. The edit-mode overlays did not opt out (the gizmos and the knife overlay already
did): the fat-edge `LineSegments2` was drawn with the solid `PhysicalMaterial`, i.e. its instanced
screen-space quad as one plain quad (the grey quad); the selected-face tint (`UnlitMaterial`) became an
opaque solid surface without its polygon offset (the stripes); the vertex `Points` lost their shader.

**Fix**: `allowOverride = false` on the vertex, edge, face-dot, selected-face and preselect materials
(`plugins/mesh-edit/src/overlayMaterials.ts`, `MeshEditPlugin._buildOverlays`). After it the Metal
screenshots in Solid and Wireframe show the normal overlays (`tmp/gpu/after-edit-shading-*.png`), and the
`modelling-edit-normals` e2e now also checks Solid shading in edit mode (no overlay allows the override,
the screen around the mesh is unchanged, coplanar faces shade alike).
