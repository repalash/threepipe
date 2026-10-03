/**
 * The interfaces the editor shell renders from.
 *
 * Everything visible in the shell - toolbar, menus, command palette, context menus, the redo-last
 * panel, the status strip - is a view onto these registries. Nothing in the components hard-codes an
 * action. The interaction engine (`@threepipe/plugin-mesh-edit`, being rebuilt) is expected to
 * implement {@link EditorEngine}; until it lands, `engine/legacyEngine.ts` adapts the existing
 * `MeshEditPlugin` / `ModellingPlugin` / `PickingPlugin` APIs to the same shape.
 *
 * Kept deliberately small. Blender's `wmOperatorType` is the model: id, label, description, a property
 * schema, `poll`, `exec`, flags. Tools are the modal counterpart (Blender's `bToolRef`).
 */

import type {EventDispatcher, IObject3D, ThreeViewer} from 'threepipe'

export type EditorMode = 'object' | 'edit'
export type SelectModeName = 'vertex' | 'edge' | 'face'

/** The JSON-schema subset the shell can render as a form (same as `plugin-modelling`'s `ParamSchema`). */
export interface PropSchema {
    type: 'object'
    properties: Record<string, PropDef>
    required?: string[]
    additionalProperties?: boolean
}

export interface PropDef {
    type?: 'number' | 'integer' | 'string' | 'boolean' | 'array' | 'object'
    description?: string
    enum?: string[]
    minimum?: number
    maximum?: number
    default?: unknown
    /** `[x, y, z]` triples and the like. */
    items?: PropDef
    minItems?: number
    maxItems?: number
    /** `oneOf` object references from `plugin-modelling`; rendered as text. */
    oneOf?: unknown[]
}

export interface OperatorResult {
    ok: boolean
    error?: string
    warnings?: string[]
    data?: unknown
}

/**
 * One thing the user can do. Rendered as a menu item, a palette entry, a context-menu item and,
 * when it has `props`, as a redo-last form.
 */
export interface OperatorDescriptor {
    /** `group.name`, e.g. `mesh.extrude`, `object.delete`, `file.export_glb`. */
    id: string
    label: string
    /** One line: what it does, shown in tooltips and the palette. */
    description?: string
    /** A Blueprint icon name. */
    icon?: string
    /** Display string only - the engine owns the keymap. `Ctrl+Z`, `Shift+D`, `Tab`. */
    shortcut?: string
    /** Menu / palette grouping: `File`, `Edit`, `Add`, `Object`, `Mesh`, `Select`, `View`, `Help`. */
    category?: string
    /** Which modes it belongs to. Undefined means all. */
    modes?: EditorMode[]
    /** Shown in the viewport context menu for these select modes (edit mode) or always (`object`). */
    contextMenu?: (SelectModeName | 'object')[]
    /** Parameters, as JSON schema. Absent means the operator takes none. */
    props?: PropSchema
    /** Blender flags. `undo` - records an undo step; `register` - appears in the redo-last panel. */
    flags?: {undo?: boolean, register?: boolean}
    /**
     * Whether it can run now. `false` disables; a string disables and explains why (tooltip).
     * Undefined means always available.
     */
    poll?(ctx: EditorContext): boolean | string
    exec(ctx: EditorContext, props?: Record<string, unknown>): Promise<OperatorResult> | OperatorResult
}

/** What the mouse buttons and modal keys do right now. Rendered in the status bar. */
export interface StatusHints {
    lmb?: string
    mmb?: string
    rmb?: string
    keys?: {key: string, label: string}[]
    /** A running modal operator's text, e.g. `Move: 0.42 along X`. */
    modal?: string
}

/** An active (modal, sticky) tool: select box, move, rotate, scale, extrude... */
export interface ToolDescriptor {
    id: string
    label: string
    icon?: string
    shortcut?: string
    description?: string
    modes?: EditorMode[]
    /** Toolbar grouping; consecutive groups get a separator. */
    group?: string
    poll?(ctx: EditorContext): boolean | string
    activate(ctx: EditorContext): void
    deactivate(ctx: EditorContext): void
    hints?: StatusHints
}

