import type {ThreeViewer} from 'threepipe'
import tippy from 'tippy.js'
import type {EditorCameraPlugin} from './EditorCameraPlugin'

const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'

// the look of the PerfPanelPlugin pill and card (src/plugins/ui/PerfPanelPlugin.css): size, font, radius, colours, and
// the colours of the tweakpane theme when it is on the page.
// Layers (CONTRIBUTING, UI layers): the pill and its card are viewer UI (100-199), the frame a canvas overlay (below 50).
const CSS = `
.ecu-root {
  --ecu-bg: #ffffff; --ecu-fg: #1e1e1e; --ecu-dim: #8a8f97; --ecu-line: #e9eaec; --ecu-hover: #f2f3f5;
  --ecu-view: #0d99ff; --ecu-sync: #14ae5c; --ecu-amber: #f5a524;
  --ecu-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10);
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 120; color: var(--ecu-fg); user-select: none;
  font: 500 11px/1.35 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); -webkit-font-smoothing: antialiased;
}
body[class*="tpTheme-"] .ecu-root {
  --ecu-bg: var(--tp-base-background-color, #1c2026); --ecu-fg: var(--tp-container-foreground-color, #f0f0f0);
  --ecu-dim: var(--tp-monitor-foreground-color, #9a9a9a); --ecu-line: var(--tp-container-border-color, rgba(255,255,255,.14));
  --ecu-hover: var(--tp-button-background-color-hover, rgba(255,255,255,.09));
}
body.tpTheme-black .ecu-root, body.tpTheme-dark .ecu-root, body.tpTheme-blue .ecu-root, body.tpTheme-clean-dark .ecu-root {
  --ecu-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.3);
}
.ecu-root button { font: inherit; color: inherit; border: 0; margin: 0; cursor: pointer; }
.ecu-root button:focus-visible { outline: 2px solid var(--ecu-view); outline-offset: 1px; }
.ecu-pill {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: 6px;
  background: var(--ecu-bg); box-shadow: var(--ecu-shadow); white-space: nowrap;
}
.ecu-pill:hover { background: var(--ecu-hover); }
/* a move in View that is not saved: an amber dot on the corner, as the warning of the perf pill */
.ecu-moved .ecu-pill::after {
  content: ''; position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--ecu-amber); box-shadow: 0 0 0 1.5px var(--ecu-bg);
}
.ecu-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ecu-dim); }
.ecu-view .ecu-dot { background: var(--ecu-view); }
.ecu-view.ecu-sync .ecu-dot { background: var(--ecu-sync); }
.ecu-pill kbd { font: inherit; font-size: 10px; line-height: 14px; padding: 0 4px; border-radius: 3px; color: var(--ecu-dim); background: var(--ecu-hover); }
/* the card under the pill: on hover, on keyboard focus, and open (a tap on a touch screen) */
.ecu-drop { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); padding-top: 6px; visibility: hidden; opacity: 0;
  transition: opacity .12s ease .15s, visibility 0s linear .27s; }
@media (hover: hover) { .ecu-root:hover .ecu-drop { visibility: visible; opacity: 1; transition-delay: .06s, 0s; } }
.ecu-root:has(:focus-visible) .ecu-drop, .ecu-open .ecu-drop { visibility: visible; opacity: 1; transition-delay: 0s, 0s; }
.ecu-card { width: 224px; max-width: calc(100vw - 16px); box-sizing: border-box; padding: 6px; border-radius: 6px; background: var(--ecu-bg); box-shadow: var(--ecu-shadow);
  display: flex; flex-direction: column; gap: 6px; }
.ecu-shot-box { position: relative; aspect-ratio: 16 / 10; border-radius: 4px; overflow: hidden; background: var(--ecu-hover); }
.ecu-shot { display: block; width: 100%; height: 100%; padding: 0; background: transparent; }
.ecu-shot canvas { display: block; width: 100%; height: 100%; object-fit: cover; }
.ecu-shot:hover canvas { filter: brightness(1.06); }
.ecu-stale .ecu-shot canvas { opacity: .5; }
.ecu-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 0 12px; text-align: center; color: var(--ecu-dim); pointer-events: none; }
.ecu-cap { position: absolute; left: 6px; bottom: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; }
.ecu-pin { position: absolute; top: 6px; right: 6px; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px 0 6px; border-radius: 6px;
  background: rgba(0,0,0,.55); color: #fff !important; }
.ecu-pin svg { width: 12px; height: 12px; }
.ecu-pin:hover { background: rgba(0,0,0,.7); }
.ecu-pin[aria-pressed="true"] { background: var(--ecu-sync); }
.ecu-pin[aria-pressed="true"] svg { fill: currentColor; }
.ecu-seg { display: flex; padding: 2px; border-radius: 6px; background: var(--ecu-hover); }
.ecu-seg button { flex: 1; height: 22px; border-radius: 4px; background: transparent; color: var(--ecu-dim); }
.ecu-seg button[aria-pressed="true"] { background: var(--ecu-bg); color: var(--ecu-fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.ecu-seg button:hover { color: var(--ecu-fg); }
.ecu-acts { display: flex; gap: 6px; }
.ecu-acts button { flex: 1; height: 24px; border-radius: 5px; background: var(--ecu-hover); }
.ecu-acts button:hover { filter: brightness(.96); }
.ecu-acts .ecu-primary { background: var(--ecu-view); color: #fff; }
.ecu-hint { color: var(--ecu-dim); font-weight: 400; padding: 0 2px; }
.ecu-frame { position: absolute; inset: 0; z-index: 40; pointer-events: none; box-shadow: inset 0 0 0 3px var(--ecu-frame, #0d99ff); display: none; }
.ecu-frame.ecu-on { display: block; }
.ecu-frame.ecu-sync { --ecu-frame: #14ae5c; }
/* a touch screen: no keyboard (no key hint), and larger targets */
@media (hover: none) { .ecu-pill kbd { display: none; } }
@media (pointer: coarse) { .ecu-pill { height: 28px; padding: 0 10px; } .ecu-seg button, .ecu-acts button { height: 30px; } .ecu-pin { height: 26px; } }
/* the classic page on a tablet: its mode tabs are over the top of the canvas */
@media (max-width: 920px) { body:not(.lay-frame) .ecu-root { top: 4.25rem; } }
/* the classic page on a phone: the settings panel is under the mode tabs, across the canvas. Under its title bar, on the
   right: the view widget is on the left */
@media (max-width: 480px) {
  body:not(.lay-frame) .ecu-root { top: 6.75rem; left: auto; right: 10px; transform: none; }
  body:not(.lay-frame) .ecu-drop { left: auto; right: 0; transform: none; }
}
`

