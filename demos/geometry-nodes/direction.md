# Direction - "Geometry nodes, edited live"

**Format.** 1920 × 1080, 30 fps, H.264 (faststart), about 2 min, frame by frame on the GPU VM (Chromium on ANGLE/Metal)
by `record.mjs` with `demos/shared/film.mjs`, in the modelling editor (`examples/procedural-editor-assets`) with its
UI on screen.

**Idea.** Three geometry-nodes assets in the editor's modifier stack, each edited the way a person does it and then the
way an agent does it. Per asset:

1. Title card; the asset loaded as a `geometryNodes` modifier (`blendAsset` for the Blender files, `nodeGroup` for the
   DSL terrain), the load time in the caption, a 35° orbit.
2. Properties > Modifiers opened with the mouse; one input typed into its field and confirmed with Enter. The caption
   gives the real re-evaluation time measured in the page.
3. Four more input changes through the same `modifier update` command an agent sends, each with its time, a short
   orbit after each.

Order: Buildify (a building generator), the flower field (30 740 instances), then the terrain (our own DSL group).
Evaluation and render times go to `metrics.json`; a long evaluation is not shown as waiting, its time is on screen.

**Assets.** Buildify 1.0 (Pavel Oliva) and flower_scattering.blend (Blender Studio, CC0) are third-party: their renders
and this video are never committed (`plugins/procedural/tests/fixtures/ASSETS.md`). The terrain stills are ours and are.

**Re-recording.** Bundles in `tmp/bundles/` (see ASSETS.md), then `node demos/geometry-nodes/record.mjs` on the VM,
then `node demos/geometry-nodes/make-report.mjs`. This replaces `scripts/procedural-acceptance-video.mjs` for the launch
film (same assets, fields and timed inputs; that script and its report stay as the track-2 acceptance record).
