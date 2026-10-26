/**
 * The status report of the prototype, shown on the page (toolbar → Report) instead of in the chat.
 * It opens by itself once for each new {@link REPORT_VERSION}.
 */

export const REPORT_VERSION = '2026-10-26-r6'

const REPORT_HTML = `
<h1>Selection UX prototype <span>round 6 · 26 Oct 2026</span></h1>
<p class="lead">A Figma-like way to select, move and edit things in threepipe, for people who are not 3D experts.
Two pages run the same plugins: the <b>playground</b> (simple, light panels) and the <b>editor</b> (the tweakpane editor with
everything else). Code: branch <code>claude/figma-style-selection-ux-j74hh2</code> in repalash/threepipe,
folder <code>examples/selection-ux-playground/</code>. Ticket: <a href="https://ijewel3d.youtrack.cloud/issue/IJ-1052" target="_blank">IJ-1052</a>.</p>

<h2>New in round 6</h2>
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
<li>Toolbar → mode button: try A to F. F (Focus) dims the rest.</li>
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
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && el!.classList.contains('show')) showReport(false)
        })
    }
    el.classList.toggle('show', show)
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
#sux-report ul, #sux-report ol { margin: 0; padding-left: 20px; }
#sux-report li { margin: 4px 0; }
#sux-report code { background: #f2f2f2; border-radius: 4px; padding: 1px 4px; font-size: 12px; }
#sux-report kbd { font: inherit; font-size: 11px; background: #f2f2f2; border: 1px solid #e0e0e0; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
#sux-report a { color: #0d99ff; }
#sux-report .rp-x { position: absolute; right: 14px; top: 12px; border: 0; background: transparent; font-size: 22px; color: #757575; cursor: pointer; line-height: 1; }
@media (max-width: 700px) { #sux-report td:last-child { display: none; } }
`
    document.head.appendChild(st)
}
