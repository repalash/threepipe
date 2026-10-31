import {createStyles} from 'threepipe'
import tippy, {Instance} from 'tippy.js'
import {addTooltipStyles, EDITOR_TOOLTIP_PROPS} from './tooltips'
import {isTextTarget, readStored, writeStored} from './dom-utils'
import styles from './EditorSplash.css?inline'

/** A sample of {@link EditorSplash}: a card in the Samples grid, and a row in the Recent list after it is opened */
export interface EditorSplashSample {
    /** The name on the card. The Recent list finds the sample by this name, so keep it unique. */
    title: string
    /** A short line under the title */
    text?: string
    /**
     * The picture of the card: an SVG string, drawn at 32 px, with `stroke="currentColor"` (it takes the accent colour
     * on hover). It is markup of the app, set as HTML: never put text from a user in it. Default: a box.
     */
    icon?: string
    /**
     * Loads the sample. The card shows that it loads until this resolves, then the splash closes. When it throws or
     * rejects, the splash stays open and says that the sample could not be opened.
     */
    load: () => unknown
}

export interface EditorSplashOptions {
    /** The app name in the header. Default: `threepipe Editor`. */
    title?: string
    /** A short text after the title, like the version of the app */
    version?: string
    /** The sample cards, in this order. Without samples, the splash has no Samples and no Recent part. */
    samples?: EditorSplashSample[]
    /** Makes an empty scene. When it is set, the Start part has "New empty scene". */
    onNew?: () => unknown
    /**
     * Opens the files that the person picked (Open file…, Ctrl+O) or dropped on the splash. When it is set, the Start
     * part has "Open file…", and a drop anywhere on the page opens the files. It loads like {@link EditorSplashSample.load}.
     */
    onFiles?: (files: File[]) => unknown
    /** The file types of the file picker, as the `accept` attribute of a file input (`.glb,.gltf`). Default: any file. */
    accept?: string
    /**
     * The start of the `localStorage` keys: `<key>Startup` keeps the "Show at startup" box and `<key>Recent` the recent
     * samples. `null`: nothing is kept (this page only). Default: `tpEditorSplash`.
     */
    storageKey?: string | null
    /**
     * Ctrl+O (Cmd+O on a Mac) opens the splash when it is closed, outside a text field. Default: `true`. In the open
     * splash, Ctrl+O opens the file picker (with {@link onFiles}).
     */
    shortcut?: boolean
    /** Called after the splash closes: a sample or files opened, Escape, × or a click outside the card */
    onClose?: () => void
}

