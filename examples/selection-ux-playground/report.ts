/**
 * The status report of the prototype, shown on the page (toolbar → Report) instead of in the chat.
 * It opens by itself once for each new {@link REPORT_VERSION}.
 */

export const REPORT_VERSION = '2026-10-27-r9'

const REPORT_HTML = `
<h1>Selection UX prototype <span>round 9 · 27 Oct 2026</span></h1>
<p class="lead">A Figma-like way to select, move and edit things in threepipe, for people who are not 3D experts.
Two pages run the same plugins: the <b>playground</b> (simple, light panels) and the <b>editor</b> (the tweakpane editor with
everything else). Code: branch <code>claude/figma-style-selection-ux-j74hh2</code> in repalash/threepipe,
folder <code>examples/selection-ux-playground/</code>. Ticket: <a href="https://ijewel3d.youtrack.cloud/issue/IJ-1052" target="_blank">IJ-1052</a>.</p>

<h2>New in round 9: everything tested again, polished</h2>
<p class="lead">Every feature was tested again on both pages, with the mouse and the keyboard, at 1300×800 and 1920×1000, light and dark.
About 70 problems were found; most are fixed, the rest are listed below the table. The main fixes:</p>
<table>
<tr><th>Area</th><th>What changed</th><th>Try it</th></tr>
<tr><td>Look</td><td>The inspector is a floating card like the layers panel (Figma UI3); one corner radius and shadow for all panels. The layers tabs fit; the layers menu is light like the toolbar menus.
The shortcut sheet is light, in four sections, with keys that do not wrap. In the editor the view gizmo is top-right and the fullscreen button is gone (Expand does it)</td><td>Select something; <kbd>?</kbd></td></tr>
<tr><td>Keyboard</td><td>Esc closes menus, the report, the splash and the shortcut sheet without deselecting. Menus work with the arrows, Enter and Space. With nothing selected, Tab reaches the toolbar.
Keys no longer reach the scene through an open dialog. F with nothing selected zooms to everything</td><td>Open a menu, <kbd>↓</kbd> <kbd>Enter</kbd>, <kbd>Esc</kbd></td></tr>
<tr><td>Toolbar</td><td>Fits a narrow editor (compact buttons). Play shows the real state and plays from where it is. Clicking an open menu's button closes it. Overlays switches no longer flicker;
its dot shows for every overlay that is off. Annotate and the pen cannot both be on. Add: one undo step, proper names, a visible orange line. Snapshot leaves out the grid and selection.
Clear the scene uses a styled confirm, clears the annotations too, and undo brings everything back. View mode hides the editing panels</td><td>Toolbar</td></tr>
<tr><td>Camera path</td><td>Enter on a dialog button presses that button (it used to animate). “+ New camera” and its animation are one undo step, and undo leaves its view.
“Its target” is kept. Each camera loads its own settings. The dialog and the chip sit under the toolbar, away from a path drawn below; the chip goes when you go on working</td><td>Pen, then the chip</td></tr>
<tr><td>Pen</td><td>Handles stay flat, so a path on the floor stays on it; a click that misses a surface lands on the floor (<kbd>Shift</kbd>: keep the last height). A crosshair, and its hint replaces the selection hints</td><td><kbd>P</kbd></td></tr>
<tr><td>Timeline</td><td>Go to start and scrubbing while playing land exactly (a stop takes a frame, which moved the time on). The clip of the selected object is outlined at once. The time stops at the end.
The bar no longer overlaps the notes panel or draws its end line outside</td><td>Play, ⏮</td></tr>
<tr><td>Video</td><td>Records in a background tab too: the recorder runs the frames itself, and a wake lock keeps the screen on. The first frame is right when the timeline was playing.
“Record again” keeps the settings; a note says when nothing moves</td><td>● Record, switch tab</td></tr>
<tr><td>Fixed files</td><td>The Studio environment and a splash sample pointed to missing files: the environment is replaced, the sample removed; a sample that fails now says so and the splash stays open</td><td>Shading → Studio</td></tr>
</table>
<p class="lead" style="font-size:13px">Still open: WebM files are one frame short (the muxer); a path drawn at the very bottom of the view can sit under the timeline bar;
UV views of a missing UV set show black; Background off shows black, not a checkerboard.</p>

<h2>Round 8 usability test: a camera along a bezier, on the timeline, to an MP4</h2>
<p>Before this round it took about 17 steps in 3 tabs: a line, a curve type change, 4 handle drags, a constraint with a typed object name,
the timeline turned on in the Animation tab, two ◆ keyframes at exact times — and then no way to make a video at all (threepipe had no recorder).
Now it is 3 steps and Record. Try it on either page:</p>
<ol>
<li><b>Draw the path.</b> Press <kbd>P</kbd> (or the pen in the toolbar). Click 4 or 5 points on the floor in front of the jewellery; on one point, press and drag to make the curve smooth. <kbd>Enter</kbd> finishes.</li>
<li><b>Animate a camera along it.</b> A chip says “Path 1 drawn · Animate a camera along it”: click it. (Also: right-click a path or a camera in Layers,
toolbar camera menu → “Animate a camera along a path…”, or “Camera path” in the timeline.)</li>
<li><b>Choose, then Animate.</b> Camera (or “+ New camera”), Path, <b>Lift the path</b> (1.2 m is preset when the path lies on the floor, so the camera is at eye height),
Look at (the centre of the scene, ahead along the path, or the camera's own target), Duration, Speed (constant, or ease in and out), Direction.
The view now looks through the camera and plays.</li>
<li><b>Adjust the timing.</b> The timeline bar at the bottom shows the violet clip “Product Camera · path”. Drag the clip to start later, drag its right edge to make it longer,
click or drag on the ruler to scrub, type the end time, loop on or off. Every change is one undo step.</li>
<li><b>Check the shot from outside.</b> “Product Camera view” in the bar (or <kbd>0</kbd>) goes back to your view. Select the camera or the path: violet dots show where the camera
goes and where it looks, with the start and end times.</li>
<li><b>Record.</b> ● Record in the bar or the toolbar: camera, size (HD, Full HD, square, vertical, 4K; a red frame on the view shows what is in the video), 24 / 30 / 60 fps,
Draft or Final (waits for anti-aliasing on every frame), MP4 or WebM, hide the path lines. It records frame by frame, so the timing is exact even when the scene is slow;
selection, grid and helpers are hidden. A preview and Cancel show while it runs; then the video plays in the dialog → <b>Download .mp4</b>.</li>
<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> removes the camera animation (and the lift) in one step.</li>
</ol>
<table class="rp-2">
<tr><th>Part</th><th>What is new</th></tr>
<tr><td>CameraPathPlugin</td><td><code>animateAlongPath(camera, path, {duration, look, reverse, ease, lift})</code>: the follow_path constraint plus a 0 → 1 keyframe track on its offset, one undo step;
the dialog, the chip after the pen, the path preview</td></tr>
<tr><td>TimelineBarPlugin</td><td>Slim timeline: play, to start, time / end, loop, camera view, Camera path, Record; animations as clips you drag and stretch; shows by itself when there are animations,
the toolbar button toggles it</td></tr>
<tr><td>VideoRecorderPlugin</td><td><code>record({fps, width, height, format, quality, camera})</code>: moves the timeline frame by frame, encodes with WebCodecs (H.264 MP4 or VP9 WebM),
muxes with mp4-muxer / webm-muxer; MediaRecorder in real time where WebCodecs is missing. Reusable, no UI</td></tr>
<tr><td>Library fixes (threepipe <code>src/</code>)</td><td>PopmotionPlugin: a timeline track did not follow a seek when it was added (or rebuilt) while the time stood still, so “scrub to 0 from the end” left the camera at the end.
follow_path: an object in a moved group was placed wrong (the world position was set as a local one)</td></tr>
</table>
<p class="lead" style="font-size:13px">Limits: MP4 needs WebCodecs (Chrome, Edge, Safari 17+, Firefox 130+); the muxer loads from jsdelivr on the first recording. In a background tab the recorder runs the frames itself, and a wake lock keeps the screen on. glTF animations (the editor page's GLTFAnimationPlugin) are not shown as clips in the bar yet. “Ahead” keeps the horizon level (no banking).
Keyframes are added with ◆ next to a field in the editor panels, not in the bar.</p>

<h2>New in round 8</h2>
<table>
<tr><th>You asked</th><th>What changed</th><th>Try it</th></tr>
<tr><td>Small, clean FPS / performance panel, as a plugin; show Energy Saver</td><td><b>PerfPanelPlugin</b>: an FPS pill in a corner (green, amber, red); click it for frame time (avg, p95, max), render CPU time, draw calls and triangles,
canvas size, GPU, memory and warnings. It warns when the frame rate is capped at about 30 (Chrome Energy Saver or battery saver; a page cannot read the setting itself,
so it detects the cap), when the laptop runs on battery, when WebGL runs in software, and whether the CPU or the GPU is the limit</td><td>Bottom-right pill</td></tr>
<tr><td>Editor: modes on the right with coloured icons</td><td>A vertical bar on the right with one icon and one colour per mode (Viewer blue, Interaction orange, Post-processing pink, Export green…),
like Blender's property tabs. Hover for the name; click the open mode again to hide the panel</td><td>Editor page, right edge</td></tr>
<tr><td>Colours in the light and camera icons</td><td>Cameras violet, sun amber, spot orange, bulb yellow, area light light-orange, ambient grey, plus a dot in the light's own colour</td><td>Look at the scene</td></tr>
<tr><td>Toolbar structure (like the gizmo / overlay menus of Unity and Blender); the toolbar font</td><td>One bar: tools (select, move, rotate, scale, pen, annotate) · Add · camera, shading, <b>Overlays</b> · Edit/View · focus, undo, redo · snapshot, save, ⋯.
Overlays is one menu with switches that stay open: grid, background, effects, icons, 3D widgets, annotations, outlines, names, sizes, smart guides, hints, performance.
The bottom button bar is merged into it (⋯ menu). The toolbar uses the page font (the tweakpane font)</td><td>Toolbar → Overlays (two circles)</td></tr>
<tr><td>Clean tweakpane theme</td><td>Two new tweakpane colour modes, <b>clean</b> and <b>clean-dark</b> (were figma and figma-dark: Figma is a trademark): Inter, 11 px, 24 px fields, small checkboxes, flat folders with a line, blue focus. The editor page starts in clean</td><td>Editor page</td></tr>
<tr><td>Rename “Current”; mode keys A–F did nothing</td><td>“Current” is now <b>Classic</b> (the threepipe default). Modes are numbered 1–7 and the number keys switch them (also in Classic), with a toast</td><td><kbd>1</kbd>…<kbd>7</kbd></td></tr>
<tr><td>Splash screen like the iJewel playground</td><td>Drop a file, click to choose one, or load a sample (jewellery demo, watch, helmet, horse, lines, empty). <kbd>Esc</kbd> or × closes it. Reopen: ⋯ → Open a file or sample</td><td>Reload the page</td></tr>
<tr><td>Selection lines behind annotations</td><td>The selection overlay is now above the annotation markers</td><td>Select an object with a marker</td></tr>
<tr><td>Move a light or box by exactly 5 on X</td><td>While you drag an object: press <kbd>X</kbd>, <kbd>Y</kbd> or <kbd>Z</kbd> to lock the axis (a coloured line shows it), type a number (<kbd>5</kbd>, <kbd>-2.5</kbd>) and press <kbd>Enter</kbd>.
Like Blender, but in the middle of a normal drag, so there is nothing new to learn first. The inspector fields also take math and relative values: <code>+5</code>, <code>*2</code>, <code>1/3</code></td><td>Drag the box, press <kbd>X</kbd> <kbd>5</kbd> <kbd>Enter</kbd></td></tr>
<tr><td>Duplicate again should repeat the offset</td><td>It was broken: the press on the copy hit the original behind it, which changed the selection and reset the duplicate tracker.
Now a press prefers the object that is already selected. Duplicate, move the copy, duplicate again: the third one gets the same offset</td><td><kbd>Ctrl</kbd>+<kbd>D</kbd>, drag, <kbd>Ctrl</kbd>+<kbd>D</kbd></td></tr>
<tr><td>Notes window lines did not scroll</td><td>The ruled lines now scroll with the text</td><td>Notes → type many lines</td></tr>
<tr><td>Pen tool for bezier lines</td><td><b>PenToolPlugin</b>: click to add points, drag to pull smooth handles, click the first point to close, <kbd>Backspace</kbd> removes the last point,
<kbd>Enter</kbd> or double-click finishes, <kbd>Esc</kbd> cancels. Points land on surfaces, or on a flat plane at the height of the last point. The result is a normal line object (one undo step), selected; a chip then offers “Animate a camera along it”</td><td><kbd>P</kbd> or the pen button</td></tr>
</table>

<h2>Round 7</h2>
<table>
<tr><th>You asked</th><th>What changed</th><th>Try it</th></tr>
<tr><td>Annotations in the 3D scene, saved in the .glb, with a camera view (like Sketchfab)</td><td><b>AnnotationsPlugin</b>: numbered markers on surfaces. Click one: the camera flies to its saved view and a card shows the title and text
(<code>**bold**</code>, <code>*italic*</code>, links, bullets; click the text to edit it). ‹ › and ← → go through them; Tour plays them one by one (View mode).
Better than Sketchfab: a marker is attached to its object and moves with it, it dims behind other objects, you can drag it to another spot,
“Update view” saves the current view, every edit is undoable. Saved in the .glb (viewer config) and restored on load.</td><td>Toolbar pin or <kbd>N</kbd>, then click a surface. Two examples are in the scene</td></tr>
<tr><td>Simple shapes: edit with dots like the lines</td><td>Geometry edit of a box, plane, circle, sphere, cylinder or torus: dots drag sizes along their axis (width, height, radius, tube…),
diamonds drag segment counts sideways. A wireframe shows the segments while you edit. One undo step per drag; <kbd>Shift</kbd> snaps</td><td>Double-click “Box” twice, or select it and <kbd>Enter</kbd></td></tr>
<tr><td>Use uiConfig in the geometry panel; close path did not work</td><td>The panel shows the generator's own uiConfig (the same fields as the editor's “Generation Params”: curve type, curve points, add point,
closed, tension…). Close path was a bug in the library: three.js keeps the segment count of the first render, so a line regenerated with more points
did not draw the new ones. Fixed in GeometryGeneratorPlugin</td><td>Edit “Spline”, tick close path</td></tr>
<tr><td>Lights should show a frustum</td><td>A selected light that casts shadows draws its shadow camera: the sun's shadow box (what its shadows cover), the spot's frustum</td><td>Select “Sun” or “Key Spot”</td></tr>
<tr><td>Move / Rotate / Scale should use the new UI</td><td>In the new modes <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> are tools of the selection UX: Move hides the scale and rotate handles;
Rotate shows the ring and dragging the object turns it; Scale shows corners and sides and dragging the object right/left scales it from its base
(<kbd>Alt</kbd>: centre). In the Classic mode (7) they are the classic gizmo</td><td><kbd>E</kbd>, drag the ring</td></tr>
<tr><td>Blueprint editor's material / environment overrides</td><td>“View as” menu: Shaded, Clay, Wireframe, Unlit, Depth, Normal, Normal World, Material ID, UV (again: next UV set);
Lights instead of the scene's (Day, Night, Studio, None); Environment instead of the scene's (Day, Night, Studio, Indoors, Outdoors).
Nothing in the scene changes: the overrides apply only while rendering, so export and the panels see the real scene</td><td>Toolbar → Shading (half-filled circle)</td></tr>
<tr><td>Same colours as the tweakpane theme</td><td>Toolbar, menus, layers and the geometry panel take the tweakpane colours (black, dark, blue, light, white) when it is on the page</td><td>Tweakpane → Color Mode</td></tr>
<tr><td>Less border radius in the toolbar</td><td>Bar 8 px, buttons 4 px, menus 6 px</td><td>—</td></tr>
<tr><td>Expand canvas, Space+drag, Shift+Space</td><td>Expand now fills the window in the editor too (the editor's CSS sized the canvas with <code>!important</code>);
Shift+Space reached the selection plugin first and was eaten; releasing Space no longer presses a focused button. Space+drag orbits (tested)</td><td><kbd>Shift</kbd>+<kbd>Space</kbd></td></tr>
<tr><td>Lines show as a rectangle</td><td>Fat lines (Line2) are instanced quads that only the line shader turns into lines. The G-buffer and shadows use line versions of their
materials (fine). Anything that draws the scene with one override material draws the raw quads: a big rectangle. Fixed here for “View as” and the
blueprint overrides (lines keep their own material) and for the outline (a line-shaped mask). Library proposal: line materials default to
<code>allowOverride = false</code>, or a line version of any override material</td><td>View as → Normal, with the curves in view</td></tr>
</table>

<h2>Round 6</h2>
<table>
<tr><th>You asked</th><th>What changed</th><th>Try it</th></tr>
<tr><td>Look through a camera, change the main camera</td><td>Like Blender's camera view. <kbd>0</kbd> looks through the selected camera (else the last one); <kbd>0</kbd> or <kbd>Esc</kbd> goes back.
Double-click a camera icon does the same. A bar on the view shows the camera, <b>Lock to view</b> (<kbd>L</kbd>: orbit and zoom move that camera, one undo step) and Exit.
<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>0</kbd> moves the selected camera to the current view (undoable). Also in the toolbar camera menu and the layers right-click menu.
Built on <code>activateMain()</code> and the camera's interactions; the editor camera stays as it was.</td><td>Select “Product Camera”, press <kbd>0</kbd></td></tr>
<tr><td>Lines and curves not visible</td><td>They were 1 px white lines on a white floor. Now 4 px, orange (Spline) and blue (Bezier)</td><td>Left side, “Curves”</td></tr>
<tr><td>“Cameras” group box in the centre</td><td>A group box now includes its lights and cameras (they have no geometry, so they were left out)</td><td>Layers → Cameras</td></tr>
<tr><td>No shadows when a light moves</td><td>The lights did not cast shadows, the ground was 8 units wide (the scene is 18), and the environment light was much stronger than the lights.
Now: sun, spot and fill cast shadows, the sun covers the whole scene, ground 26 units, environment 0.5, sun 8, spot 400. The playground has a ground too</td><td>Drag the sun or the bulbs</td></tr>
<tr><td>Toolbar look</td><td>Light, like the layers panel (dark theme as an option). Clusters instead of lines; solid blue only for the current tool,
soft blue for toggles; a caret on menu buttons and a dot when a view setting is not the default; tooltips with the shortcut; menus with check marks and key hints</td><td>Hover the toolbar</td></tr>
</table>

<h2>Round 5</h2>
<table>
<tr><th>You asked</th><th>What changed</th><th>Try it</th></tr>
<tr><td>Toolbar like the blueprint editor</td><td>One toolbar on top: selection mode, Select / Move / Rotate / Scale gizmo, gizmo space and size, Add menu
(shapes, lights, cameras, empties), camera switch, View as (clay, normals, wireframe, depth, UV checker), effects, widgets, grid,
background, Edit ↔ View, zoom, undo/redo, save .glb, expand canvas</td><td><kbd>V</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd>, <kbd>Shift</kbd>+<kbd>Space</kbd>, the + button</td></tr>
<tr><td>Hierarchy for all types</td><td>Layers panel tabs: Objects, Materials (colour swatch), Textures (thumbnail, size), Geometries (vertices, generator).
Each shows how many objects use it; open it to list them, hover it to highlight them in the view, click to select it,
double-click a geometry to edit it. Objects: Move up / down added (undoable)</td><td>Layers → Materials, hover a row</td></tr>
<tr><td>Light icon hover outlined things behind it</td><td>Hover over an icon now highlights only that light or camera</td><td>Hover the bulb icons</td></tr>
<tr><td>Could not drag lights and cameras</td><td>Fixed: a light has no size, and the move limit was 50× the size. Drag the icon to move it</td><td>Drag the “Warm Fill” bulb</td></tr>
<tr><td>Notes as a plugin, 2 tiers</td><td><b>NotesPlugin</b> (sticky note). “Scene” notes are saved inside the .glb (viewer config) and come back when
the file is loaded. “Page” notes stay in this browser (and on this test server). “+ Context” adds the time, the mode and the selection</td><td>Notes → Scene, then toolbar → Save .glb</td></tr>
<tr><td>Report on the page</td><td>This window. It opens once per round; the toolbar has a Report button</td><td>Toolbar → Report</td></tr>
<tr><td>Low FPS in the editor</td><td>Measured in your tab against the stock editor. See “Performance” below: the drops come from the panel rebuild on each selection change, not from the render</td><td>—</td></tr>
<tr><td>Materials had generic names</td><td>The scene materials have names now (Yellow Gold, Diamond, Ruby, …)</td><td>Layers → Materials</td></tr>
</table>

<h2>Performance: editor FPS</h2>
<p>Measured in your browser tab (Apple M4 Pro, 120 Hz screen, pixel ratio 2), same build, same settings.
“Stock” is the normal tweakpane editor (<code>examples/tweakpane-editor</code>); “ours” is the selection UX editor.</p>
<table>
<tr><th>Test</th><th>Stock editor</th><th>Our editor</th></tr>
<tr><td>Idle</td><td>120 fps, 0 renders</td><td>120 fps, 0 renders</td></tr>
<tr><td>Orbit</td><td>111–120 fps</td><td>112–120 fps</td></tr>
<tr><td>Orbit with a selection</td><td>120 fps</td><td>114–120 fps (p95 10 ms)</td></tr>
<tr><td>Drag an object / hover sweep</td><td>—</td><td>115–120 fps</td></tr>
<tr><td>Render time per frame (GPU synced)</td><td>0.6 ms</td><td>1.4 ms (bigger scene + outline mask pass ≈ 0.2 ms)</td></tr>
<tr><td>One selection change</td><td>≈ 15 ms</td><td>16–42 ms</td></tr>
</table>
<ul>
<li><b>Our overlay</b> costs about 0.4 ms of script per frame while the camera moves (SVG box, icons, labels). The outline costs about 0.2 ms of GPU.</li>
<li><b>Frame drops come from a selection change.</b> The editor rebuilds its tweakpane panels for the new object (≈ 15 ms, 2 frames at 120 Hz).
Our Layers panel adds ≈ 2.5 ms. Next step: update only the changed rows, and build the tweakpane panel lazily.</li>
<li>A single stall of 150–200 ms shows up now and then when motion starts after a pause. The stock editor has it too, and no shader compiles at that time.</li>
<li>Fixed in this round: the snap search at drag start walked every object tree once per object; a media query was read every frame.</li>
<li>If you see low FPS on another machine, tell me which action (orbit, hover, drag, select) and the machine; I will measure that case.</li>
</ul>

<h2>What you can edit in the scene</h2>
<ul>
<li><b>Curves</b> group (left): <b>Spline</b> and <b>Bezier</b>. Select one, then double-click it again or press <kbd>Enter</kbd>:
drag the square points; the Bezier shows its tangent lines. <kbd>Esc</kbd> when done.</li>
<li><b>Generated Shapes</b> group (right): <b>Torus</b>, <b>Box</b>, <b>Cylinder</b>. Same way in: a panel shows the generator
parameters (radius, tube, segments…). Drag a name to scrub, or type.</li>
<li><b>Lights</b>: Sun, Key Spot, Warm Fill. <b>Cameras</b>: Product Camera. Click the icon; drag the dot at the end of the dashed line to aim it.</li>
<li>Everything else (ring, earrings, pendant, gift box, watch) is plain meshes and groups: move, scale, rotate, group, nudge.</li>
<li>In the <b>editor</b> page, geometry editing also selects the geometry in the Picker panel on the right, so its
“Generation Params” show there too.</li>
</ul>

<h2>Quick tour</h2>
<ol>
<li>Click the ring: the whole ring is selected. Double-click: the part. <kbd>Esc</kbd>: back up.</li>
<li>Drag it: it slides on the floor (grid shows). Press <kbd>Tab</kbd> while dragging for the front wall, the side wall, or facing you.</li>
<li>Drag a corner: uniform scale. Just outside a corner: rotate. <kbd>Shift</kbd> snaps.</li>
<li>Toolbar → <kbd>W</kbd>: the classic 3D gizmo on the same selection. <kbd>V</kbd> takes it away.</li>
<li>Toolbar → mode button, or the keys 1 to 7: 6 (Focus) dims the rest.</li>
<li>Toolbar → View: what a visitor sees. Edit brings the tools back.</li>
</ol>

<h2>Earlier rounds</h2>
<ul>
<li><b>Round 1</b>: 4 looks (2D box, 3D box, brackets, hybrid), group drill-in, marquee, hotkeys, direct move/scale/rotate, smart guides, inspector.</li>
<li><b>Round 2</b>: pipeline outline (mask pass + screen pass): outer outline, part lines, dashed where hidden, tint, dim the rest.</li>
<li><b>Round 3</b>: plane indicator, new layers panel (lock, rename, drag to reparent, search, lock editing), editor page.</li>
<li><b>Round 4</b>: one undo step per held arrow key, XY/YZ planes, arrow keys in the layers list, virtual list (2,000+ objects),
modes / saved settings / hints as plugin options.</li>
<li><b>Round 4b</b>: lights and cameras overlay (icons, aim, cone, frustum), geometry editing (curve points, generator parameters).</li>
</ul>

<h2>Known limits</h2>
<ul>
<li>The test link is a tunnel from a cloud session; it can stop (bug <a href="https://ijewel3d.youtrack.cloud/issue/IJ-1055" target="_blank">IJ-1055</a>).
Page notes are also kept in your browser.</li>
<li>Only generated shapes have parameters; imported meshes show their vertex count. Plain (not generated) lines have no point editing yet.</li>
<li>“View as” draws widgets and lines with the same material too.</li>
<li>Tested in headless Chromium with a software GPU; not yet on touch devices.</li>
</ul>

<h2>Open questions for you</h2>
<ul>
<li>Which look and which rotate style should be the default?</li>
<li>Should dragging empty space orbit (now) or box-select (Figma)?</li>
<li>Toolbar: keep everything on one bar, or move view options (camera, view as, effects, grid, background) into one “View” menu?</li>
<li>Next step: split into PRs (selection plugin, outline plugin, layers panel, toolbar, notes) — in this order?</li>
</ul>
`

