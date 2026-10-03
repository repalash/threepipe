/**
 * `EditorEnginePlugin` - the {@link EditorEngine}.
 *
 * One object per viewer that owns what the plugins underneath it each used to own a piece of: the
 * operator and tool registries, the keymap (presets, one input router), the one undo history with a
 * label per step, redo-last, status hints, and the events a UI renders from. `MeshEditPlugin`,
 * `ModellingPlugin`, `PickingPlugin`, `TransformControlsPlugin` and `UndoManagerPlugin` do the work;
 * their own key handlers are switched off by flag while this plugin is present, so one key means one
 * thing.
 *
 * Blender is the model throughout: `wmOperatorType` for operators (`poll`/`exec`/flags),
 * `ED_undo_operator_repeat` for the redo panel, `WM_menu_invoke` for keys that open a menu, the
 * default and Industry Compatible keymaps for the presets.
 */

import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    IObject3D,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
} from 'threepipe'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {SelectMode} from '@threepipe/mesh-kernel'
import {
    EditorContext,
    EditorEngine,
    EditorEngineEventMap,
    EditorMode,
    InputApi,
    KeyBinding,
    KeymapApi,
    KeymapPreset,
    LabelledUndoCommand,
    LastOperation,
    MenuRequestItem,
    OperatorDescriptor,
    OperatorResult,
    SceneStats,
    SelectModeName,
    SimpleRegistry,
    StatusHints,
    ToolDescriptor,
} from './registry'
import {EditorHistory} from './history/EditorHistory'
import {Keymap} from './keymap/Keymap'
import {blenderPreset} from './keymap/presets/blender'
import {designPreset} from './keymap/presets/design'
import {InputRouter} from './input/InputRouter'
import {Navigation} from './input/Navigation'
import {registerEditOperators} from './ops/editOps'
import {registerFileOperators} from './ops/fileOps'
import {registerObjectOperators} from './ops/objectOps'
import {registerMeshOperators} from './ops/meshOps'
import {registerModellingOperators} from './ops/modellingOps'
import {registerTools} from './tools/tools'
import type {PropDragModal} from './tools/PropDragModal'

const SELECT_MASKS: Record<SelectModeName, number> = {
    vertex: SelectMode.Vertex,
    edge: SelectMode.Edge,
    face: SelectMode.Face,
}

export interface EditorEngineOptions {
    /** Keymap preset to start with. Default: the stored preference, else `blender`. */
    keymap?: string
    /** `localStorage` key for the keymap preference. `null` turns persistence off. */
    storageKey?: string | null
    /** Register the built-in operator packs and tools. Default true. */
    builtins?: boolean
}

type EngineEvents = EditorEngineEventMap & AViewerPluginEventMap

/** Tools that stay active (gizmo tools) rather than running once. */
const STICKY_TOOLS = new Set(['mesh.move', 'mesh.rotate', 'mesh.scale', 'mesh.transform'])

export class EditorEnginePlugin extends AViewerPluginSync<EngineEvents> implements EditorEngine {
    public static readonly PluginType = 'EditorEnginePlugin'
    enabled = true
    dependencies = []
    /** Not serialised: the engine is interaction state, not scene configuration. */
    toJSON: any = undefined

    readonly operators = new SimpleRegistry<OperatorDescriptor>(item => this._registryChanged(item))
    readonly tools = new SimpleRegistry<ToolDescriptor>(item => this._registryChanged(item))

    picking!: PickingPlugin
    undoPlugin!: UndoManagerPlugin
    meshEdit!: MeshEditPlugin
    modelling: ModellingPlugin | undefined
    transformControls: TransformControlsPlugin | undefined

    history!: EditorHistory
    input!: InputRouter
    navigation!: Navigation

