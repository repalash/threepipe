import {createStyles, formatShortcut, shortcutsOf} from 'threepipe'
import type {ViewerAction, ViewerActions} from 'threepipe'
import styles from './ShortcutsSheet.css?inline'

/** A row of the {@link ShortcutsSheet}: an action and the labels of its keys (`⌘Z`, `Ctrl+Z`) */
export interface ShortcutsSheetRow {
    id: string
    label: string
    keys: string[]
}

/** A group of rows of the {@link ShortcutsSheet}: the `group` of the actions */
export interface ShortcutsSheetGroup {
    name: string
    rows: ShortcutsSheetRow[]
}

/**
 * The rows of the {@link ShortcutsSheet}: the actions that have a key, in groups (in the order of the first action of
 * each group), with the labels of their keys.
 * @param actions - the actions (`viewer.actions.list()`)
 * @param shortcutOf - the key or keys of an action now (`viewer.actions.shortcutOf`: the key that the app set, else its own)
 * @param query - only the rows whose label, key or group has this text (any case); empty: all the rows
 * @param otherGroup - the name of the group of the actions without one
 * @param mac - Mac labels of the keys (⌘, ⌥, ⇧). Default: the platform of the browser.
 */
export function shortcutsSheetGroups(actions: ViewerAction[], shortcutOf: (id: string) => string | string[] | undefined, query = '', otherGroup = 'Other', mac?: boolean): ShortcutsSheetGroup[] {
    const q = query.trim().toLowerCase()
    const groups = new Map<string, ShortcutsSheetRow[]>()
    for (const a of actions) {
        const shortcuts = shortcutsOf(shortcutOf(a.id))
        const keys = shortcuts.map(k => formatShortcut(k, mac))
        if (!keys.length) continue
        const name = a.group || otherGroup
        // the search also takes the names of the keys, where the labels are symbols (a Mac): Ctrl or Cmd, Alt or Option
        const words = shortcuts.map(k => formatShortcut(k, false)).flatMap(w => [w, w.replace(/\bCtrl\b/, 'Cmd').replace(/\bAlt\b/, 'Option')])
        if (q && ![a.label, name, ...keys, ...words].some(t => t.toLowerCase().includes(q))) continue
        if (!groups.has(name)) groups.set(name, [])
        groups.get(name)!.push({id: a.id, label: a.label, keys})
    }
    return [...groups].map(([name, rows]) => ({name, rows}))
}

/** Options of a {@link ShortcutsSheet} */
export interface ShortcutsSheetOptions {
    /** The title. Default: `Keyboard shortcuts` */
    title?: string
    /** The name of the group of the actions without one. Default: `Other` */
    otherGroup?: string
}

/**
 * A sheet of all the keyboard shortcuts of a viewer: the actions in its `viewer.actions` that have a key, in their
 * groups, with the keys that the app set (`setShortcut`), and a search field. It shows the keys of each action as they
 * are now, so a plugin that adds actions, or an app that changes keys, needs no change here. It changes when the
 * actions change while it is open.
 *
 * It is a modal dialog: Escape, the close button, a click outside it or `?` closes it. While it is open, no key runs a
 * shortcut of the viewer (`viewer.actions` takes no key behind an open modal dialog), and its keys do not reach the page. It uses the colours of the Tweakpane theme. `EditorFrame` opens it
 * from a button of the mode bar and with `?` (the action `editorFrame.shortcuts`); an app without the frame makes one:
 *
 * ```ts
 * const sheet = new ShortcutsSheet(viewer.actions)
 * sheet.open()
 * ```
 */
/** The number of sheets made, for an id of each title */
let sheetCount = 0

export class ShortcutsSheet {
    private _dialog?: HTMLDialogElement
    private _search?: HTMLInputElement
    private _body?: HTMLDivElement
    private _styles?: HTMLStyleElement

    /**
     * @param actions - the actions to list: `viewer.actions` (or the own `ViewerActions` of a UI without a viewer)
     * @param options - the title, the name of the group of the actions without one
     */
    constructor(readonly actions: ViewerActions, readonly options: ShortcutsSheetOptions = {}) {}

    get isOpen() {
        return !!this._dialog?.open
    }

