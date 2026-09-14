# Interactive Test Coverage Gaps [RESOLVED]

**Resolved:** 2026-03-28

## What was fixed

### Tweakpane UI interactions added to all tests
All tests that had Tweakpane controls now use actual UI interactions instead of only `page.evaluate()`:
- **camera-uiconfig** — FOV via textbox, autoLookAtTarget via checkbox, near/far clip
- **screen-pass-extension-plugin** — intensity via textbox, enable toggle via checkbox
- **unreal-bloom-pass** — strength/radius/threshold via textboxes, folder open
- **cascaded-shadows-plugin-basic** — mode dropdown, fade checkbox, CSMHelper visibility
- **gltf-transmission-test-msaa** — transmission/IOR via Tweakpane Refraction folder textboxes
- **stencil-clipping-portal** — Picker/object folder collapse/expand
- **multi-render-uv-clip** — ALL evaluate calls replaced with Tweakpane slider textbox
- **material-configurator-plugin** — grid swatch clicks, full context menu CRUD with HTML dialogs

### Missing downloads added
- **depth-buffer-plugin** — "Download snapshot" button + EXR context menu download
- **normal-buffer-plugin** — "Download snapshot" button + EXR context menu download

### Context menu CRUD tested
- **material-configurator-plugin** — Rename Title, Rename Mapping, Remove material, Clear Materials, Remove Section — all through actual right-click → context menu → HTML dialog interactions

### Additional improvements
- **fullscreen-plugin** — Tweakpane folder button verification
- **pmat-material-export** — PMAT roundtrip visual fidelity screenshot
- **geometry-uv-preview** — multi-panel interactions, single-mesh UV layout
- **render-target-preview** — 3 panel downloads, multi-remove
- **custom-pipeline** — RenderTargetPreview panel collapse/expand/remove
- **tonemap-plugin** — saturation via Tweakpane textbox instead of evaluate

## Skill improvements that enabled this
- v3: Added research phase, interaction priority
- v4: Added dialog interception patterns
- v5: Added HTML dialog pattern (TweakpaneUiPlugin replacement), CRUD workflow rules
