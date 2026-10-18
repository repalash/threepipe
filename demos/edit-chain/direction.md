# Direction - "30 edits, one mesh"

**Format.** 1920 × 1080, 30 fps, H.264 (faststart), about 1:15, rendered frame by frame on the GPU VM (Chromium on
ANGLE/Metal) by `record.mjs` with `demos/shared/film.mjs`.

**Idea.** The harness's main chain as a film: a 16-sided cylinder edited into a chess rook in 30 steps, one step every
1.8 s, while the camera makes one slow orbit (330°) so the merlons, the arrow slit and the mirrored half each come
round to face it. The look is Blender's edit mode: a clay surface with the master mesh's edges drawn over it
(hidden edges faint), so every step shows as what it did to the topology. Step 25 sets the material; the overlay goes
and the rook is shown shaded from there.

**On screen per step.** The step chip ("12 / 30 bevel the bottom rim: 3 segments, 0.04"), the step's claim as the
caption, the command bottom right, and its five scores top right (did, locality, manifold, undo, determinism) from
`results.json`. The commands are the resolved ones the harness recorded, so the film replays exactly what was scored.

**End.** A 9 s turntable of the finished rook, the whole run's summary (121 scored steps, controls caught), end card.

**Re-recording.** `npm run modelling:session -- demos/edit-chain/run.mjs --port 9479 --out tmp/edit-chain-session`
(scores, `results.json`), then `node demos/edit-chain/record.mjs` on the VM, then `node demos/edit-chain/make-report.mjs`.
