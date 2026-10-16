# Direction — "Canon EOS 5D Mark IV, to scale, in JSON commands"

**Format.** 1280 × 720, under 3 minutes, no sound. Recorded by `record.mjs`, which runs `build.mjs`
live in the modelling example page: every frame of geometry is a real command arriving. The
storyboard below is the `DIRECTION` table in `record.mjs`, keyed by the `beat()` calls in the build.

**Tone.** A product film, not a screen recording. Dark title cards with one line and a sub-line;
the model on a light studio grey; a single red accent (the L-series ring) for rules and the split.
Cuts on section changes, slow drifts inside a section, nothing faster than the eye can follow.

**Why this order.** It is the order a modeller works in, and it lets the hardest-looking surface
(the knurled lens) arrive first, while the audience is still paying full attention. The body
follows from block to detail. Only after it is finished do we put it against the photographs —
the payoff is earned.

| # | Scene | Beat | Shot | What it shows, and why | ≈ s |
|---|---|---|---|---|---|
| 1 | Cold open | `references` | Full-frame product photograph (`refs/hero-5d4-ef24-105.jpg`), title card over it, card fades to leave the photo | The subject before any geometry, so the audience knows what "right" looks like | 7 |
| 2 | Calibrate | `references` | Card "Calibrate". Orthographic cuts: front photo on its plane, back photo, the lens elevation | Each plane is placed by two points and a published distance (150.7 mm, 107 mm); the caption gives the px/mm. Scale is measured, not eyeballed | 8 |
| 3 | Lathe the lens | `lens` | **One continuous shot**: fixed three-quarter on the lens axis, slow 38° orbit, no cuts. Mount, barrel, focus ring, zoom ring appear; the ribs cut in; red ring, front element, distance window, switches | The lathe is the hero operation of the piece. Holding one framing makes each profile visibly add to the last; the orbit shows the knurling catching light | 26 |
| 4 | Block, bevel, cut | `body` | Rear three-quarter, slow drift. A box appears, its corners round (6 segments), its edges round (3), then the monitor recess is cut and sunk | Shows bevel doing the work that makes a box read as a product, then bisect + inset as surgical detail on a flat face | 12 |
| 5 | Sweep the grip | `grip` | Front-left three-quarter, static | The grip is a measured section swept up the body; a static frame makes its silhouette the subject | 5 |
| 6 | Prism, top LCD, hot shoe | `top` | High front three-quarter | The prism's sloped faces, the top LCD sunk into the plate, the shoe's ISO channel | 6 |
| 7 | Dials and buttons | `controls` | Rear, slow 30° drift | Lathed dials with inset knurling, a button arrayed down the column at the measured pitch | 10 |
| 8 | Eyecup | `eyecup` | Close on the eyepiece from above-behind | A section swept round a closed path - the only closed sweep in the build | 4 |
| 9 | Mount and lugs | `mount` | Front three-quarter | The EF bayonet at its published 54 mm, and the strap lug mirrored live to the far side | 5 |
| 10 | Assembled | `assembled` | The hero photograph's viewpoint, held | First full look at the finished product, in materials | 3 |
| 11 | Checks | (log) | Same frame; the check log on screen, line by line | Every published dimension measured off the model, with its delta. Fails would stop the build | 4 |
| 12 | Against the photographs | `compare` | Orthographic: model over the front photo, model alone; back; side over the lens elevation; top | The registered overlays are the proof of scale. Alternating overlay / model-only lets the eye find the differences | 12 |
| 13 | Close-ups | `closeups` | Corners from behind (material, then every mesh edge as a thin red strut), lens ribs with their edges, mode dial in material then with edges, x-ray of the shell | The edge overlay shows *how* the round corners and knurls are made - real geometry, quads, not a texture. (Built with `duplicate` + `wireframe`, because the viewport's wireframe mode draws triangles - see the issue) | 12 |
| 14 | Turntable | (end) | 360° orbit, 16 s, long lens | The product, all sides, uninterrupted | 17 |
| 15 | Split | (end) | Photograph left, model right from the same viewpoint, red rule between | The closing comparison: the build against the thing it was built from | 6 |
| 16 | End card | (end) | Command count, failures, checks passed; where the files are | | 4 |

Total ≈ 1 min 30 s of cards, holds and the ending, plus command time (`--pace`, 150 ms after each
edit, plus however long the renderer takes). Inside a continuous shot (`lens`, `body`, `grip`, `top`,
`controls`, `eyecup`, `mount`, `hero`) the build's own still-framing `camera` commands are ignored, so
the director's camera holds. If the recording runs past `--max-seconds` (178 by default) -
SwiftShader under load does - it is time-lapsed to fit, and `record.mjs` prints the factor.

**Re-recording on a GPU.** `node demos/camera/record.mjs --ws <playwright endpoint>` runs the same
storyboard on a remote browser; SwiftShader is slow enough that drifts step rather than glide, which
the GPU run fixes without any change to the script.
