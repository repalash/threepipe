import {AViewerPluginSync, IObject3D, onChange, PickingPlugin, serialize, ThreeViewer} from 'threepipe'

export interface NotesPluginOptions {
    /** localStorage key of the page notes */
    pageKey?: string
    /** Optional endpoint that also keeps the page notes: GET returns {text}, POST takes {text} */
    syncUrl?: string
    /** Extra text for the "+ Context" line, e.g. the current mode */
    contextProvider?: () => string
}

/**
 * Sticky notes for the editor, in two tiers:
 * - Scene notes: a serialized property of this plugin, so they are saved inside the exported .glb (viewer config)
 *   and come back when the file is loaded.
 * - Page notes: kept in this browser (localStorage), optionally also on a server ({@link NotesPluginOptions.syncUrl}).
 *
 * "+ Context" adds a line with the time, the selection and {@link contextProvider}. Mount {@link element} anywhere.
 */
export class NotesPlugin extends AViewerPluginSync {
    static readonly PluginType = 'NotesPlugin'
    enabled = true

    /** Notes saved with the scene (in the .glb) */
    @serialize()
    @onChange(NotesPlugin.prototype._sceneNotesChanged)
        sceneNotes = ''

    pageKey: string
    syncUrl?: string
    contextProvider?: () => string

    readonly element: HTMLDivElement
    private _text: HTMLTextAreaElement
    private _status: HTMLElement
    private _tab: 'scene' | 'page' = 'scene'
    private _pageNotes = ''
    private _serverOk = false
    private _timer = 0

    constructor(options: NotesPluginOptions = {}) {
        super()
        this.pageKey = options.pageKey ?? 'threepipe-page-notes'
        this.syncUrl = options.syncUrl
        this.contextProvider = options.contextProvider
        injectStyles()
        const el = document.createElement('div')
        el.className = 'np-root'
        el.innerHTML = `
<div class="np-head"><b>Notes</b><span class="np-status"></span><button class="np-collapse" title="Collapse">–</button></div>
<div class="np-tabs">
  <button data-tab="scene" title="Saved inside the scene file (.glb) when you export it">Scene · in the file</button>
  <button data-tab="page" title="Saved in this browser">Page · this browser</button>
</div>
<textarea spellcheck="true"></textarea>
<div class="np-foot"><button class="np-ctx" title="Add the time and the selection">+ Context</button><button class="np-copy">Copy</button></div>`
        this.element = el
        this._text = el.querySelector('textarea')!
        this._status = el.querySelector('.np-status')!
        el.querySelectorAll<HTMLButtonElement>('.np-tabs button').forEach(b => b.addEventListener('click', () => {
            this._tabChosen = true
            this.setTab(b.dataset.tab as any)
        }))
        el.querySelector('.np-collapse')!.addEventListener('click', () => el.classList.toggle('np-collapsed'))
        el.querySelector('.np-ctx')!.addEventListener('click', () => this.addContext())
        el.querySelector('.np-copy')!.addEventListener('click', () => {
            navigator.clipboard?.writeText(this._text.value).then(() => this._setStatus('copied'))
        })
        this._text.addEventListener('input', this._onInput)
        // keep typing (Ctrl+Z, Delete, arrows) away from the scene hotkeys
        this._text.addEventListener('keydown', e => e.stopPropagation())
        try {
            this._pageNotes = localStorage.getItem(this.pageKey) || ''
        } catch (e) {
            this._pageNotes = ''
        }
        this._pickTab()
    }

    private _tabChosen = false
    /** Until the person picks a tab: open the one that has notes, scene first */
    private _pickTab() {
        if (this._tabChosen) return this._render()
        this.setTab(!this.sceneNotes && this._pageNotes ? 'page' : 'scene')
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        if (this.syncUrl) {
            // the server copy wins when it is longer, e.g. notes written on another device
            fetch(this.syncUrl).then(async r => r.ok ? r.json() : Promise.reject(r.status)).then((d: {text?: string}) => {
                this._serverOk = true
                if (typeof d.text === 'string' && d.text.length > this._pageNotes.length) this._pageNotes = d.text
                this._pickTab()
            }).catch(() => this._render())
        }
    }

    onRemove(viewer: ThreeViewer) {
        this.element.remove()
        super.onRemove(viewer)
    }

    setTab(tab: 'scene' | 'page') {
        this._tab = tab
        this._render()
    }

    private _render() {
        this.element.querySelectorAll<HTMLButtonElement>('.np-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === this._tab))
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
        if (!this._text) return // set before the UI exists (field initializer)
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

    private _savePage = () => {
        try {
            localStorage.setItem(this.pageKey, this._pageNotes)
        } catch (e) {
            // private mode: only the server copy, if any
        }
        if (!this._serverOk || !this.syncUrl) return this._setStatus('this browser')
        fetch(this.syncUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: this._pageNotes})})
            .then(r => this._setStatus(r.ok ? 'browser + server' : 'server failed, kept in browser'))
            .catch(() => this._setStatus('server failed, kept in browser'))
    }

    /** Insert "[time · context · selected: …]" at the cursor */
    addContext() {
        const sel = (this._viewer?.getPlugin(PickingPlugin)?.getSelectedObjects() || []) as any[]
        const names = sel.map(o => (o as IObject3D)?.name || o?.type).filter(Boolean).join(', ')
        const extra = this.contextProvider?.() || ''
        const t = this._text
        const at = t.selectionStart ?? t.value.length
        const line = `${at ? '\n' : ''}[${new Date().toLocaleString()}${extra ? ' · ' + extra : ''}${names ? ' · selected: ' + names : ''}]\n`
        t.value = t.value.slice(0, at) + line + t.value.slice(at)
        t.focus()
        t.selectionStart = t.selectionEnd = at + line.length
        this._onInput()
    }
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.np-root { display: flex; flex-direction: column; background: #fff8c5; color: #3b3418; font: 11px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; min-height: 0; user-select: text; }
.np-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 4px 12px; }
.np-status { flex: 1; color: #8a7d3c; text-align: right; }
.np-collapse { border: 0; background: transparent; color: #8a7d3c; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 4px; }
.np-tabs { display: flex; gap: 2px; margin: 2px 10px 6px; background: #f3e9a8; border-radius: 6px; padding: 2px; }
.np-tabs button { flex: 1; border: 0; background: transparent; border-radius: 5px; padding: 4px; font: inherit; color: #8a7d3c; cursor: pointer; white-space: nowrap; }
.np-tabs button.on { background: #fffdf0; color: #3b3418; box-shadow: 0 0 0 1px #e8dc96; }
.np-root textarea { flex: 1; min-height: 70px; margin: 0 10px; border: 0; background: transparent; resize: none; outline: none; font: inherit; color: inherit;
  background-image: linear-gradient(transparent 21px, #efe3a0 22px); background-size: 100% 22px; line-height: 22px; padding: 0 2px; }
.np-foot { display: flex; gap: 6px; padding: 6px 10px 10px; }
.np-foot button { border: 1px solid #e8dc96; background: #fffdf0; color: #3b3418; border-radius: 5px; padding: 4px 8px; font: inherit; cursor: pointer; }
.np-foot button:hover { background: #fff; }
.np-collapsed .np-tabs, .np-collapsed textarea, .np-collapsed .np-foot { display: none; }
`
    document.head.appendChild(st)
}
