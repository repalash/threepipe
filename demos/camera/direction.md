# Direction - "Canon EOS 5D Mark IV + EF 24-105mm f/4L: the build story"

**Format.** 1920 × 1080, 30 fps, H.264 (faststart), about 1:30. Recorded by `record.mjs` on the GPU VM (Chromium on
ANGLE/Metal) with `demos/shared/film.mjs`: every frame is rendered and captured on purpose, so camera moves are smooth
and a slow command never shows as a freeze; command times are measured and reported, not shown as waiting.

**What is on screen.** The page is `examples/modelling-api` reduced to its viewport. Every change to the model is one
of the 220 commands from `build.mjs` arriving through `ModellingPlugin.run`; the last four are listed bottom right as
they land. Overlays that are not model commands: title cards, the step chip, captions, the measurement drawing over the
photograph, the red cage lines (a projected line drawing of `inspect {detail}`'s edges) and the clay grey of the build
chapters (`scene.overrideMaterial`).

**Story.** The realism workflow, in its order, so the film doubles as the SKILL's "Realism kit" section:

| # | Chapter | What happens | Camera | Why |
| --- | --- | --- | --- | --- |
| 0 | Open | The Commons photograph of the exact pairing, title card over it | still | The subject before any geometry |
| 1 | Measure | The level front photograph at 0.110 mm/px; the published 150.7 × 116.4 mm, the EF throat (54 mm) and the ISO 518 shoe drawn onto it one by one; the measurement set as a panel | still | Numbers first: the SKILL's step 1 |
| 2 | Block out cages | Lens lathes, then the body as a 64-point cage fitted to the measured outline; the cage drawn in red, then seen square-on | slow orbit, then a long-lens front view | Proportions are fixed here |
| 3 | Subdivision | `subsurf` level 2 smooths the body under its cage; Manifold booleans cut the monitor, top LCD and port recesses; the grip and the creased prism go through the same cage → subsurf step; shoe, shutter, eyepiece, mount, then every number measured back | front three-quarter, orbit round to the rear | The limit surface, and that cuts go into the smooth body |
| 4 | Parts | 42 `part`s (dials, buttons, knurled rings, the thumb pad, eyecup, lugs) replace the hand-made ones | rear three-quarter, slow orbit | Recurring components from a library |
| 5 | Grooves | Panel lines round the port doors and the monitor; shading by angle and weighted normals | close on the +x side, then the rear | Seams are what make a shell read as assembled |
| 6 | Materials | UVs at the relief tile size; clay off; leather, rubber, plastics, metal and coated-glass presets | the grip side, orbit and dolly in | The reveal: form first, surfaces after |
| 7 | Prints | Decals: word marks, the monitor screen, legends, the mode dial, the lens prints (wrapped and embossed) | rear, top, lens front | Markings last |
| 8 | Final | Model metrics panel, a 360° turntable, then the photograph and the model side by side, end card | hero view, turntable | The result against the thing it was built from |

**Re-recording.** `node demos/camera/build.mjs && node demos/camera/record.mjs` (on the VM through `tpvm`), pull
`tmp/demo/camera/film/`, then `node demos/shared/report.mjs demos/camera`. The photographs are read from `refs/`
(not committed; `refs/SOURCES.md`). `--views` renders the storyboard's camera positions on the finished model only.
