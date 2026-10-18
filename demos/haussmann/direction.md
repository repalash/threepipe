# Direction: "Haussmann, by command"

A film of about two and a half minutes (hard limit 3:00), 1280×720 (or 1920×1080), recorded by
`record.mjs`. The build runs live in the page; every shot below is a `shot()` in `record.mjs` and is
kept at real speed, and the building work between shots is time-lapsed to at most 1.6 s, so the cut
is the same length on a slow machine and a fast one.

**The idea.** Start from what an architect of 1870 would have had on the desk - a street photograph of
the type and the engraved elevation at 1:100 - and show the building rising out of those drawings,
part by part, the way it was specified: storey lines, openings, cornices, the 45° roof the 1859
decree allowed, the balconies, the dormers and chimneys. Then let the camera walk round the finished
block, strip it to wireframe and x-ray, and put it back beside its references.

**Look.** Warm limestone against a pale Paris sky; captions in a serif face with a brass rule; the
technical note (which commands) in small monospace under each caption, so the film doubles as an API
tour. No music is required; the cut is designed to read silent.

**Camera language.** Slow orbits (5-8 s for a quarter turn) at the building's mid-height while it
is being built; eye-level (1.7 m) street views for the finished building; orthographic only when the
model is compared with the drawing. Moves are eased by the `camera {duration}` command; nothing cuts
mid-move.

## Shot list

| # | Shot | What is seen | Why | Length |
| --- | --- | --- | --- | --- |
| 1 | **Title over photograph** | Full-bleed street photograph of a Haussmann corner (rue Monge, Thbz, CC BY-SA). Title "Haussmann, by command". | Opens on the real thing: the type everybody recognises. | 6 s |
| 2 | **The elevation plate** | Daly's 1870 engraving of N° 77 bd de Sébastopol on paper ground, title and architect. | Names the specific building and the drawing every dimension comes from. | 7 s |
| 3 | **References registered** | The elevation as a calibrated plane, orthographic, then the 1:200 plan lying under the site. Captions give the calibration (72.8 px/m). | Shows that the drawings are placed at measured scale, not traced by eye. | 2 × 4.5 s |
| 4 | **Blockout** | The plan outline extruded to the first floor (iso). Time-lapse of the remaining storey extrudes, then a wireframe hold: every bay is a quad. Quarter orbit from 35° to 125°. | The whole method in one move: plan → storeys → grid of bays. | 4.5 + 4.5 + 7 s |
| 5 | **Openings** | 105 windows and the shop fronts appear (time-lapse), then a capture hold and a slow dolly along the boulevard front at second-floor height. | Inset → extrude → inset → separate is the repeated gesture of the whole façade. | 4.5 + 6 s |
| 6 | **Cornices** | The main cornice and string courses pushed out; camera on the lower cut corner at cornice height, moving round it. | The region inset mitres round a 38° corner on its own: the reason to build bands this way. | 4.5 + 6 s |
| 7 | **The roof** | Mansard by inset; a long-lens side view along the boulevard showing the 45° brisis in silhouette, then pull back to a high three-quarter. | The 1859 rule made visible; the numbers on screen. | 4.5 + 7.5 s |
| 8 | **Balconies** | The 2nd-floor balcony and its railing; time-lapse of the 4th and 5th; low orbit round the cut corner under the balconies. | The live curve array: one 30 cm module running round two corners. | 4.5 + 7.5 s |
| 9 | **Balconettes, dormers, chimneys** | Balconettes and guards on every bay; the dormer master alone, then the dormers on their live arrays; a pass along the roofline to the chimney stacks. | Repetition done by the API (duplicate, live array), not by hand. | 4.5 + 4.5 + 4.5 + 6.5 + 3 s |
| 10 | **The street** | Pavement, road and the neighbour; street-level hero view from the rue Greneta corner, 1.7 m eye height, 45° lens. | The first view a passer-by would have. | 4.5 + 5.5 s |
| 11 | **Checks card** | A table over the model: each dimension measured from the model against the drawing. | Proof, not a claim: the model is to scale. | 7 s |
| 12 | **Turntable** | A full 360° orbit of the finished, shaded model at 24 m height. | The reward shot. | 22 s |
| 13 | **Wireframe** | Same orbit continued in wireframe. | Topology: quads where Blender would keep them. | 5 s |
| 14 | **X-ray** | All objects at 28 % opacity, orbit continued. | The recesses, the roof's two slopes, the balcony slabs inside the railings. | 5 s |
| 15 | **Over the elevation** | Orthographic, registered to the 1870 elevation, wireframe over the engraving. | The registration check, as a picture. | 4.5 s |
| 16 | **Split with the references** | Left half: the street photograph; right half: the model from the same corner at street level. Then left: the 1870 elevation; right: the model's orthographic front. | Reference and result side by side, the way the report page shows them. | 5.5 + 4.5 s |
| 17 | **End card** | Second street photograph (Flyer84, CC BY), checks passed, object and command counts. | Closes on the type again, with the numbers. | 4.5 s |

Time-lapsed building between shots: about 25 stretches of at most 1.6 s, 35-40 s in all. Total about
2:40.

## Reference images on screen

- Shots 1 and 16: `refs/photo-rue-monge-corner-thbz.jpg` (Thierry Bézecourt, CC BY-SA 3.0).
- Shots 2 and 16: `refs/daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg` (Public Domain Mark).
- Shot 3 and 15: the same elevation and `refs/daly-1870-m2-pl3-plans-77-bd-sebastopol.jpg` as calibrated
  reference planes in the scene.
- Shot 17: `refs/photo-typical-paris-corner-7e-flyer84.jpg` (Flyer84, CC BY 3.0).

## Recording

```bash
npm run vite -- --host 0.0.0.0 --port 9371 --strictPort &      # serves the page and the refs
node demos/haussmann/record.mjs                                # local SwiftShader, writes video.webm
node demos/haussmann/record.mjs --ws ws://<mac>:<port>/<id> \
    --url http://9371.threepipe.aibox.localhost/examples/modelling-api/index.html --size 1920x1080
```

SwiftShader renders a few frames a second at 1280×720, so camera moves in a local recording are
jerky; the timing and framing are right, and a GPU browser (`--ws`) gives the smooth version of the
same cut.