const svg = (size: number, d: string) => `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    app: svg(16, '<path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z"/><path d="M8 8l5.6-3.3M8 8v6.5M8 8L2.4 4.7"/>'),
    close: svg(16, '<path d="M4 4l8 8M12 4l-8 8"/>'),
    new: svg(16, '<path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z"/><path d="M8 5.5v5M5.5 8h5"/>'),
    open: svg(16, '<path d="M1.5 4V13h11.5l1.5-6H4L2.5 13"/><path d="M1.5 4V2.5h4l1.5 1.5h5V7"/>'),
    recent: svg(16, '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.2 1.5"/>'),
    sample: svg(24, '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
}

/**
 * The start screen of the editor, like the splash of a desktop app: a dialog over the dimmed page with
 * - Start: New empty scene ({@link EditorSplashOptions.onNew}) and Open file… ({@link EditorSplashOptions.onFiles});
 * - Recent: the samples that the person opened last ({@link recent});
 * - Samples: a card per sample of the app ({@link EditorSplashSample}: a title, a text, an icon and a load function);
 * - "Drop a file anywhere to open it", and a "Show at startup" box ({@link showAtStartup}).
 *
 * The app makes it with its samples and calls {@link open}, at the page load when {@link showAtStartup} is on. Escape,
 * × or a click outside the card closes it. While it is open, it has the focus and the keys: Tab stays in it, and the
 * editor shortcuts do not reach the page behind it. Ctrl+O (Cmd+O) opens it again ({@link EditorSplashOptions.shortcut}).
 *
 * It takes the colours of the Tweakpane theme (the `--tp-*` variables of the page, as the editor frame does), and its
 * z-index (5000) is in the popups layer of the UI layers in CONTRIBUTING.md.
 *
 * @example
 * ```ts
 * const splash = new EditorSplash({
 *     title: 'My Editor',
 *     samples: [{title: 'Helmet', text: 'A glTF with PBR textures', load: () => viewer.load(url)}],
 *     onNew: () => viewer.scene.disposeSceneModels(),
 *     onFiles: files => viewer.assetManager.addAsset(files),
 * })
 * if (splash.showAtStartup) splash.open()
 * ```
 */
export class EditorSplash {
    /** The number of samples in the Recent list */
    static MaxRecent = 5

    private _root?: HTMLDivElement
    private _status?: HTMLElement
    private _input?: HTMLInputElement
    private _tip?: Instance
    /** The element that had the focus before the splash opened: it gets it back after */
    private _returnFocus?: HTMLElement
    private _startup: boolean
    private _recent: string[]
    private _styles?: HTMLStyleElement

    /** @param options - the title, the samples and the callbacks */
    constructor(readonly options: EditorSplashOptions = {}) {
        this._styles = createStyles(styles)
        addTooltipStyles()
        this._startup = this._read('Startup') !== '0'
        this._recent = parseRecent(this._read('Recent'))
        window.addEventListener('keydown', this._onKeyDown, true)
    }

    /** The dialog while it is open (class `esp-root`, in the body) */
    get element(): HTMLDivElement | undefined {
        return this._root
    }

    get isOpen() {
        return !!this._root
    }

    /**
     * The "Show at startup" box: the app opens the splash at the page load when it is on. It is kept in `localStorage`
     * (`<storageKey>Startup`). Default: `true`.
     */
    get showAtStartup() {
        return this._startup
    }
    set showAtStartup(show: boolean) {
        this._startup = show
        this._write('Startup', show ? '1' : '0')
        const box = this._root?.querySelector<HTMLInputElement>('.esp-check input')
        if (box) box.checked = show
    }

    /** The titles of the samples opened last, the latest first, kept in `localStorage` (`<storageKey>Recent`) */
    get recent(): readonly string[] {
        return this._recent
    }

    /** Opens the splash, with the focus on it. It does nothing when it is open. */
    open() {
        if (this._root) return
        const o = this.options
        const samples = o.samples ?? []
        const title = o.title ?? 'threepipe Editor'
        this._returnFocus = document.activeElement as HTMLElement | undefined

        const root = document.createElement('div')
        root.className = 'esp-root'
        root.setAttribute('role', 'dialog')
        root.setAttribute('aria-modal', 'true')
        root.setAttribute('aria-label', title)
        root.tabIndex = -1
        root.innerHTML = `<div class="esp-card">