    private _options: EditorEngineOptions
    private _presets: KeymapPreset[] = [blenderPreset, designPreset]
    private _keymap = new Keymap(blenderPreset)
    private _activeTool: ToolDescriptor | null = null
    private _lastOperation: LastOperation | null = null
    private _lastStep: unknown = null
    private _pendingModal: {operator: OperatorDescriptor, props: Record<string, unknown>} | null = null
    private _redoing = false
    private _preferredSelectMode: SelectModeName = 'vertex'
    private _disposers: (() => void)[] = []
    private _disposed = false
    /** A running engine-side modal (interactive inset/bevel), if any. Owns keys and the pointer. */
    propDrag: PropDragModal | null = null

    constructor(options: EditorEngineOptions = {}) {
        super()
        this._options = options
    }

    get viewer(): ThreeViewer {
        if (!this._viewer) throw new Error('EditorEnginePlugin: not added to a viewer yet')
        return this._viewer
    }

    // region lifecycle

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this._disposed = false
        this.picking = viewer.getOrAddPluginSync(PickingPlugin)
        this.undoPlugin = viewer.getOrAddPluginSync(UndoManagerPlugin)
        this.meshEdit = viewer.getOrAddPluginSync(MeshEditPlugin)
        this.modelling = viewer.getPlugin(ModellingPlugin)
        this.transformControls = viewer.getPlugin(TransformControlsPlugin)

        // One key, one owner: the plugins' own handlers stand down while the engine routes keys.
        this.picking.keyboardShortcuts = false
        this.meshEdit.keyHandling = false
        this._disposers.push(() => {
            this.picking.keyboardShortcuts = true
            this.meshEdit.keyHandling = true
        })
        // Clicking the selected object keeps it selected (cycling through objects behind it), as in
        // Blender, instead of clearing the selection.
        if (this.picking.picker) this.picking.picker.cycleWrap = true

        this.history = new EditorHistory(this.undoPlugin, () => this._historyChanged())
        this._disposers.push(() => this.history.dispose())

        this.navigation = new Navigation(viewer, () => this.meshEdit)
        this._disposers.push(() => this.navigation.dispose())

        this.input = new InputRouter({
            canvas: viewer.canvas,
            mode: () => this.mode,
            keymap: () => this._keymap,
            handleModalKey: e => this._handleModalKey(e),
            dispatch: (b, e) => this._dispatch(b, e),
            onSpace: down => this.navigation.setSpace(down),
        })
        this._disposers.push(() => this.input.dispose())

        this._listen()

        if (this._options.builtins !== false) {
            registerEditOperators(this)
            registerFileOperators(this)
            registerObjectOperators(this)
            registerMeshOperators(this)
            registerModellingOperators(this)
            registerTools(this)
        }

