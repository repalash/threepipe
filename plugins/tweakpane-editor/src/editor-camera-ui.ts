import {createStyles} from 'threepipe'
import type {ThreeViewer} from 'threepipe'
import tippy from 'tippy.js'
import type {EditorCameraPlugin} from './EditorCameraPlugin'
import styles from './editor-camera-ui.css?inline'

const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
// a camera, in the stroke style of the pin
const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>'

/** The width of the picture of the start view, in pixels (for a card of 224 CSS pixels on a 2x screen) */
const SHOT_WIDTH = 448
/** How long the mouse stays on the pill or the card before the card opens, in ms */
const HOVER_DELAY = 150
/** While the picture is out of date: the shortest time between two pictures, in ms (the last one waits for the render to end) */
const SHOT_INTERVAL = 200

/**
 * The start view UI of the {@link EditorCameraPlugin}: a pill at the top centre of the canvas, in the style of the
 * `PerfPanelPlugin` pill, that names the camera ("Editor camera" or "Scene camera", with a camera icon: grey in Edit,
 * blue in View, green in View with {@link EditorCameraPlugin.syncStartView}; an amber corner when a move in View is not
 * saved), and a frame around the
 * canvas in View.
 *
 * A card under the pill opens on hover (a moment on the pill or the card, with a mouse), on a tap on a touch screen or
 * on keyboard focus, and stays open until a press outside it or Escape. It shows:
 * - a picture of the saved start view (what visitors see first). A click on it looks through the start view (View); in
 *   View after a move, it goes back to it ({@link EditorCameraPlugin.resetStartView}). The picture is taken from the
 *   canvas when the view shows the saved start view ({@link EditorCameraPlugin.showsStartView}): after a load, in View
 *   before a move, after a save, a sync or "Set as start view".
 * - a Sync toggle over the picture ({@link EditorCameraPlugin.syncStartView}): moves in View change the start view.
 * - an Edit / View toggle ({@link EditorCameraPlugin.editing}, also the C key; a click on the pill with a mouse does
 *   the same).
 * - "Set as start view" in Edit ({@link EditorCameraPlugin.setStartViewFromEditor}); "Save" and "Reset" in View, on
 *   after a move that is not saved ({@link EditorCameraPlugin.saveStartView}, {@link EditorCameraPlugin.resetStartView}).
 *   They stay in the card when off, so the card keeps its size.
 *
 * The `TweakpaneEditorPlugin` adds it when the plugin is added before `loadPlugins()`. Each call adds its own style
 * element.
 * @returns a function that removes it, with its style element
 */
export function setupEditorCameraUi(viewer: ThreeViewer, camera: EditorCameraPlugin): () => void {
    const styleEl = createStyles(styles)
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
    el('span', 'ecu-icon', pill).innerHTML = cameraIcon
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
    let hoverTimer = 0
    const setOpen = (open: boolean) => {
        window.clearTimeout(hoverTimer)
        root.classList.toggle('ecu-open', open)
        pill.setAttribute('aria-expanded', String(open))
    }
    // a hover opens the card after a moment (not when the pointer only passes over it); it stays open until a press
    // outside it or Escape, so it does not close when the pointer leaves it for a moment
    root.addEventListener('pointerenter', e => {
        if (e.pointerType !== 'mouse' || root.classList.contains('ecu-open')) return
        hoverTimer = window.setTimeout(() => setOpen(true), HOVER_DELAY)
    })
    root.addEventListener('pointerleave', () => window.clearTimeout(hoverTimer))
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
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && root.classList.contains('ecu-open')) setOpen(false)
    }
    document.addEventListener('keydown', onKey)

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
        name.textContent = editing ? 'Editor camera' : 'Scene camera'
        pill.setAttribute('aria-label', (editing ? 'Editor camera' : 'Scene camera, what visitors see') + (moved ? ', moved, not saved' : '') + '. C switches.')
        editButton.setAttribute('aria-pressed', String(editing))
        viewButton.setAttribute('aria-pressed', String(!editing))
        pin.setAttribute('aria-pressed', String(sync))
        pin.setAttribute('aria-label', 'Sync the start view with the moves in View')
        tips[0].setContent(sync ? 'Sync is on: moves in View change the start view' : 'Sync: moves in View change the start view. Off: moves in View are a preview')
        shotButton.setAttribute('aria-label', editing ? 'Look through the start view' : 'Back to the saved start view')
        shotButton.style.cursor = editing || moved ? '' : 'default'
        // out of date until the view shows the start view again
        shotBox.classList.toggle('ecu-stale', hasShot && stale && !camera.showsStartView)
        empty.style.display = hasShot ? 'none' : ''
        setStart.style.display = editing ? '' : 'none'
        save.style.display = reset.style.display = editing ? 'none' : ''
        save.disabled = reset.disabled = !moved
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
        document.removeEventListener('keydown', onKey)
        window.clearTimeout(hoverTimer)
        tips.forEach(t => t.destroy())
        root.remove()
        frame.remove()
        styleEl.remove()
    }
}
