# `stair` — direction

A spiral staircase and a Gothic arcade, built live by JSON commands. The film's argument: a handful
of generating commands (`lathe`, `sweep`), a live `array` and a `mirror` turn one hand-made part into
something that looks generated, and nothing is baked: every copy follows its master.

Format: 1920×1080, 30 fps, H.264 (faststart), about 2 min, rendered frame by frame on the GPU VM (Chromium on
ANGLE/Metal) by `demos/shared/film.mjs`. Everything on screen is the live viewer
(`examples/modelling-api`) running `demos/stair/build.mjs`; cards, captions and the command chip are
DOM overlays drawn by `record.mjs`. The command chip (top left) always shows the JSON of the command
that just ran, so the viewer sees that it is commands all the way down.

Camera language: the build's own camera views. `record.mjs` turns each jump into a 0.8 s eased move
(one `camera` command a frame; `camera {duration}` only animates saved views, see
`issues/open/modelling-tools/command-camera-duration-saved-views-only.md`) and holds each captured
shot for 1.4 s with its caption, so the cut list below is the build's capture list.

| # | Scene | What happens | Camera | Why | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | Title | "Cast iron and stone" card | — | Says what the next three minutes are | 3 s |
| 2 | References | Three panels: the Safety Stairways spiral (UKAA 24019) elevation and top view with the catalogue numbers; HABS sheet 8 with the bay, springing and crown | static | Opens on the evidence: every number later is checked against these | 7 s |
| 3 | The column | One `lathe` command; the whole column appears in a single shot | three-quarter, full height | One command, one part: the simplest case first | 4 s |
| 4 | One tread | Grid → polar grid (`vertices`), openings (`inset`, `deleteElements`), thickness (`solidify`), rounded openings (`bevel`, edges picked from `inspect`), nosing apron (`extrude`), collar (`lathe` + `join`) | close, over the tread; moves in with each step | The one part made by hand, so the array has something worth repeating | 14 s |
| 5 | The flight | The radial array's count climbs 2 → 23, one tread a frame, each copy turned 30° and lifted 8" | pulled back to the full stair, static while it grows | The money shot: one number on one modifier makes the stair | 10 s |
| 6 | Balusters, landing, handrail | `lathe` + the same array; the landing cast like a tread with balcony spindles on linear arrays; the handrail `sweep`s along the computed helix | full stair | The sweep follows the helix with its flat bar level (the `zUp` frame, Y-up since the fix) | 8 s |
| 7 | The arcade: one arch | Half a ring between two arcs (`primitive grid` + `vertices`), `solidify`, `mirror`, `bevel` into a moulding | square to the arch | The pointed arch is a computed profile, not a primitive | 8 s |
| 8 | One bay | Spandrel; string course loop-cut by `subdivide` and drawn back; clustered pier: lathes, a radial array of four shafts each joined to its capital by `bridgeEdgeLoops`; rib vault: groin surface + ribs `sweep`ed along the groins | three-quarter on the pier, then on the bay | Every remaining command earns its place in one bay | 14 s |
| 9 | The bays | Linear arrays grow 1 → 4 bays; a live mirror adds the far arcade; 3 and 5 bays, live | long three-quarter | Reactivity: one number changes the arcade | 12 s |
| 10 | Over the drawing | Orthographic, registered to HABS sheet 8 by its scale bar | square, orthographic | The check you can see | 3 s |
| 11 | Heroes | The stair, the arcade, both, inside the aisle under the ribs, up the stair from its foot, a tread detail | six stills, eased between | Look at it | 14 s |
| 12 | Wireframe and x-ray | Same frames as the heroes in wireframe, then x-ray | stair, arcade | Shows the topology: quads, copies, loop cuts | 8 s |
| 13 | Turntable | Both pieces, one slow orbit | 360° at 17 m | | 12 s |
| 14 | Split with references | Left half the catalogue photo, right half the model; then HABS sheet 8 and the arcade | two splits | Ends where it started | 12 s |
| 15 | End card | The command list | — | | 3 s |

Re-recorded on the GPU (2026-10-18) with a realism pass between the bays and the heroes: before/after on the "both
pieces" view - the stair in cast iron (`metal-dark`, cast relief), the arcade in tooled limestone, flagstone joints
on the aisle floor as `groove` strips. The dealer's photographs of the stair are not shown (all rights reserved);
the opening shows HABS sheet 8 (public domain) instead.

## Recording

`node demos/stair/record.mjs` on the VM (tpvm), pull `tmp/demo/stair/film/`, then `node demos/shared/report.mjs
demos/stair`. Holds are 1.2 s per capture, glides 0.9 s, section cards 1.5 s, the turntable 12 s; the sun's shadow
camera is sized by the film.