export function showReport(show = true) {
    injectStyles()
    let el = document.getElementById('sux-report')
    if (!el) {
        el = document.createElement('div')
        el.id = 'sux-report'
        el.innerHTML = `<div class="rp-card"><button class="rp-x" title="Close (Esc)">×</button>${REPORT_HTML}</div>`
        document.body.appendChild(el)
        el.addEventListener('click', e => {
            if (e.target === el || (e.target as Element).classList.contains('rp-x')) showReport(false)
        })
        // the open report has the focus and the keys (data-own-keys): Esc closes it, nothing reaches the scene
        el.tabIndex = -1
        el.dataset.ownKeys = ''
        el.setAttribute('role', 'dialog')
        el.setAttribute('aria-label', 'Prototype report')
        el.addEventListener('keydown', e => {
            if (e.key === 'Escape') showReport(false)
            e.stopPropagation()
        })
    }
    el.classList.toggle('show', show)
    if (show) el.focus({preventScroll: true})
    else if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    if (!show) {
        try {
            localStorage.setItem('sux-report-seen', REPORT_VERSION)
        } catch (e) {
            // private mode
        }
    }
}

/** Open the report once for each new version */
export function showReportIfNew() {
    let seen = ''
    try {
        seen = localStorage.getItem('sux-report-seen') || ''
    } catch (e) {
        seen = ''
    }
    if (seen !== REPORT_VERSION && !new URLSearchParams(location.search).has('noreport')) showReport(true)
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
#sux-report { position: fixed; inset: 0; z-index: 3000; background: rgba(15,17,21,.45); display: none; align-items: flex-start; justify-content: center; overflow: auto; padding: 40px 16px; box-sizing: border-box; }
#sux-report.show { display: flex; }
#sux-report .rp-card { position: relative; max-width: 860px; width: 100%; background: #fff; color: #1e1e1e; border-radius: 14px; padding: 28px 32px 32px;
  box-shadow: 0 20px 60px rgba(0,0,0,.3); font: 13px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; box-sizing: border-box; }