let styleEl: HTMLStyleElement | undefined

/** The width of the picture of the start view, in pixels (for a card of 224 CSS pixels on a 2x screen) */
const SHOT_WIDTH = 448
/** While the picture is out of date: the shortest time between two pictures, in ms (the last one waits for the render to end) */
const SHOT_INTERVAL = 200

/**
 * The start view UI of the {@link EditorCameraPlugin}: a pill at the top centre of the canvas, in the style of the
 * `PerfPanelPlugin` pill, that names the camera (a grey dot in Edit, blue in View, green in View with
 * {@link EditorCameraPlugin.syncStartView}; an amber corner when a move in View is not saved), and a frame around the
 * canvas in View.
 *
 * On hover, on keyboard focus, or after a tap on a touch screen, a card under the pill shows:
 * - a picture of the saved start view (what visitors see first). A click on it looks through the start view (View); in
 *   View after a move, it goes back to it ({@link EditorCameraPlugin.resetStartView}). The picture is taken from the
 *   canvas when the view shows the saved start view ({@link EditorCameraPlugin.showsStartView}): after a load, in View
 *   before a move, after a save, a sync or "Set as start view".
 * - a Sync toggle over the picture ({@link EditorCameraPlugin.syncStartView}): moves in View change the start view.
 * - an Edit / View toggle ({@link EditorCameraPlugin.editing}, also the C key; a click on the pill with a mouse does
 *   the same).
 * - "Set as start view" in Edit ({@link EditorCameraPlugin.setStartViewFromEditor}), "Save" and "Reset" in View after a
 *   move that is not saved ({@link EditorCameraPlugin.saveStartView}, {@link EditorCameraPlugin.resetStartView}).
 *
 * The `TweakpaneEditorPlugin` adds it when the plugin is added before `loadPlugins()`.
 * @returns a function that removes it
 */
