import {createStyles, ISerializedConfig, onChange, SerializationMetaType, serialize, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {NotesPlugin, NotesPluginOptions} from './NotesPlugin'
import styles from './StickyNotesPlugin.css?inline'

export type StickyNotesColor = 'yellow' | 'pink' | 'blue' | 'green' | 'theme'

/** Where the note is and if it is collapsed, kept in `localStorage` */
interface StickyState {
    x?: number
    y?: number
    collapsed?: boolean
}

/**
 * Sticky Notes Plugin
 *
 * The notes of {@link NotesPlugin} (scene notes saved in the file, page notes in the browser, "+ Context") as a
 * post-it over the canvas: drag it by its header, collapse it with "–". Its place and the collapsed state are kept in
 * `localStorage`, per {@link pageKey}.
 *
 * The plugin's UI folder (Sticky Notes) has the settings, not the notes: show or hide the note, its colour, collapse,
 * if the scene notes are saved in the file, put the note back in its corner, and clear the scene notes.
 *
 * @category Plugins
 */
export class StickyNotesPlugin extends NotesPlugin {
    static readonly PluginType = 'StickyNotesPlugin'
    /** Adds the stylesheet of the note to the page when the first one is made. Off: the page styles the `snp-` classes. */
    static InjectStyles = true
    private static _stickyStyles?: HTMLStyleElement

    /** The colour of the note. `theme`: the colours of the Tweakpane theme */
    @serialize()
    @onChange(StickyNotesPlugin.prototype._applyLook)
        color: StickyNotesColor = 'yellow'

    /** The scene notes are saved in the viewer config, so in an exported .glb. Off: they stay out of the file. */
    @serialize()
        saveSceneNotes = true

    /** The note is on the canvas */
    @onChange(StickyNotesPlugin.prototype._applyLook)
        shown = true

    /** Only the header of the note is shown */
    @onChange(StickyNotesPlugin.prototype._collapsedChanged)
        collapsed = false

    /** The post-it: a header (title, where the notes are kept, collapse) above {@link element} */
    readonly card: HTMLDivElement
    private _collapseButton: HTMLButtonElement
    private _x?: number
    private _y?: number

    uiConfig: UiObjectConfig

    constructor(options: NotesPluginOptions = {}) {
        super(options)
        if (StickyNotesPlugin.InjectStyles && !StickyNotesPlugin._stickyStyles?.isConnected) StickyNotesPlugin._stickyStyles = createStyles(styles)

        this.card = document.createElement('div')
        this.card.className = 'snp-card'
        const head = document.createElement('div')
        head.className = 'snp-head'
        head.title = 'Drag to move'
        const title = document.createElement('b')
        title.textContent = 'Notes'
        this._collapseButton = document.createElement('button')
        this._collapseButton.className = 'snp-collapse'
        this._collapseButton.addEventListener('click', () => this.collapsed = !this.collapsed)
        head.appendChild(title)
        head.appendChild(this._collapseButton)
        head.addEventListener('pointerdown', this._dragStart)
        this.card.appendChild(head)
        this.card.appendChild(this.element)

        const state = this._readState()
        this._x = state.x
        this._y = state.y
        this.collapsed = !!state.collapsed
        this._renderCollapsed()

        this.uiConfig = {
            type: 'folder',
            label: 'Sticky Notes',
            children: [
                {type: 'checkbox', label: 'Show', property: [this, 'shown']},
                {
                    type: 'dropdown', label: 'Colour', property: [this, 'color'],
                    children: (['yellow', 'pink', 'blue', 'green', 'theme'] as const).map(c => ({label: c[0].toUpperCase() + c.slice(1), value: c})),
                },
                {type: 'checkbox', label: 'Collapsed', property: [this, 'collapsed']},
                {type: 'checkbox', label: 'Save in the file', property: [this, 'saveSceneNotes']},
                {type: 'button', label: 'Reset position', value: () => this.resetPosition()},
                {type: 'button', label: 'Clear scene notes', value: () => this.sceneNotes = ''},
            ],
        }
        this._applyLook()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.container.appendChild(this.card)
        this._place()
        window.addEventListener('resize', this._place)
    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('resize', this._place)
        super.onRemove(viewer)
        this.card.remove()
    }

    toJSON(meta?: SerializationMetaType): ISerializedConfig {
        const data = super.toJSON(meta)
        if (!this.saveSceneNotes) delete data.sceneNotes
        return data
    }

    /** Puts the note back in the bottom left corner of the canvas */
    resetPosition() {
        this._x = this._y = undefined
        this._place()
        this._writeState()
    }

    private _applyLook() {
        if (!this.card) return // the field initializers, before the card exists
        this.card.dataset.color = this.color
        this.card.style.display = this.shown ? '' : 'none'
    }

    private _collapsedChanged() {
        if (!this._collapseButton) return // the field initializer, before the card exists
        this._renderCollapsed()
        this._place() // a note expanded near the bottom moves up, to stay inside the canvas
        this._writeState()
        this.uiConfig?.uiRefresh?.(true)
    }

    private _renderCollapsed() {
        this.card.classList.toggle('snp-collapsed', this.collapsed)
        const b = this._collapseButton
        b.textContent = this.collapsed ? '+' : '–'
        b.title = this.collapsed ? 'Expand' : 'Collapse'
    }

    /** Sets the place of the note, kept inside the canvas; none set: the bottom left corner */
    private _place = () => {
        const c = this.card
        if (this._x === undefined || this._y === undefined) {
            c.style.left = c.style.top = c.style.bottom = ''
            return
        }
        const parent = c.parentElement
        const maxX = Math.max(0, (parent?.clientWidth ?? 0) - c.offsetWidth)
        const maxY = Math.max(0, (parent?.clientHeight ?? 0) - c.offsetHeight)
        c.style.left = Math.min(Math.max(0, this._x), maxX) + 'px'
        c.style.top = Math.min(Math.max(0, this._y), maxY) + 'px'
        c.style.bottom = 'auto'
    }

    private _dragStart = (e: PointerEvent) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
        e.preventDefault()
        const head = e.currentTarget as HTMLElement
        const sx = e.clientX - this.card.offsetLeft
        const sy = e.clientY - this.card.offsetTop
        head.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => {
            this._x = ev.clientX - sx
            this._y = ev.clientY - sy
            this._place()
        }
        const up = () => {
            head.removeEventListener('pointermove', move)
            head.removeEventListener('pointerup', up)
            head.removeEventListener('pointercancel', up)
            this._writeState()
        }
        head.addEventListener('pointermove', move)
        head.addEventListener('pointerup', up)
        head.addEventListener('pointercancel', up)
    }

    private _readState(): StickyState {
        try {
            return JSON.parse(localStorage.getItem(this.pageKey + ':sticky') || '{}')
        } catch (e) {
            return {} // no storage, or not JSON
        }
    }

    private _writeState() {
        if (!this.card) return
        try {
            localStorage.setItem(this.pageKey + ':sticky', JSON.stringify({x: this._x, y: this._y, collapsed: this.collapsed}))
        } catch (e) {
            // no storage: this page only
        }
    }
}