        const stored = this._storedPreset()
        this.keymap.setPreset(this._options.keymap ?? stored ?? blenderPreset.id)
        if (this.tools.get('select')) this.setActiveTool('select')
    }

    onRemove(viewer: ThreeViewer): void {
        this.dispose()
        super.onRemove(viewer)
    }

    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        this.propDrag?.cancel()
        this._activeTool?.deactivate(this.context())
        this._activeTool = null
        for (const d of this._disposers.splice(0).reverse()) d()
        super.dispose()
    }

    private _on<T extends {addEventListener: any, removeEventListener: any}>(target: T, type: string, listener: (e: any) => void): void {
        target.addEventListener(type as never, listener as never)
        this._disposers.push(() => target.removeEventListener(type as never, listener as never))
    }

    private _listen(): void {
        const viewer = this.viewer
        this._on(this.meshEdit, 'editModeChanged', (e: {object: IObject3D | null}) => {
            if (e.object && this.meshEdit.state) {
                // Enter in the select mode the user last chose from the header.
                this.meshEdit.setSelectMode(SELECT_MASKS[this._preferredSelectMode])
                this._adoptIntoDocument(e.object)
            }
            // A sticky edit-mode tool makes no sense across a mode switch.
            if (this._activeTool && this._activeTool.modes && !this._activeTool.modes.includes(this.mode)) {
                this.setActiveTool('select')
            }
            this.navigation.apply(this._keymap.preset.navigation, this.mode)
            this._applyShortcuts()
            this.dispatchEvent({type: 'modeChanged', mode: this.mode})
            this.dispatchEvent({type: 'selectModeChanged', selectMode: this.selectMode})
            this.dispatchEvent({type: 'selectionChanged'})
            this.dispatchEvent({type: 'sceneChanged'})
            this._statusChanged()
        })
        this._on(this.meshEdit, 'elementSelectionChanged', () => {
            const m = this.selectMode
            if (m !== this._preferredSelectMode) {
                this._preferredSelectMode = m
                this.dispatchEvent({type: 'selectModeChanged', selectMode: m})
            }
            this.dispatchEvent({type: 'selectionChanged'})
        })
        this._on(this.meshEdit, 'transformChanged', (e: {transform: unknown}) => {
            this._statusChanged()
            // A one-shot edit-mode tool (move/rotate/scale/extrude) hands the toolbar back when its modal ends.
            // Gizmo tools stay active across drags, as Blender's do.
            if (!e.transform && this._activeTool?.id.startsWith('mesh.') && !STICKY_TOOLS.has(this._activeTool.id)) this.setActiveTool('select')
        })
        this._on(this.meshEdit, 'meshChanged', () => this.dispatchEvent({type: 'sceneChanged'}))
        // Edit mode reports what it could not do; show it rather than leave it in the console.
        this._on(this.meshEdit, 'notice', (e: {message: string, level: 'info' | 'warning'}) => this.message(e.level, e.message))
        this._on(this.picking, 'selectedObjectChanged', (e: {object?: IObject3D | IObject3D[] | null}) => {
            // The picker records a selection step (Blender's object-mode selection is an undo step too)
            // right after this event; name it after the object, since the picker does not.
            const obj = Array.isArray(e.object) ? e.object[e.object.length - 1] : e.object
            const label = obj ? `Select ${obj.name || 'object'}` : 'Deselect'
            this.history.noteEvent(label)
            this.history.labelLastRecorded(label)
            this.dispatchEvent({type: 'selectionChanged'})
        })
        this._on(viewer.scene, 'sceneUpdate', (e: {hierarchyChanged?: boolean}) => {
            if (e.hierarchyChanged) this.dispatchEvent({type: 'sceneChanged'})
        })
        this._on(viewer.scene, 'addSceneObject', () => this.dispatchEvent({type: 'sceneChanged'}))
        this._on(viewer.scene, 'objectUpdate', (e: {change?: string, key?: string}) => {
            const k = e.change ?? e.key
            if (k === 'name' || k === 'visible' || k === 'indexInParent' || k === 'addedToParent' || k === 'removedFromParent') {
                this.dispatchEvent({type: 'sceneChanged'})
            }
        })
        if (this.modelling) {
            this._on(this.modelling, 'documentChanged', (e: {source?: string}) => {
                // A command, or an undo of one, changed the document underneath a live edit session:
                // the session is a view of the document, so it reloads. A sink change came *from* the
                // session and needs nothing.
                if (e.source !== 'sink' && this.meshEdit.isEditing && this.meshEdit.editObject) {
                    const entry = this.modelling!.document.find(this.meshEdit.editObject.uuid)
                    if (entry) this.meshEdit.reload()
                }
                this.dispatchEvent({type: 'sceneChanged'})
            })
        }
        if (this.transformControls?.transformControls) {
            this._on(this.transformControls.transformControls as any, 'mode-changed', () => this.dispatchEvent({type: 'toolChanged', tool: this._activeTool}))
        }
    }

    /**
     * An object entering edit mode joins the modelling document if it is not in it already, so an
     * imported mesh gets the same commands (inset, bevel, delete menu, ...), redo-last and agent API as
     * a primitive made here. The session's welded topology becomes the document's master mesh - the
     * same bake the session would write back on its first commit.
     */
    private _adoptIntoDocument(object: IObject3D): void {
        const modelling = this.modelling
        const state = this.meshEdit.state
        if (!modelling || !state || modelling.document.find(object.uuid)) return
        modelling.document.adopt(object, state.mesh.clone())
        modelling.dispatchEvent({type: 'documentChanged', document: modelling.document, source: 'sink'})
    }

    private _statusChanged(): void {
        this.dispatchEvent({type: 'statusChanged', hints: this.status})
    }

    private _registryChanged(item?: {id: string, shortcut?: string}): void {
        if (item) item.shortcut = this._keymap.shortcutFor(item.id, this.mode)
        this.dispatchEvent({type: 'registryChanged'})
    }

    private _historyChanged(): void {
        if (this._disposed) return
        // Blender drops the redo panel once its step is no longer the top of the stack (an undo, or any
        // other undoable action after it). Not while redo-last itself is popping and re-pushing.
        if (this._lastStep && !this._redoing && this.history.peek() !== this._lastStep) this.setLastOperation(null)
        queueMicrotask(() => !this._disposed && this.dispatchEvent({type: 'historyChanged'}))
    }

    // endregion

    // region keymap and input

    readonly keymap: KeymapApi = {
        presets: [] as KeymapPreset[],
        activePreset: blenderPreset,
        setPreset: (id: string) => this._setPreset(id),
        shortcutFor: (id: string, mode?: EditorMode) => this._keymap.shortcutFor(id, mode ?? this.mode),
        bindingsFor: (id: string) => this._keymap.bindingsFor(id),
    }

    /** Add a preset of your own (an app's house keymap). Replaces one with the same id. */
    registerPreset(preset: KeymapPreset): void {
        const i = this._presets.findIndex(p => p.id === preset.id)
        if (i >= 0) this._presets[i] = preset
        else this._presets.push(preset)
        if (this._keymap.preset.id === preset.id) this._setPreset(preset.id)
        ;(this.keymap as {presets: KeymapPreset[]}).presets = [...this._presets]
    }

    private _setPreset(id: string): void {
        const preset = this._presets.find(p => p.id === id) ?? this._presets[0]
        this._keymap = new Keymap(preset)
        ;(this.keymap as {presets: KeymapPreset[], activePreset: KeymapPreset}).presets = [...this._presets]
        ;(this.keymap as {activePreset: KeymapPreset}).activePreset = preset
        this.navigation.apply(preset.navigation, this.mode)
        this._applyShortcuts()
        const key = this._options.storageKey === undefined ? 'threepipe-editor-keymap' : this._options.storageKey
        if (key) {
            try { localStorage.setItem(key, preset.id) } catch { /* private mode */ }
        }
        this.dispatchEvent({type: 'keymapChanged', preset: preset.id})
        this.dispatchEvent({type: 'registryChanged'})
        this._statusChanged()
    }

    private _storedPreset(): string | undefined {
        const key = this._options.storageKey === undefined ? 'threepipe-editor-keymap' : this._options.storageKey
        if (!key) return undefined
        try { return localStorage.getItem(key) ?? undefined } catch { return undefined }
    }

    /** Every operator and tool shows the key the active preset gives it in the current mode. */
    private _applyShortcuts(): void {
        for (const op of this.operators.list()) op.shortcut = this._keymap.shortcutFor(op.id, this.mode)
        for (const t of this.tools.list()) t.shortcut = this._keymap.shortcutFor(t.id, this.mode)
    }

    private _handleModalKey(event: KeyboardEvent): boolean {
        if (this.propDrag) return this.propDrag.handleKey(event)
        if (this.meshEdit.activeTransform) return this.meshEdit.handleModalKey(event)
        return false
    }

    private _dispatch(binding: KeyBinding, _event: KeyboardEvent): void {
        if (binding.tool) this.setActiveTool(binding.id)
        else void this.run(binding.id, binding.props)
    }

    /** Ask the shell to open a popup menu at the cursor (Blender's `wm.call_menu`). */
    requestMenu(title: string, items: MenuRequestItem[]): void {
        const {clientX, clientY} = this.input.pointer
        this.dispatchEvent({type: 'uiRequest', request: 'menu', title, items, clientX, clientY})
    }

    // endregion

    // region mode

    get mode(): EditorMode {
        return this.meshEdit.isEditing ? 'edit' : 'object'
    }

    setMode(mode: EditorMode): boolean {
        if (mode === this.mode) return true
        if (mode === 'edit') {
            const selected = this.picking.getSelectedObject<IObject3D>()
            if (!selected?.isObject3D || !selected.geometry) {
                this.message('warning', 'Select a mesh first, then switch to Edit mode (Tab).')
                return false
            }
            const ok = this.meshEdit.enter(selected)
            if (!ok) this.message('error', 'Could not enter edit mode on the selected object.')
            return ok
        }
        this.propDrag?.cancel()
        if (this.meshEdit.activeTransform) this.meshEdit.cancelTransform()
        this.meshEdit.exit(true)
        return true
    }

    get selectMode(): SelectModeName {
        if (this.meshEdit.isEditing) {
            const m = this.meshEdit.selectMode
            if (m & SelectMode.Face) return 'face'
            if (m & SelectMode.Edge) return 'edge'
            return 'vertex'
        }
        return this._preferredSelectMode
    }

    setSelectMode(mode: SelectModeName): void {
        this._preferredSelectMode = mode
        if (this.meshEdit.isEditing) this.meshEdit.setSelectMode(SELECT_MASKS[mode])
        this.dispatchEvent({type: 'selectModeChanged', selectMode: mode})
        this.dispatchEvent({type: 'selectionChanged'})
    }

    // endregion

    // region tools

    get activeTool(): ToolDescriptor | null {
        return this._activeTool
    }

    setActiveTool(id: string | null): void {
        const next = id ? this.tools.get(id) ?? null : null
        const ctx = this.context()
        if (next === this._activeTool) {
            // Re-activating a one-shot tool (extrude, inset, bevel) runs it again; sticky ones stay as they are.
            if (next && next.id.startsWith('mesh.') && !STICKY_TOOLS.has(next.id)) next.activate(ctx)
            return
        }
        if (next?.poll) {
            const p = next.poll(ctx)
            if (p !== true && p !== undefined) {
                if (typeof p === 'string') this.message('info', p)
                return
            }
        }
        this._activeTool?.deactivate(ctx)
        this._activeTool = next
        next?.activate(ctx)
        this.dispatchEvent({type: 'toolChanged', tool: next})
        this._statusChanged()
    }

    // endregion

    // region operators

    get lastOperation(): LastOperation | null {
        return this._lastOperation
    }

    /**
     * Set the redo-last panel's operation. `step` is the undo step the operation pushed; with it the
     * operation can be re-run (pop that step, exec with new props, push again). Without it the panel
     * shows the values read-only.
     */
    setLastOperation(op: {operator: OperatorDescriptor, props: Record<string, unknown>, step?: unknown} | null): void {
        this._lastStep = op?.step ?? null
        this._lastOperation = op ? {
            operator: op.operator,
            props: op.props,
            redo: op.step ? (newProps: Record<string, unknown>) => this._redoLast(op.operator, op.step, newProps) : undefined,
        } : null
        this.dispatchEvent({type: 'lastOperationChanged', operation: this._lastOperation})
    }

    /**
     * Blender's `ED_undo_operator_repeat` (ed_undo.cc:651): pop the operator's undo step
     * (`ED_undo_pop_op`), run it again with the new properties (`WM_operator_repeat`), and if that
     * fails put the old result back (`ED_undo_redo`, :706).
     */
    private async _redoLast(op: OperatorDescriptor, step: unknown, props: Record<string, unknown>): Promise<OperatorResult> {
        if (this._redoing) return {ok: false, error: 'a redo is already running'}
        this._redoing = true
        try {
            const undone = this.history.undoTo(step as object)
            if (undone < 0) {
                this.setLastOperation(null)
                return {ok: false, error: `${op.label} can no longer be adjusted: its step has left the undo history`}
            }
            const result = await this.run(op.id, props)
            if (!result.ok) {
                for (let i = 0; i < undone; i++) this.history.redo()
            }
            return result
        } finally {
            this._redoing = false
        }
    }

    /**
     * A modal operator's bookkeeping, once the modal has ended: the final props and the undo step it
     * pushed. Called by the mesh-edit bridge on `transformCommitted`.
     */
    completeModal(operatorId: string, props: Record<string, unknown>): void {
        const operator = this.operators.get(operatorId)
        if (!operator) return
        const step = this.history.peek()
        this._pendingModal = null
        if (operator.flags?.register) this.setLastOperation({operator, props, step: step ?? undefined})
    }

    /** The operator whose modal is running, if the last `run` started one. */
    get pendingModal(): {operator: OperatorDescriptor, props: Record<string, unknown>} | null {
        return this._pendingModal
    }

    context(): EditorContext {
        return {
            viewer: this.viewer,
            engine: this,
            mode: this.mode,
            selectMode: this.selectMode,
            selectedObjects: this.picking.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D),
            editObject: this.meshEdit.editObject,
        }
    }

    poll(op: OperatorDescriptor, ctx = this.context()): {enabled: boolean, reason?: string} {
        if (op.modes && !op.modes.includes(ctx.mode)) return {enabled: false, reason: `Only in ${op.modes.join('/')} mode`}
        if (!op.poll) return {enabled: true}
        const r = op.poll(ctx)
        if (r === true || r === undefined) return {enabled: true}
        return {enabled: false, reason: typeof r === 'string' ? r : undefined}
    }

    async run(id: string, props?: Record<string, unknown>): Promise<OperatorResult> {
        const op = this.operators.get(id)
        if (!op) {
            this.message('error', `Unknown operator "${id}"`)
            return {ok: false, error: `unknown operator ${id}`}
        }
        const ctx = this.context()
        const polled = this.poll(op, ctx)
        if (!polled.enabled) {
            const reason = polled.reason ?? `${op.label} is not available right now`
            this.message('info', reason)
            return {ok: false, error: reason}
        }
        const topBefore = this.history.peek()
        // Steps the plugins underneath record without a label (the picker's delete, a property
        // set) are named after the operator that caused them.
        this.history.pendingLabel = op.label
        let result: OperatorResult
        try {
            result = await op.exec(ctx, props)
        } catch (e) {
            result = {ok: false, error: (e as Error)?.message ?? String(e)}
        } finally {
            this.history.pendingLabel = null
        }
        if (!result.ok && result.error) this.message('error', `${op.label}: ${result.error}`)
        for (const w of result.warnings ?? []) this.message('warning', w)
        if (result.ok && op.flags?.register) {
            const finalProps = result.props ?? props ?? {}
            if (result.modal) {
                this._pendingModal = {operator: op, props: finalProps}
            } else {
                const top = this.history.peek()
                this.setLastOperation({operator: op, props: finalProps, step: top && top !== topBefore ? top : undefined})
            }
        }
        this.viewer.setDirty()
        this.dispatchEvent({type: 'selectionChanged'})
        return result
    }

    record(cmd: LabelledUndoCommand): void {
        this.history.record(cmd)
    }

    message(level: 'info' | 'warning' | 'error', text: string): void {
        this.dispatchEvent({type: 'message', level, text})
    }

    // endregion

    // region status and stats

    get status(): StatusHints | null {
        if (this.propDrag) return this.propDrag.hints()
        const t = this.meshEdit.activeTransform
        if (t) {
            return {
                modal: t.status,
                lmb: 'Confirm',
                rmb: 'Cancel',
                keys: [
                    {key: 'X / Y / Z', label: 'Lock axis'},
                    {key: 'Shift+X/Y/Z', label: 'Lock plane'},
                    {key: '0-9', label: 'Type a value'},
                    {key: 'Shift', label: 'Precision'},
                    {key: 'Enter', label: 'Confirm'},
                    {key: 'Esc', label: 'Cancel'},
                ],
            }
        }
        const nav = this.navigation.hints()
        if (this._activeTool?.hints) {
            const h = this._activeTool.hints
            return {...h, mmb: h.mmb ?? nav.mmb, rmb: h.rmb ?? nav.rmb, keys: [...(h.keys ?? []), ...nav.extra]}
        }
        // The keys that matter most in each mode, read from the active keymap so they are never stale.
        const hintOps: [string, string][] = this.mode === 'edit'
            ? [['mesh.extrude', 'Extrude'], ['mesh.move', 'Move'], ['mesh.delete', 'Delete'], ['mesh.exit_edit', 'Object mode']]
            : [['object.enter_edit', 'Edit mode'], ['add.menu', 'Add'], ['object.delete', 'Delete'], ['ui.command_palette', 'Search']]
        const keys: {key: string, label: string}[] = []
        for (const [id, label] of hintOps) {
            const key = this._keymap.shortcutFor(id, this.mode)
            if (key) keys.push({key, label})
        }
        return {
            lmb: this.mode === 'edit' ? `${nav.lmb} (Shift: extend)` : `${nav.lmb} (Shift: extend)`,
            mmb: nav.mmb,
            rmb: nav.rmb,
            keys: [...keys, ...nav.extra],
        }
    }

    stats(): SceneStats {
        const state = this.meshEdit.state
        if (this.mode === 'edit' && state) {
            const bm = state.bm
            return {
                objects: this._countObjects(),
                verts: bm.totvert, edges: bm.totedge, faces: bm.totface,
                selected: [bm.totvertsel, bm.totedgesel, bm.totfacesel],
            }
        }
        let verts = 0
        let faces = 0
        let objects = 0
        this.walkModel(o => {
            objects++
            const g = o.geometry
            if (!g || !(o as any).isMesh) return
            const pos = g.getAttribute('position')
            verts += pos?.count ?? 0
            const idx = g.getIndex()
            faces += Math.floor((idx ? idx.count : pos?.count ?? 0) / 3)
        })
        return {objects, verts, edges: 0, faces, selected: [this.picking.getSelectedObjects().length]}
    }

    /** Visit the user's objects, skipping widget subtrees (gizmos, edit overlays, helpers). */
    walkModel(fn: (o: IObject3D) => void): void {
        const visit = (o: IObject3D) => {
            if ((o as any).isWidget || o.assetType === 'widget' || o.userData?.isWidgetRoot) return
            if (o !== this.viewer.scene.modelRoot) fn(o)
            for (const c of o.children) visit(c as IObject3D)
        }
        visit(this.viewer.scene.modelRoot)
    }

    /** The user's top-level objects (direct children of the model root that are not widgets). */
    modelObjects(): IObject3D[] {
        return this.viewer.scene.modelRoot.children.filter(c => !(c as any).isWidget && (c as IObject3D).assetType !== 'widget' && !c.userData?.isWidgetRoot) as IObject3D[]
    }

    private _countObjects(): number {
        let n = 0
        this.walkModel(() => n++)
        return n
    }

    // endregion
}

/** The engine for a viewer, adding it (and what it needs) when absent. */
export function createEditorEngine(viewer: ThreeViewer, options?: EditorEngineOptions): EditorEnginePlugin {
    const existing = viewer.getPlugin(EditorEnginePlugin)
    if (existing) return existing
    return viewer.addPluginSync(new EditorEnginePlugin(options))
}

// Re-exported for the shell's convenience: the engine's `input` satisfies the public `InputApi`.
export type {InputApi}
