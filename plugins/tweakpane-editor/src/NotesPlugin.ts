import {AViewerPluginSync, createStyles, IObject3D, onChange, PickingPlugin, serialize, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import styles from './NotesPlugin.css?inline'

export interface NotesPluginOptions {
    /** The `localStorage` key of the page notes. Default: `threepipe-page-notes` */
    pageKey?: string
    /**
     * An endpoint that also keeps the page notes, for another browser or device: GET returns `{text}`, POST takes
     * `{text}`. Without it, the page notes stay in this browser.
     */
    syncUrl?: string
    /** Extra text for the "+ Context" line, for example the current tool or mode */
    contextProvider?: () => string
}

type NotesTab = 'scene' | 'page'

/**
 * Notes Plugin
 *
 * Notes in the editor, in two tabs:
 * - **Scene**: {@link sceneNotes}, a serialized property, so the notes are saved in the viewer config, inside an
 *   exported .glb, and come back when the file loads.
 * - **Page**: kept in this browser (`localStorage`, {@link pageKey}), and also on a server with {@link syncUrl}.
 *   When both have notes, the longer text wins at the start, for example notes written on another device.
 *
 * "+ Context" adds a line with the time, {@link contextProvider} and the names of the selected objects (from the
 * `PickingPlugin`). "Copy" copies the open tab. Keys typed in the notes do not reach the viewer's shortcuts.
 *
 * The UI is {@link element}: in the plugin's UI folder (Notes), or mounted anywhere else.
 *
 * @category Plugins
 */
export class NotesPlugin extends AViewerPluginSync {
    static readonly PluginType = 'NotesPlugin'
    /** Adds the stylesheet of the notes to the page when the first one is made. Off: the page styles the `np-` classes. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    enabled = true

    /** Notes saved with the scene (in the viewer config, so in an exported .glb) */
    @serialize()
    @onChange(NotesPlugin.prototype._sceneNotesChanged)
        sceneNotes = ''

    /** The `localStorage` key of the page notes */
    pageKey: string
    /** An endpoint that also keeps the page notes ({@link NotesPluginOptions.syncUrl}) */
    syncUrl?: string
    /** Extra text for the "+ Context" line */
    contextProvider?: () => string

    /** The notes UI: two tabs, the text, "+ Context", "Copy" and where the notes are kept */
    readonly element: HTMLDivElement
    private _text: HTMLTextAreaElement
    private _status: HTMLSpanElement
    private _tabButtons: Record<NotesTab, HTMLButtonElement>
    private _tab: NotesTab = 'scene'
    /** The person picked a tab: the plugin no longer picks the one that has notes */
    private _tabChosen = false
    private _pageNotes = ''
    private _serverOk = false
    private _timer = 0

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Notes',
        children: [],
    }

    constructor(options: NotesPluginOptions = {}) {
        super()
        this.pageKey = options.pageKey ?? 'threepipe-page-notes'
        this.syncUrl = options.syncUrl
        this.contextProvider = options.contextProvider
        if (NotesPlugin.InjectStyles && !NotesPlugin._styles?.isConnected) NotesPlugin._styles = createStyles(styles)

        this.element = element('div', 'np-root')
        const tabs = element('div', 'np-tabs')
        this._tabButtons = {
            scene: element('button', '', 'Scene · in the file', 'Saved inside the scene file (.glb) when you export it'),
            page: element('button', '', 'Page · this browser', 'Saved in this browser'),
        }
        for (const tab of ['scene', 'page'] as const) {
            const b = this._tabButtons[tab]
            b.addEventListener('click', () => {
                this._tabChosen = true
                this.setTab(tab)
            })
            tabs.appendChild(b)
        }
        this._text = element('textarea', '')
        this._text.spellcheck = true
        this._text.addEventListener('input', this._onInput)
        // typing (Ctrl+Z, Delete, the arrows) does not reach the viewer's shortcuts
        this._text.addEventListener('keydown', e => e.stopPropagation())
        const foot = element('div', 'np-foot')
        const context = element('button', '', '+ Context', 'Add the time and the selection')
        context.addEventListener('click', () => this.addContext())
        const copy = element('button', '', 'Copy', 'Copy the notes of this tab')
        copy.addEventListener('click', () => {
            navigator.clipboard?.writeText(this._text.value).then(() => this._setStatus('copied'))
        })
        this._status = element('span', 'np-status')
        foot.appendChild(context)
        foot.appendChild(copy)
        foot.appendChild(this._status)
        this.element.appendChild(tabs)
        this.element.appendChild(this._text)
        this.element.appendChild(foot)
        this.uiConfig.domChildren = [this.element]

        try {
            this._pageNotes = localStorage.getItem(this.pageKey) || ''
        } catch (e) {
            this._pageNotes = '' // no storage
        }
        this._pickTab()
    }

    /** The open tab */
    get tab(): NotesTab {
        return this._tab
    }

    /** The notes kept in this browser (and on the server, with {@link syncUrl}) */
    get pageNotes() {
        return this._pageNotes
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        if (!this.syncUrl) return
        const before = this._pageNotes
        fetch(this.syncUrl).then(async r => r.ok ? r.json() : Promise.reject(r.status)).then((d: {text?: string}) => {
            this._serverOk = true
            const server = typeof d.text === 'string' ? d.text : ''
            // the longer notes win, but not over edits made while the server answered: then this browser's notes win
            if (this._pageNotes === before && server.length > before.length) {
                this._pageNotes = server
                this._storeLocal()
                this._pickTab()
            } else if (this._pageNotes !== server) {
                this._savePage() // keeps this browser's notes on the server
            } else {
                this._render()
            }
        }).catch(() => this._render())
    }

    onRemove(viewer: ThreeViewer) {
        // the page notes typed in the last 600 ms
        if (this._timer) this._savePage()
        this.element.remove()
        super.onRemove(viewer)
    }

    /** Opens a tab */
    setTab(tab: NotesTab) {
        this._tab = tab
        this._render()
    }

    /** Inserts a line "[time · context · selected: …]" at the cursor of the open tab */
    addContext() {
        const selected = (this._viewer?.getPlugin(PickingPlugin)?.getSelectedObjects() || []) as any[]
        const names = selected.map(o => (o as IObject3D)?.name || o?.type).filter(Boolean).join(', ')
        const extra = this.contextProvider?.() || ''
        const t = this._text
        const at = t.selectionStart ?? t.value.length
        const line = `${at ? '\n' : ''}[${new Date().toLocaleString()}${extra ? ' · ' + extra : ''}${names ? ' · selected: ' + names : ''}]\n`
        t.value = t.value.slice(0, at) + line + t.value.slice(at)
        t.focus()
        t.selectionStart = t.selectionEnd = at + line.length
        this._onInput()
    }

    /** Until the person picks a tab: the one that has notes, the scene first */
    private _pickTab() {
        if (this._tabChosen) return this._render()
        this.setTab(!this.sceneNotes && this._pageNotes ? 'page' : 'scene')
    }

    private _render() {
        for (const tab of ['scene', 'page'] as const) this._tabButtons[tab].classList.toggle('on', tab === this._tab)
        const v = this._tab === 'scene' ? this.sceneNotes : this._pageNotes
        if (this._text.value !== v) this._text.value = v
        this._text.placeholder = this._tab === 'scene' ?
            'Notes about this scene. They are saved inside the .glb when you export it.' :
            'Your notes for this page, kept in this browser. “+ Context” adds the time and the selection.'
        this._setStatus(this._tab === 'scene' ? 'in the file' : this._serverOk ? 'browser + server' : 'this browser')
    }

    private _setStatus(s: string) {
        this._status.textContent = s
    }

    private _sceneNotesChanged() {
        if (!this._text) return // the field initializer, before the UI exists
        if (document.activeElement !== this._text) this._pickTab()
    }

    private _onInput = () => {
        if (this._tab === 'scene') {
            this.sceneNotes = this._text.value
            this._setStatus('in the file (export to save)')
            return
        }
        this._pageNotes = this._text.value
        this._setStatus('editing…')
        clearTimeout(this._timer)
        this._timer = window.setTimeout(this._savePage, 600)
    }

    private _storeLocal() {
        try {
            localStorage.setItem(this.pageKey, this._pageNotes)
        } catch (e) {
            // no storage: only the server copy, if any
        }
    }

    private _savePage = () => {
        clearTimeout(this._timer)
        this._timer = 0
        this._storeLocal()
        if (!this._serverOk || !this.syncUrl) return this._setStatus('this browser')
        fetch(this.syncUrl, {method: 'POST', headers: [['Content-Type', 'application/json']], body: JSON.stringify({text: this._pageNotes})})
            .then(r => this._setStatus(r.ok ? 'browser + server' : 'server failed, kept in browser'))
            .catch(() => this._setStatus('server failed, kept in browser'))
    }
}

/** An element with a class, a text and a tooltip */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '', title = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (className) e.className = className
    if (text) e.textContent = text
    if (title) e.title = title
    return e
}