/** The last registered operator, for the redo-last panel. */
export interface LastOperation {
    operator: OperatorDescriptor
    props: Record<string, unknown>
    /** Undo and re-run with new props. Absent when the operator cannot be re-executed. */
    redo?(props: Record<string, unknown>): Promise<OperatorResult>
}

export interface HistoryEntry {
    label: string
    /** True for entries after the current position (redo-able). */
    undone: boolean
}

export interface HistoryApi {
    canUndo(): boolean
    canRedo(): boolean
    undo(): void
    redo(): void
    entries(): HistoryEntry[]
}

export interface SceneStats {
    objects: number
    verts: number
    edges: number
    faces: number
    /** `[verts, edges, faces]` selected in edit mode, or `[objects]` in object mode. */
    selected: number[]
}

export interface EditorContext {
    viewer: ThreeViewer
    engine: EditorEngine
    mode: EditorMode
    selectMode: SelectModeName
    /** Object-mode selection. */
    selectedObjects: IObject3D[]
    /** The object in edit mode, if any. */
    editObject: IObject3D | null
}

export interface EditorEngineEventMap {
    modeChanged: {mode: EditorMode}
    selectModeChanged: {selectMode: SelectModeName}
    toolChanged: {tool: ToolDescriptor | null}
    selectionChanged: {}
    /** A registry gained or lost entries. */
    registryChanged: {}
    lastOperationChanged: {operation: LastOperation | null}
    historyChanged: {}
    statusChanged: {hints: StatusHints | null}
    sceneChanged: {}
    /** Something to tell the user. The shell shows a toast. */
    message: {level: 'info' | 'warning' | 'error', text: string}
    /** An operator asks the shell to open one of its own surfaces. */
    uiRequest: {request: 'palette' | 'history' | 'shortcuts' | 'about' | 'operatorPanel'}
}

/**
 * What the shell talks to. One instance per viewer.
 *
 * The engine owns the keymap, picking and modal interaction; the shell only reads state, renders
 * registries and calls `exec`/`activate`.
 */
export interface EditorEngine extends EventDispatcher<EditorEngineEventMap> {
    readonly viewer: ThreeViewer
    readonly operators: Registry<OperatorDescriptor>
    readonly tools: Registry<ToolDescriptor>
    readonly history: HistoryApi

    readonly mode: EditorMode
    setMode(mode: EditorMode): boolean
    readonly selectMode: SelectModeName
    setSelectMode(mode: SelectModeName): void
    readonly activeTool: ToolDescriptor | null
    setActiveTool(id: string | null): void
    readonly lastOperation: LastOperation | null
    readonly status: StatusHints | null

    context(): EditorContext
    stats(): SceneStats
    /** Run an operator by id through the registry (poll, exec, last-operation bookkeeping, toasts). */
    run(id: string, props?: Record<string, unknown>): Promise<OperatorResult>
    dispose(): void
}

export interface Registry<T extends {id: string}> {
    register(item: T): () => void
    unregister(id: string): void
    get(id: string): T | undefined
    list(filter?: (item: T) => boolean): T[]
}

/** A small Map-backed registry. */
export class SimpleRegistry<T extends {id: string}> implements Registry<T> {
    private _items = new Map<string, T>()
    constructor(private _onChange?: () => void) {}

    register(item: T): () => void {
        this._items.set(item.id, item)
        this._onChange?.()
        return () => this.unregister(item.id)
    }

    unregister(id: string): void {
        if (this._items.delete(id)) this._onChange?.()
    }

    get(id: string): T | undefined {
        return this._items.get(id)
    }

    list(filter?: (item: T) => boolean): T[] {
        const all = [...this._items.values()]
        return filter ? all.filter(filter) : all
    }
}