<div class="esp-head"><span class="esp-logo">${ICONS.app}</span><span class="esp-title"></span><span class="esp-version"></span><button class="esp-close">${ICONS.close}</button></div>
<div class="esp-body">
<div class="esp-side"><div class="esp-heading esp-start-heading">Start</div><div class="esp-start"></div><div class="esp-heading esp-recent-heading">Recent</div><div class="esp-recent"></div></div>
<div class="esp-main"><div class="esp-heading esp-samples-heading">Samples</div><div class="esp-samples"></div><div class="esp-status" role="status"></div></div>
</div>
<div class="esp-foot"><span class="esp-hint"></span><label class="esp-check"><input type="checkbox"><span>Show at startup</span></label></div>
<div class="esp-drop"><span>Drop to open</span></div>
</div>`
        const $ = <T extends HTMLElement = HTMLElement>(cls: string) => root.querySelector<T>('.' + cls)!
        $('esp-title').textContent = title
        $('esp-version').textContent = o.version ?? ''
        this._status = $('esp-status')

        const close = $<HTMLButtonElement>('esp-close')
        close.setAttribute('aria-label', 'Close (Esc)')
        close.addEventListener('click', () => this.close())
        this._tip = tippy(close, {...EDITOR_TOOLTIP_PROPS, content: 'Close (Esc)', placement: 'bottom', appendTo: () => document.body})

        // Start
        const start = $('esp-start')
        if (o.onNew) {
            const onNew = o.onNew
            const b = this._row(ICONS.new, 'New empty scene')
            b.addEventListener('click', () => void this._run('a new scene', b, onNew))
            start.appendChild(b)
        }
        if (o.onFiles) {
            const b = this._row(ICONS.open, 'Open file…', /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘O' : 'Ctrl+O')
            b.setAttribute('aria-keyshortcuts', 'Control+O Meta+O')
            b.addEventListener('click', () => this.openFilePicker())
            start.appendChild(b)
            this._input = document.createElement('input')
            this._input.type = 'file'
            this._input.multiple = true
            this._input.hidden = true
            if (o.accept) this._input.accept = o.accept
            this._input.addEventListener('change', () => void this._openFiles(Array.from(this._input?.files ?? [])))
            root.appendChild(this._input)
            this._setupDrop(root)
        }
        $('esp-start-heading').hidden = !start.children.length

        // Recent and Samples
        const recent = $('esp-recent')
        for (const name of this._recent) {
            const s = samples.find(x => x.title === name)
            if (!s) continue
            const b = this._row(ICONS.recent, s.title)
            b.addEventListener('click', () => void this._openSample(s, b))
            recent.appendChild(b)
        }
        if (!recent.children.length) recent.innerHTML = '<div class="esp-none">The samples you open show here.</div>'
        $('esp-recent-heading').hidden = recent.hidden = !samples.length
        const grid = $('esp-samples')
        for (const s of samples) grid.appendChild(this._card(s))
        $('esp-samples-heading').hidden = !samples.length

        $('esp-hint').textContent = o.onFiles ? 'Drop a file anywhere to open it' : ''
        const box = root.querySelector<HTMLInputElement>('.esp-check input')!
        box.checked = this._startup
        box.addEventListener('change', () => this.showAtStartup = box.checked)

        // a click on the dimmed page closes it, as Escape
        root.addEventListener('pointerdown', e => {
            if (e.target === root && !root.classList.contains('esp-busy')) this.close()
        })
        root.addEventListener('keydown', this._onRootKeyDown)
        document.body.appendChild(root)
        this._root = root
        root.focus({preventScroll: true})
    }

    /** Closes the splash and calls {@link EditorSplashOptions.onClose}. A sample that loads goes on loading. */
    close() {
        const root = this._root
        if (!root) return
        this._root = this._status = this._input = undefined
        this._tip?.destroy()
        this._tip = undefined
        root.remove()
        this._returnFocus?.focus?.({preventScroll: true})
        this._returnFocus = undefined
        this.options.onClose?.()
    }

    /** Opens the file picker of the open splash (Open file…, Ctrl+O), when {@link EditorSplashOptions.onFiles} is set */
    openFilePicker() {
        if (this._input && !this._root?.classList.contains('esp-busy')) this._input.click()
    }

    /** Closes the splash, and removes its styles and its Ctrl+O shortcut */
    dispose() {
        this.close()
        window.removeEventListener('keydown', this._onKeyDown, true)
        this._styles?.remove()
        this._styles = undefined
    }

    /** A row of the Start or the Recent part: an icon, a label and a shortcut */
    private _row(icon: string, label: string, kbd?: string) {
        const b = document.createElement('button')
        b.className = 'esp-row'
        b.innerHTML = `${icon}<span></span>${kbd ? '<kbd></kbd>' : ''}`
        b.querySelector('span')!.textContent = label
        if (kbd) b.querySelector('kbd')!.textContent = kbd
        return b
    }

    private _card(s: EditorSplashSample) {
        const b = document.createElement('button')
        b.className = 'esp-card-btn'
        b.innerHTML = `<span class="esp-thumb">${s.icon ?? ICONS.sample}</span><span class="esp-label"></span>${s.text ? '<span class="esp-text"></span>' : ''}`
        b.querySelector('.esp-label')!.textContent = s.title
        if (s.text) b.querySelector('.esp-text')!.textContent = s.text
        b.addEventListener('click', () => void this._openSample(s, b))
        return b
    }

    private async _openSample(s: EditorSplashSample, button: HTMLElement) {
        await this._run(`“${s.title}”`, button, async() => {
            await s.load()
            this._addRecent(s.title)
        })
    }

    private async _openFiles(files: File[]) {
        const onFiles = this.options.onFiles
        if (!files.length || !onFiles) return
        await this._run(files.map(f => f.name).join(', '), undefined, () => onFiles(files))
    }

    /**
     * Runs a load: the splash shows that it loads (one at a time), then closes. When the load fails, it stays open with
     * a message. A splash closed while it loads stays closed.
     */
    private async _run(name: string, button: HTMLElement | undefined, load: () => unknown) {
        const root = this._root
        if (!root || root.classList.contains('esp-busy')) return
        root.classList.add('esp-busy')
        root.setAttribute('aria-busy', 'true')
        button?.classList.add('esp-loading')
        this._setStatus(`Opening ${name}…`)
        let ok = true
        try {
            await load()
        } catch (e) {
            console.error(e)
            ok = false
        }
        if (this._root !== root) return
        root.classList.remove('esp-busy')
        root.removeAttribute('aria-busy')
        button?.classList.remove('esp-loading')
        if (ok) this.close()
        else this._setStatus(`Could not open ${name}. Pick a sample, or open a file.`, true)
    }

    private _setStatus(text: string, error = false) {
        if (!this._status) return
        this._status.textContent = text
        this._status.classList.toggle('esp-error', error)
    }

    /** Files dropped anywhere on the splash open; the drop area shows while a file is over it */
    private _setupDrop(root: HTMLDivElement) {
        let depth = 0
        const leave = () => {
            depth = 0
            root.classList.remove('esp-over')
        }
        root.addEventListener('dragenter', e => {
            e.preventDefault()
            depth++
            root.classList.add('esp-over')
        })
        root.addEventListener('dragover', e => e.preventDefault())
        root.addEventListener('dragleave', () => {
            if (--depth <= 0) leave()
        })
        root.addEventListener('drop', e => {
            e.preventDefault()
            leave()
            void this._openFiles(Array.from(e.dataTransfer?.files ?? []))
        })
    }

    private _addRecent(title: string) {
        this._recent = [title, ...this._recent.filter(t => t !== title)].slice(0, EditorSplash.MaxRecent)
        this._write('Recent', JSON.stringify(this._recent))
    }

    private get _storageKey() {
        return this.options.storageKey === undefined ? 'tpEditorSplash' : this.options.storageKey
    }

    private _read(name: string) {
        const key = this._storageKey
        return key ? readStored(key + name) : null
    }

    private _write(name: string, value: string) {
        const key = this._storageKey
        if (key) writeStored(key + name, value)
    }

    /** Escape closes the open splash, Ctrl+O opens its file picker, or opens the closed splash */
    private _onKeyDown = (e: KeyboardEvent) => {
        const ctrlO = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o'
        if (this._root) {
            if (e.key !== 'Escape' && !(ctrlO && this._input)) return
            // before the shortcuts of the page: Escape would also clear the selection behind the splash
            e.preventDefault()
            e.stopImmediatePropagation()
            if (ctrlO) this.openFilePicker()
            else this.close()
        } else if (ctrlO && this.options.shortcut !== false && !e.repeat && !e.defaultPrevented && !isTextTarget(e.target)) {
            e.preventDefault()
            this.open()
        }
    }

    /** Tab and Shift+Tab stay in the splash, and no key reaches the shortcuts of the page behind it */
    private _onRootKeyDown = (e: KeyboardEvent) => {
        e.stopPropagation()
        const root = this._root
        if (e.key !== 'Tab' || !root) return
        const items = Array.from(root.querySelectorAll<HTMLElement>('button, input[type="checkbox"]'))
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === root)) {
            e.preventDefault()
            last.focus()
        } else if (!e.shiftKey && active === last) {
            e.preventDefault()
            first.focus()
        }
    }
}

/** The recent titles kept in `localStorage`: a JSON list of strings, or none */
function parseRecent(stored: string | null): string[] {
    try {
        const v = JSON.parse(stored || '[]')
        return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, EditorSplash.MaxRecent) : []
    } catch (e) {
        return []
    }
}
