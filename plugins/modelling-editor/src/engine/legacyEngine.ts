/**
 * `LegacyEditorEngine` - an {@link EditorEngine} over the plugins that exist today.
 *
 * The interaction engine in `@threepipe/plugin-mesh-edit` is being rebuilt around an operator
 * registry, an input router and a unified undo stack. Until it lands, this adapter presents the
 * current `MeshEditPlugin`, `ModellingPlugin`, `PickingPlugin`, `TransformControlsPlugin` and
 * `UndoManagerPlugin` APIs through the same interfaces the shell renders from, so the UI needs no
 * change when the real engine replaces it. Nothing here is meant to outlive that: keymaps still
 * live in the plugins, and undo bridging between `ModellingHistory` and `UndoManagerPlugin` is a
 * stop-gap (see `_bridgeModellingHistory`).
 *
 * Operators and tools are registered from the `ops/*` modules; each is a plain list of descriptors.
 */

import {
    EventDispatcher,
    IObject3D,
    JSUndoManager,
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
    HistoryApi,
    HistoryEntry,
    LastOperation,
    OperatorDescriptor,
    OperatorResult,
    SceneStats,
    SelectModeName,
    SimpleRegistry,
    StatusHints,
    ToolDescriptor,
} from '../registry'
import {EditorViewportPlugin} from '../EditorViewportPlugin'
import {registerFileOperators} from './ops/fileOps'
import {registerObjectOperators} from './ops/objectOps'
import {registerMeshOperators} from './ops/meshOps'
import {registerViewOperators} from './ops/viewOps'
import {registerModellingOperators} from './ops/modellingOps'
import {registerTools} from './ops/tools'

const SELECT_MASKS: Record<SelectModeName, number> = {
    vertex: SelectMode.Vertex,
    edge: SelectMode.Edge,
    face: SelectMode.Face,
}

/** A command recorded on the undo stack by this adapter. `label` is what the history list shows. */
export interface LabelledUndoCommand {
    label: string
    undo: () => void
    redo: () => void
}

export class LegacyEditorEngine extends EventDispatcher<EditorEngineEventMap> implements EditorEngine {
    readonly operators = new SimpleRegistry<OperatorDescriptor>(() => this.dispatchEvent({type: 'registryChanged'}))
    readonly tools = new SimpleRegistry<ToolDescriptor>(() => this.dispatchEvent({type: 'registryChanged'}))

    readonly picking: PickingPlugin
    readonly undo: UndoManagerPlugin
    readonly meshEdit: MeshEditPlugin
    readonly modelling: ModellingPlugin | undefined
    readonly transformControls: TransformControlsPlugin | undefined
    readonly viewport: EditorViewportPlugin | undefined

    private _activeTool: ToolDescriptor | null = null
    private _lastOperation: LastOperation | null = null
    private _preferredSelectMode: SelectModeName = 'vertex'
    private _disposers: (() => void)[] = []
    private _disposed = false

    constructor(readonly viewer: ThreeViewer) {
        super()
        this.picking = viewer.getOrAddPluginSync(PickingPlugin)
        this.undo = viewer.getOrAddPluginSync(UndoManagerPlugin)
        this.meshEdit = viewer.getOrAddPluginSync(MeshEditPlugin)
        this.modelling = viewer.getPlugin(ModellingPlugin)
        this.transformControls = viewer.getPlugin(TransformControlsPlugin)
        this.viewport = viewer.getPlugin(EditorViewportPlugin)

        this._listen()
        this._bridgeUndoManager()
        this._bridgeModellingHistory()

        registerFileOperators(this)
        registerObjectOperators(this)
        registerMeshOperators(this)
        registerViewOperators(this)
        registerModellingOperators(this)
        registerTools(this)

        const select = this.tools.get('select')
        if (select) this.setActiveTool(select.id)
    }

    // region events

    private _on<T extends EventDispatcher<any>>(target: T, type: string, listener: (e: any) => void): void {
        target.addEventListener(type as never, listener as never)
        this._disposers.push(() => target.removeEventListener(type as never, listener as never))
    }

