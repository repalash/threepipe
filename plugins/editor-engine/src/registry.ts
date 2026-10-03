/**
 * The interfaces the editor shell renders from, and the engine implements.
 *
 * Everything visible in the shell - toolbar, menus, command palette, context menus, the redo-last
 * panel, the status strip - is a view onto these registries. Nothing in the components hard-codes an
 * action. {@link EditorEnginePlugin} (`EditorEnginePlugin.ts`) implements {@link EditorEngine}.
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
    /**
     * The props the operation actually used, when they differ from what was passed - an operator that
     * filled in defaults, or a modal that ended (extrude's offset, a transform's value). The engine
     * stores these as the redo-last props.
     */
    props?: Record<string, unknown>
    /**
     * The operator started a modal interaction and will finish later. The engine defers the redo-last
     * bookkeeping until the modal commits (see `EditorEnginePlugin.completeModal`).
     */
    modal?: boolean
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
    /**
     * Display string, `Ctrl+Z`, `Shift+D`, `Tab`. **Filled in by the engine from the active keymap**;
     * a value given at registration is overwritten, so operators never hard-code a key.
     */
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
    /** Reachable by key and `run`, but not listed in menus or the palette (a key that opens a menu). */
    hidden?: boolean
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
    /** Display string. Filled in by the engine from the active keymap, like {@link OperatorDescriptor.shortcut}. */
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
    /** Index into {@link entries} of the last step that is done; -1 when everything is undone. */
    readonly position: number
    /**
     * Undo or redo until `index` is the last done step (-1 for the original state), as clicking an
     * entry in Blender's Undo History does. Returns the number of steps moved.
     */
    jumpTo(index: number): number
}

export type PointingDevice = 'mouse' | 'trackpad'

/**
 * A physical gesture. The shell draws it (a mouse with a button lit, two fingers on a trackpad); the
 * text is {@link GESTURE_TEXT}.
 */
export type GestureKind =
    | 'left-drag' | 'middle-drag' | 'right-drag' | 'wheel'
    | 'alt-drag' | 'shift-alt-drag' | 'space-drag' | 'shift-middle-drag'
    | 'two-finger' | 'shift-two-finger' | 'ctrl-two-finger' | 'pinch'

export const GESTURE_TEXT: Record<GestureKind, string> = {
    'left-drag': 'Left-drag', 'middle-drag': 'Middle-drag', 'right-drag': 'Right-drag', 'wheel': 'Scroll the wheel',
    'alt-drag': 'Alt+drag', 'shift-alt-drag': 'Shift+Alt+drag', 'space-drag': 'Space+drag', 'shift-middle-drag': 'Shift+middle-drag',
    'two-finger': 'Two-finger scroll', 'shift-two-finger': 'Shift+two-finger scroll', 'ctrl-two-finger': 'Ctrl+two-finger scroll', 'pinch': 'Pinch',
}

/** One of the three ways to move the view, with the gestures for a device, for the "how to move around" cards. */
export interface NavigationGesture {
    action: 'orbit' | 'pan' | 'zoom'
    label: string
    /** The main gesture. */
    kind: GestureKind
    /** Its text, e.g. `Middle-drag`, `Two-finger scroll`, `Pinch`. */
    gesture: string
    /** Other gestures that do the same, main one first. */
    alternatives: {kind: GestureKind, gesture: string}[]
}

export interface NavigationApi {
    /** The device the hints and cards are written for. */
    readonly device: PointingDevice
    /** Where {@link device} came from: the user's choice, the wheel heuristic, or the platform default. */
    readonly deviceSource: 'chosen' | 'detected' | 'default'
    /** Choose the device; `'auto'` goes back to detection. */
    setDevice(device: PointingDevice | 'auto'): void
    /** Orbit, pan and zoom for the active preset and a device (default: the current one). */
    gestures(device?: PointingDevice): NavigationGesture[]
}