    open() {
        if (this.isOpen) return
        const d = this._dialog ?? this._create()
        this.actions.addEventListener('actionsChange', this._render)
        this._search!.value = ''
        this._render()
        // the first focus, set before showModal, which focuses the element with autofocus (else the first field): the
        // search field takes the keys at once with a mouse; on a touch screen it would open the keyboard, so the list
        const fine = !!window.matchMedia?.('(pointer: fine)').matches
        this._search!.toggleAttribute('autofocus', fine)
        this._body!.toggleAttribute('autofocus', !fine)
        d.showModal()
    }

    close() {
        this.actions.removeEventListener('actionsChange', this._render)
        if (this._dialog?.open) this._dialog.close()
    }

    toggle() {
        if (this.isOpen) this.close()
        else this.open()
    }

    dispose() {
        this.close()
        this._dialog?.remove()
        this._dialog = undefined
        this._styles?.remove()
        this._styles = undefined
    }

    private _create() {
        this._styles = createStyles(styles)
        const d = document.createElement('dialog')
        d.className = 'sks-root'
        const titleId = 'sks-title-' + ++sheetCount
        d.setAttribute('aria-labelledby', titleId)
        d.innerHTML = '<div class="sks-card"><div class="sks-head"><h2></h2><input type="search" placeholder="Search" aria-label="Search the shortcuts"><button type="button" class="sks-close" aria-label="Close">×</button></div><div class="sks-body" tabindex="-1"></div></div>'
        const h2 = d.querySelector('h2')!
        h2.id = titleId
        h2.textContent = this.options.title ?? 'Keyboard shortcuts'
        this._search = d.querySelector('input')!
        this._body = d.querySelector('.sks-body')!
        this._search.addEventListener('input', this._render)
        d.querySelector('.sks-close')!.addEventListener('click', () => this.close())
        // the backdrop: a click on the dialog element itself, not on the card in it; the press must start there too, so
        // a drag from the card (a text selection in the search field) that ends outside does not close it
        let downOnBackdrop = false
        d.addEventListener('pointerdown', e => downOnBackdrop = e.target === d)
        d.addEventListener('click', e => e.target === d && downOnBackdrop && this.close())
        d.addEventListener('keydown', this._onKeyDown)
        // Escape of the browser (also the back gesture on Android): the sheet closes itself, so its listeners go
        d.addEventListener('cancel', e => {
            e.preventDefault()
            this.close()
        })
        document.body.appendChild(d)
        this._dialog = d
        return d
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        // the keys of the sheet do not reach the page (other key listeners); the shortcuts of the viewer are off while a
        // modal dialog is open (viewer.actions), also for a key with the focus on the body
        e.stopPropagation()
        const typing = e.target === this._search
        if (e.key === 'Escape' || e.key === '?' && !typing) {
            e.preventDefault()
            this.close()
        }
    }

    private _render = () => {
        const body = this._body
        if (!body) return
        const a = this.actions
        const groups = shortcutsSheetGroups(a.list(), id => a.shortcutOf(id), this._search?.value, this.options.otherGroup)
        body.replaceChildren()
        if (!groups.length) {
            const p = document.createElement('p')
            p.className = 'sks-empty'
            p.textContent = this._search?.value ? 'No shortcut matches the search' : 'No shortcuts'
            body.appendChild(p)
            return
        }
        // the columns in a box of their own height: the body scrolls down, the columns do not overflow to the side
        const columns = document.createElement('div')
        columns.className = 'sks-columns'
        body.appendChild(columns)
        for (const g of groups) {
            const section = document.createElement('section')
            const h = document.createElement('h3')
            h.textContent = g.name
            section.appendChild(h)
            for (const r of g.rows) {
                const row = document.createElement('p')
                row.className = 'sks-row'
                const label = document.createElement('span')
                label.textContent = r.label
                const keys = document.createElement('span')
                keys.className = 'sks-keys'
                r.keys.forEach((k, i) => {
                    if (i) keys.append(Object.assign(document.createElement('i'), {textContent: 'or'}))
                    keys.append(Object.assign(document.createElement('kbd'), {textContent: k}))
                })
                row.append(label, keys)
                section.appendChild(row)
            }
            columns.appendChild(section)
        }
    }
}