    private _listen(): void {
        const viewer = this.viewer
        this._on(this.meshEdit, 'editModeChanged', () => {
            if (this.mode === 'edit' && this.meshEdit.state) {
                // Enter in the select mode the user last chose from the header.
                this.meshEdit.setSelectMode(SELECT_MASKS[this._preferredSelectMode])
            }
            // A sticky edit-mode tool makes no sense across a mode switch.
            if (this._activeTool && this._activeTool.modes && !this._activeTool.modes.includes(this.mode)) {
                this.setActiveTool('select')
            }
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
            // Clicking a transform tool starts a one-shot modal; once it ends the toolbar falls back.
            if (!e.transform && this._activeTool?.id.startsWith('mesh.')) this.setActiveTool('select')
        })
        this._on(this.meshEdit, 'meshChanged', () => this.dispatchEvent({type: 'sceneChanged'}))
        this._on(this.picking, 'selectedObjectChanged', () => this.dispatchEvent({type: 'selectionChanged'}))
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
            this._on(this.modelling, 'documentChanged', () => this.dispatchEvent({type: 'sceneChanged'}))
        }
        if (this.viewport) {
            this._on(this.viewport, 'viewportChanged', () => this._statusChanged())
        }
        if (this.transformControls?.transformControls) {
            this._on(this.transformControls.transformControls as any, 'mode-changed', () => this.dispatchEvent({type: 'toolChanged', tool: this._activeTool}))
        }
    }

    private _statusChanged(): void {
        this.dispatchEvent({type: 'statusChanged', hints: this.status})
    }

    // endregion

    // region undo

    private _historyLabel(cmd: any): string {
        if (!cmd) return 'Action'
        if (typeof cmd.label === 'string') return cmd.label
        if (cmd.uid !== undefined && typeof cmd.uid === 'string') return cmd.uid.replace(/[_-]/g, ' ')
        if (cmd.type === 'ThreeViewerUM_set' || cmd.type === 'UiConfigMethods_set') {
            const key = cmd.binding?.[1] ?? cmd.key
            return key ? `Set ${String(key)}` : 'Set value'
        }
        if (typeof cmd.type === 'string') return cmd.type.replace(/^.*_/, '').replace(/[_-]/g, ' ')
        return 'Action'
    }

    /**
     * `JSUndoManager` has no change event, so wrap the methods that move the stack. Restored on
     * dispose. The rebuilt engine owns undo and will dispatch this itself.
     */
    private _bridgeUndoManager(): void {
        const um = this.undo.undoManager as JSUndoManager & Record<string, any>
        if (!um) return
        for (const name of ['_record', 'undo', 'redo', 'reset', 'replaceLast', 'setLimit']) {
            const original = um[name]
            if (typeof original !== 'function') continue
            um[name] = (...args: unknown[]) => {
                const r = original.apply(um, args)
                queueMicrotask(() => !this._disposed && this.dispatchEvent({type: 'historyChanged'}))
                return r
            }
            this._disposers.push(() => { um[name] = original })
        }
    }

    readonly history: HistoryApi = {
        canUndo: () => !!this.undo.undoManager?.canUndo(),
        canRedo: () => !!this.undo.undoManager?.canRedo(),
        undo: () => this.undo.undoManager?.undo(),
        redo: () => this.undo.undoManager?.redo(),
        entries: (): HistoryEntry[] => {
            const um = this.undo.undoManager
            if (!um) return []
            return um.stack.map((cmd, i) => ({label: this._historyLabel(cmd), undone: i > um.sp}))
        },
    }

    /** Record an already-performed action so `Ctrl+Z` can reverse it. */
    record(cmd: LabelledUndoCommand): void {
        this.undo.undoManager?.record(cmd)
    }

    private _seenHistory = 0
    private _lastBridge: LabelledUndoCommand | null = null

    /**
     * Every `ModellingPlugin` command (and every committed edit-mode session) pushes a snapshot onto
     * `ModellingHistory`. Mirror each new entry onto the viewer's `UndoManagerPlugin` so one `Ctrl+Z`
     * works for scene edits and document commands alike. The unified undo stack is a prerequisite
     * of the engine rebuild; this is the shell's interim so the Edit menu is honest.
     */
    private _bridgeModellingHistory(): void {
        const modelling = this.modelling
        if (!modelling) return
        this._seenHistory = modelling.history.entries.length
        const check = () => {
            const h = modelling.history
            const n = h.entries.length
            if (n > this._seenHistory && !h.canRedo) {
                const entry = h.entries[n - 1]
                const cmd: LabelledUndoCommand = {
                    label: entry.label,
                    undo: () => { h.undo(1); this.viewer.setDirty() },
                    redo: () => { h.redo(1); this.viewer.setDirty() },
                }
                this._lastBridge = cmd
                this.record(cmd)
            }
            this._seenHistory = n
        }
        this._on(modelling, 'commandRun', check)
        this._on(modelling, 'documentChanged', check)
    }

    /** True when the top of the undo stack is the last modelling command, so redo-last can pop it. */
    canPopLastModellingEntry(): boolean {
        const um = this.undo.undoManager
        return !!um && !!this._lastBridge && um.peek() === this._lastBridge
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
        if (next === this._activeTool) {
            // Re-activating a one-shot tool (edit-mode move/rotate/scale) runs it again.
            if (next && next.id.startsWith('mesh.')) next.activate(this.context())
            return
        }
        const ctx = this.context()
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

    setLastOperation(op: LastOperation | null): void {
        this._lastOperation = op
        this.dispatchEvent({type: 'lastOperationChanged', operation: op})
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

    /** Poll result as a boolean plus reason. */
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
        let result: OperatorResult
        try {
            result = await op.exec(ctx, props)
        } catch (e) {
            result = {ok: false, error: (e as Error)?.message ?? String(e)}
        }
        if (!result.ok && result.error) this.message('error', `${op.label}: ${result.error}`)
        for (const w of result.warnings ?? []) this.message('warning', w)
        this.viewer.setDirty()
        this.dispatchEvent({type: 'selectionChanged'})
        return result
    }

    message(level: 'info' | 'warning' | 'error', text: string): void {
        this.dispatchEvent({type: 'message', level, text})
    }

    // endregion

    // region status and stats

    get status(): StatusHints | null {
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
        if (this._activeTool?.hints) return this._activeTool.hints
        return this.mode === 'edit'
            ? {lmb: 'Select element (Shift: extend)', mmb: 'Zoom', rmb: 'Pan / context menu', keys: [{key: 'Drag', label: 'Orbit'}]}
            : {lmb: 'Select (Shift: extend)', mmb: 'Zoom', rmb: 'Pan / context menu', keys: [{key: 'Drag', label: 'Orbit'}]}
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
        this._walkModel(o => {
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
    private _walkModel(fn: (o: IObject3D) => void): void {
        const visit = (o: IObject3D) => {
            if ((o as any).isWidget || o.assetType === 'widget' || o.userData?.isWidgetRoot) return
            if (o !== this.viewer.scene.modelRoot) fn(o)
            for (const c of o.children) visit(c as IObject3D)
        }
        visit(this.viewer.scene.modelRoot)
    }

    private _countObjects(): number {
        let n = 0
        this._walkModel(() => n++)
        return n
    }

    // endregion

    dispose(): void {
        this._disposed = true
        for (const d of this._disposers.splice(0)) d()
    }
}