/** A step recorded on the one undo stack. `label` is what the history list shows. */
export interface LabelledUndoCommand {
    label: string
    undo: () => void
    redo: () => void
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

/** One entry of a popup menu the engine asks the shell to open (Blender's `wm.call_menu`). */
export interface MenuRequestItem {
    /** Operator id to run when chosen. */
    id: string
    /** Overrides the operator's label (e.g. the delete menu's `Only Faces`). */
    label?: string
    /** Props passed to `run`. */
    props?: Record<string, unknown>
}

export type UiRequest =
    | {request: 'palette' | 'history' | 'shortcuts' | 'about' | 'operatorPanel'}
    | {
        request: 'menu'
        title?: string
        items: MenuRequestItem[]
        /** Where to open it; the engine's last known pointer position on the canvas. */
        clientX?: number
        clientY?: number
    }

export interface EditorEngineEventMap {
    modeChanged: {mode: EditorMode}
    selectModeChanged: {selectMode: SelectModeName}
    toolChanged: {tool: ToolDescriptor | null}
    selectionChanged: {}
    /** A registry gained or lost entries, or shortcuts changed (keymap preset switch). */
    registryChanged: {}
    lastOperationChanged: {operation: LastOperation | null}
    historyChanged: {}
    statusChanged: {hints: StatusHints | null}
    sceneChanged: {}
    /** The active keymap preset changed. */
    keymapChanged: {preset: string}
    /** The pointing device changed (chosen, or detected from a wheel event). */
    navigationChanged: {device: PointingDevice, source: NavigationApi['deviceSource']}
    /** Something to tell the user. The shell shows a toast. */
    message: {level: 'info' | 'warning' | 'error', text: string}
    /** An operator asks the shell to open one of its own surfaces, or a popup menu at the cursor. */
    uiRequest: UiRequest
}

/** One key binding of a keymap preset. */
export interface KeyBinding {
    /**
     * Key combo, lower-case, modifiers first: `ctrl+z`, `shift+d`, `alt+a`, `tab`, `numpad1`, `delete`,
     * `f9`. `ctrl` also matches the Command key on a Mac. Keys are `KeyboardEvent.code` based, so `z`
     * is the physical Z key on any layout.
     */
    keys: string
    /** Operator id to run, or a tool id (with `tool: true`). */
    id: string
    /** Props passed to the operator. */
    props?: Record<string, unknown>
    /** The binding switches the active tool instead of running an operator. */
    tool?: boolean
    /** Only in this mode. Undefined means both. */
    mode?: EditorMode
    /** Let the key repeat while held (Blender's `repeat`). Default false. */
    repeat?: boolean
}

export interface KeymapPreset {
    id: string
    label: string
    description: string
    bindings: KeyBinding[]
    /**
     * How the mouse navigates the viewport, applied to the camera controls. `orbit`/`pan`/`zoom` name a
     * button (a ROTATE button with Shift held pans, as in Blender); `leftDrag` says whether a plain
     * left drag orbits or belongs to selection (box select); `spacePan` makes Space+left-drag pan
     * (Figma); `altOrbit` makes Alt+left-drag orbit (Blender's "emulate 3 button mouse", every DCC);
     * `trackpad` is what a two-finger scroll does (Shift does the other one; pinch always zooms).
     */
    navigation: {
        orbit: 'left' | 'middle' | 'right'
        pan: 'left' | 'middle' | 'right'
        zoom: 'left' | 'middle' | 'right' | 'wheel'
        leftDrag: 'orbit' | 'select'
        spacePan?: boolean
        altOrbit?: boolean
        trackpad?: 'orbit' | 'pan' | null
    }
}

export interface KeymapApi {
    readonly presets: KeymapPreset[]
    readonly activePreset: KeymapPreset
    setPreset(id: string): void
    /** The display string for an operator or tool id in the active preset, if bound. */
    shortcutFor(id: string, mode?: EditorMode): string | undefined
    /** Every binding for an id in the active preset. */
    bindingsFor(id: string): KeyBinding[]
}

export interface InputApi {
    /** Stop handling viewport keys (a modal dialog is open). Keyed, so several callers can overlap. */
    suspend(key: unknown): void
    resume(key: unknown): void
    readonly suspended: boolean
    /** Extra veto: return false to let the event through untouched. The shell adds its dialog rule here. */
    filter: ((event: KeyboardEvent) => boolean) | null
    /** Last pointer position over the canvas, in client coordinates. Where popup menus open. */
    readonly pointer: {clientX: number, clientY: number}
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
    readonly keymap: KeymapApi
    readonly input: InputApi
    readonly navigation: NavigationApi

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
    /** Poll result as a boolean plus reason, with the `modes` check folded in. */
    poll(op: OperatorDescriptor, ctx?: EditorContext): {enabled: boolean, reason?: string}
    /** Run an operator by id through the registry (poll, exec, last-operation bookkeeping, toasts). */
    run(id: string, props?: Record<string, unknown>): Promise<OperatorResult>
    /** Record an already-performed action on the one undo stack so `Ctrl+Z` can reverse it. */
    record(cmd: LabelledUndoCommand): void
    /** Tell the user something. The shell shows a toast. */
    message(level: 'info' | 'warning' | 'error', text: string): void
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
    constructor(private _onChange?: (item?: T) => void) {}

    register(item: T): () => void {
        this._items.set(item.id, item)
        this._onChange?.(item)
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
