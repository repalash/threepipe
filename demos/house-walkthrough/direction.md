# Direction - "A house, through the editor"

**Format.** 1280 × 720, H.264 (faststart), about 3 min per keymap. A real-time screen recording (CDP screencast,
`demos/shared/screencast.mjs`) of `drive.mjs` building a low-poly house in `examples/modelling-editor` with real
keyboard and mouse input through Playwright, on the GPU VM (Chromium on ANGLE/Metal). Unlike the other films this one
is not rendered frame by frame: the input is the subject, so it runs in real time; holds over 1.5 s are cut.

**Idea.** A first-time user's path: the welcome ("Have you used Blender?"), selecting the cube, edit mode, walls by
extrude, loop cuts for the ridge, door and windows by inset and extrude (by keys, from the right-click Face menu, from
the tool shelf), a knife cut for the porch, a chimney, bevel, undo/redo, shade smooth, object mode, save and reopen.
The overlays (cursor dot, pressed keys, step card) are the demo's own; everything else is the editor.

**Two runs.** The same storyboard with the Blender keymap (`video.mp4`, `video-blender.mp4`) and the Design keymap
(`video-design.mp4`, Figma/trackpad-style keys).

**Re-recording.** Serve the repo (`node_modules/.bin/ws -d . -p 9374`), then `node demos/house-walkthrough/drive.mjs
--keymap both` on the VM, then `node demos/house-walkthrough/build-report.mjs`. UX findings are in `ux-findings.md`.