#sux-report h1 { font-size: 20px; margin: 0 0 8px; }
#sux-report h1 span { font-size: 12px; font-weight: 400; color: #757575; margin-left: 8px; }
#sux-report h2 { font-size: 14px; margin: 22px 0 8px; }
#sux-report .lead { color: #444; margin: 0 0 4px; }
#sux-report table { width: 100%; border-collapse: collapse; font-size: 12px; }
#sux-report th { text-align: left; color: #757575; font-weight: 500; border-bottom: 1px solid #e6e6e6; padding: 6px 8px; }
#sux-report td { border-bottom: 1px solid #f0f0f0; padding: 8px; vertical-align: top; }
#sux-report td:first-child { font-weight: 500; width: 22%; }
#sux-report td:last-child { width: 24%; color: #444; }
#sux-report table.rp-2 td:last-child { width: auto; color: inherit; }
#sux-report ul, #sux-report ol { margin: 0; padding-left: 20px; }
#sux-report li { margin: 4px 0; }
#sux-report code { background: #f2f2f2; border-radius: 4px; padding: 1px 4px; font-size: 12px; }
#sux-report kbd { font: inherit; font-size: 11px; background: #f2f2f2; border: 1px solid #e0e0e0; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
#sux-report a { color: #0d99ff; }
/* stays in view while the report scrolls */
#sux-report .rp-x { position: sticky; top: 0; float: right; margin: -16px -20px 0 8px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: #f2f2f3; font-size: 20px; color: #555; cursor: pointer; line-height: 1; z-index: 1; }
#sux-report .rp-x:hover { background: #e6e6e8; }
#sux-report:focus { outline: none; }
@media (max-width: 700px) { #sux-report table:not(.rp-2) td:last-child { display: none; } }
`
    document.head.appendChild(st)
}
