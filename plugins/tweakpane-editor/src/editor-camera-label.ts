import type {ThreeViewer} from 'threepipe'
import tippy from 'tippy.js'
import type {EditorCameraPlugin} from './EditorCameraPlugin'

const ACCENT = '#0d99ff'
// layers (CONTRIBUTING, UI layers): the label is viewer UI (100-199), the frame a canvas overlay (below 50)
const CSS = `
.ecl-root { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 120; display: flex; align-items: center; gap: 6px;
  pointer-events: none; white-space: nowrap; font: 500 12px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); -webkit-font-smoothing: antialiased; }
.ecl-root button { pointer-events: auto; height: 28px; border: 0; border-radius: 14px; cursor: pointer; font: inherit; box-sizing: border-box;
  background: var(--tp-base-background-color, #fff); color: var(--tp-container-foreground-color, #1e1e1e); box-shadow: 0 1px 4px rgba(0,0,0,.18); }
.ecl-root button:hover { filter: brightness(0.96); }
.ecl-root button:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
.ecl-mode { display: flex; align-items: center; gap: 8px; padding: 0 6px 0 10px; }
.ecl-dot { width: 8px; height: 8px; border-radius: 50%; background: #8a8f98; flex-shrink: 0; }
.ecl-sub { opacity: .75; font-weight: 400; }
.ecl-mode kbd { font: inherit; font-size: 11px; padding: 3px 5px; border-radius: 4px; background: rgba(127,127,127,.18); color: inherit; }
.ecl-act { padding: 0 11px; }
.ecl-root.ecl-view .ecl-mode, .ecl-root.ecl-view .ecl-primary { background: ${ACCENT}; color: #fff; }
.ecl-root.ecl-view .ecl-dot { background: #fff; }
.ecl-root.ecl-view .ecl-mode kbd { background: rgba(255,255,255,.25); }
.ecl-short { display: none; }
.ecl-frame { position: absolute; inset: 0; z-index: 40; pointer-events: none; box-shadow: inset 0 0 0 3px ${ACCENT}; display: none; }
.ecl-frame.ecl-on { display: block; }
@media (max-width: 480px) { .ecl-sub, .ecl-long { display: none; } .ecl-short { display: inline; } }
/* the classic page on a phone: its mode tabs are over the top of the canvas */
@media (max-width: 920px) { body:not(.lay-frame) .ecl-root { top: 4.25rem; } }
`

let styleEl: HTMLStyleElement | undefined

/**
 * A label at the top centre of the canvas that names the camera of the {@link EditorCameraPlugin}, and a frame around
 * the canvas in View (the start view, what visitors see). A click on the label switches Edit and View (as the C key).
 *
 * The label has the start view actions:
 * - in Edit, "Set as start view" ({@link EditorCameraPlugin.setStartViewFromEditor});
 * - in View, after a move, "Save as start view" and "Reset" ({@link EditorCameraPlugin.saveStartView},
 * {@link EditorCameraPlugin.resetStartView}).
 *
 * The `TweakpaneEditorPlugin` adds it when the plugin is added before `loadPlugins()`.
 * @returns a function that removes it
 */
export function setupEditorCameraLabel(viewer: ThreeViewer, camera: EditorCameraPlugin): () => void {
    if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
    }
    const root = document.createElement('div')
    root.className = 'ecl-root'
    const frame = document.createElement('div')
    frame.className = 'ecl-frame'

    const button = (cls: string, onClick: () => void) => {
        const b = document.createElement('button')
        b.className = cls
        b.addEventListener('click', onClick)
        root.appendChild(b)
        return b
    }
    const mode = button('ecl-mode', () => camera.editing = !camera.editing)
    const setStart = button('ecl-act', () => camera.setStartViewFromEditor())
    setStart.innerHTML = '<span class="ecl-long">Set as start view</span><span class="ecl-short">Set start</span>'
    const save = button('ecl-act ecl-primary', () => camera.saveStartView())
    save.innerHTML = '<span class="ecl-long">Save as start view</span><span class="ecl-short">Save</span>'
    const reset = button('ecl-act', () => camera.resetStartView())
    reset.textContent = 'Reset'
    const tips = [
        tippy(mode, {placement: 'bottom', content: ''}),
        tippy(setStart, {placement: 'bottom', content: 'The start view (what visitors see) takes this view. Ctrl+Z undoes it.'}),
        tippy(save, {placement: 'bottom', content: 'Keep this view as the start view. Ctrl+Z undoes it.'}),
        tippy(reset, {placement: 'bottom', content: 'Put the start view back where it was'}),
    ]

    const update = () => {
        const editing = camera.editing
        const moved = camera.startViewMoved
        root.classList.toggle('ecl-view', !editing)
        frame.classList.toggle('ecl-on', !editing)
        mode.innerHTML = editing ?
            '<span class="ecl-dot"></span>Editor camera<kbd>C</kbd>' :
            `<span class="ecl-dot"></span>Start view <span class="ecl-sub">· ${moved ? 'moved' : 'what visitors see'}</span><kbd>C</kbd>`
        tips[0].setContent(editing ? 'Look through the start view, as a visitor (C)' : 'Back to the editor camera (C)')
        setStart.style.display = editing ? '' : 'none'
        save.style.display = reset.style.display = !editing && moved ? '' : 'none'
    }

    viewer.container.appendChild(frame)
    viewer.container.appendChild(root)
    camera.addEventListener('editingChange', update)
    camera.addEventListener('startViewMovedChange', update)
    update()
    return () => {
        camera.removeEventListener('editingChange', update)
        camera.removeEventListener('startViewMovedChange', update)
        tips.forEach(t => t.destroy())
        root.remove()
        frame.remove()
    }
}