export function setupEditorCameraUi(viewer: ThreeViewer, camera: EditorCameraPlugin): () => void {
    if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
    }
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
        const e = document.createElement(tag)
        e.className = cls
        parent?.appendChild(e)
        return e
    }
    const root = el('div', 'ecu-root')
    const frame = el('div', 'ecu-frame')

    const pill = el('button', 'ecu-pill', root)
    pill.setAttribute('aria-haspopup', 'true')
    pill.setAttribute('aria-expanded', 'false')
    el('i', 'ecu-dot', pill)
    const name = el('span', 'ecu-name', pill)
    el('kbd', '', pill).textContent = 'C'

    const card = el('div', 'ecu-card', el('div', 'ecu-drop', root))
    const shotBox = el('div', 'ecu-shot-box', card)
    const shotButton = el('button', 'ecu-shot', shotBox)
    const shot = el('canvas', '', shotButton)
    shot.width = shot.height = 0
    const empty = el('span', 'ecu-empty', shotBox)
    empty.textContent = 'No picture yet. It is taken when the view shows the start view.'
    el('span', 'ecu-cap', shotBox).textContent = 'Start view'
    const pin = el('button', 'ecu-pin', shotBox)
    pin.innerHTML = pinIcon + '<span>Sync</span>'
    const seg = el('div', 'ecu-seg', card)
    seg.setAttribute('role', 'group')
    seg.setAttribute('aria-label', 'Camera')
    const editButton = el('button', '', seg)
    editButton.textContent = 'Edit'
    const viewButton = el('button', '', seg)
    viewButton.textContent = 'View'
    const acts = el('div', 'ecu-acts', card)
    const setStart = el('button', '', acts)
    setStart.textContent = 'Set as start view'
    const save = el('button', 'ecu-primary', acts)
    save.textContent = 'Save'
    const reset = el('button', '', acts)
    reset.textContent = 'Reset'
    const hint = el('div', 'ecu-hint', card)

    // a tap opens the card (a touch screen has no hover); a click with a mouse switches Edit and View, as the C key
    let touch = false
    const setOpen = (open: boolean) => {
        root.classList.toggle('ecu-open', open)
        pill.setAttribute('aria-expanded', String(open))
    }
    pill.addEventListener('pointerdown', e => touch = e.pointerType === 'touch')
    pill.addEventListener('click', e => {
        // e.detail is 0 for Enter or Space: a keyboard switches, as a mouse
        if (touch && e.detail !== 0) setOpen(!root.classList.contains('ecu-open'))
        else camera.editing = !camera.editing
    })
    const onOutside = (e: PointerEvent) => {
        if (!root.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onOutside, true)

    shotButton.addEventListener('click', () => {
        if (camera.editing) camera.editing = false
        else camera.resetStartView()
    })
    pin.addEventListener('click', () => camera.syncStartView = !camera.syncStartView)
    editButton.addEventListener('click', () => camera.editing = true)
    viewButton.addEventListener('click', () => camera.editing = false)
    setStart.addEventListener('click', () => camera.setStartViewFromEditor())
    save.addEventListener('click', () => camera.saveStartView())
    reset.addEventListener('click', () => camera.resetStartView())

    const tip = (target: HTMLElement, content: string) => tippy(target, {placement: 'bottom', content, touch: false})
    const tips = [
        tip(pin, ''),
        tip(shotButton, ''),
        tip(setStart, 'The start view (what visitors see first) takes this view. Ctrl+Z undoes it.'),
        tip(save, 'Keep this view as the start view. Ctrl+Z undoes it.'),
        tip(reset, 'Back to the saved start view'),
    ]

    // the picture of the start view, taken from the canvas right after a render (the drawing buffer is still there)
    let hasShot = false
    let stale = true
    let lastShot = 0
    const takeShot = () => {
        const src = viewer.canvas
        if (!src.width || !src.height) return
        const h = Math.max(1, Math.round(SHOT_WIDTH * src.height / src.width))
        if (shot.width !== SHOT_WIDTH || shot.height !== h) {
            shot.width = SHOT_WIDTH
            shot.height = h
        }
        const ctx = shot.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingQuality = 'high'
        ctx.clearRect(0, 0, shot.width, shot.height)
        ctx.drawImage(src, 0, 0, shot.width, shot.height)
        hasShot = true
        lastShot = performance.now()
    }
    const onPostRender = () => {
        if (!camera.showsStartView) return
        // the last frame of the render (progressive rendering is done): the final picture
        const done = !viewer.renderManager.needsRender
        if (!done && !(stale && performance.now() - lastShot > SHOT_INTERVAL)) return
        takeShot()
        if (done && stale) {
            stale = false
            update()
        } else if (shotBox.classList.contains('ecu-stale') || empty.style.display !== 'none') update()
    }
    const onStartViewChange = () => {
        stale = true
        update()
    }

    const update = () => {
        const editing = camera.editing
        const sync = camera.syncStartView
        const moved = camera.startViewMoved
        root.classList.toggle('ecu-view', !editing)
        root.classList.toggle('ecu-sync', sync)
        root.classList.toggle('ecu-moved', moved)
        frame.classList.toggle('ecu-on', !editing)
        frame.classList.toggle('ecu-sync', sync)
        name.textContent = editing ? 'Editor camera' : 'Start view'
        pill.setAttribute('aria-label', (editing ? 'Editor camera' : 'Start view, what visitors see') + (moved ? ', moved, not saved' : '') + '. C switches.')
        editButton.setAttribute('aria-pressed', String(editing))
        viewButton.setAttribute('aria-pressed', String(!editing))
        pin.setAttribute('aria-pressed', String(sync))
        pin.setAttribute('aria-label', 'Sync the start view with the moves in View')
        tips[0].setContent(sync ? 'Sync is on: moves in View change the start view' : 'Sync: moves in View change the start view. Off: moves in View are a preview')
        tips[1].setContent(editing ? 'Look through the start view (C)' : moved ? 'Back to the saved start view' : 'The saved start view')
        shotButton.setAttribute('aria-label', editing ? 'Look through the start view' : 'Back to the saved start view')
        shotButton.style.cursor = editing || moved ? '' : 'default'
        // out of date until the view shows the start view again
        shotBox.classList.toggle('ecu-stale', hasShot && stale && !camera.showsStartView)
        empty.style.display = hasShot ? 'none' : ''
        setStart.style.display = editing ? '' : 'none'
        save.style.display = reset.style.display = !editing && moved ? '' : 'none'
        acts.style.display = editing || moved ? '' : 'none'
        hint.textContent = editing ? 'Visitors see the start view first.' :
            sync ? 'Sync is on: your moves change the start view.' :
                moved ? 'This view is not saved.' : 'Moves here are a preview. Sync saves them.'
    }

    viewer.container.appendChild(frame)
    viewer.container.appendChild(root)
    viewer.addEventListener('postRender', onPostRender)
    camera.addEventListener('editingChange', update)
    camera.addEventListener('startViewMovedChange', update)
    camera.addEventListener('startViewChange', onStartViewChange)
    camera.addEventListener('syncStartViewChange', update)
    update()
    return () => {
        viewer.removeEventListener('postRender', onPostRender)
        camera.removeEventListener('editingChange', update)
        camera.removeEventListener('startViewMovedChange', update)
        camera.removeEventListener('startViewChange', onStartViewChange)
        camera.removeEventListener('syncStartViewChange', update)
        document.removeEventListener('pointerdown', onOutside, true)
        tips.forEach(t => t.destroy())
        root.remove()
        frame.remove()
    }
}
