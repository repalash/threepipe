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
    /**
     * Command-palette grouping: `File`, `Edit`, `Add`, `Object`, `Mesh`, `Select`, `View`, `Help`. Menus
     * do not read it; they are {@link MenuDescriptor}s (Blender's `VIEW3D_MT_*`), which name operators.
     */
    category?: string
    /** Which modes it belongs to. Undefined means all. */
    modes?: EditorMode[]
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
    /**
     * What to do next when there is nothing to act on - edit mode with no selection, object mode with
     * nothing selected, an empty scene. Shown ahead of the mouse hints; `keys` then holds only the
     * navigation keys, not the operator keys the tip stands in for. Undefined when something is selected.
     */
    tip?: string
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

/** Metadata of a file the user opened, kept in `localStorage`; the file itself is never stored. */
export interface RecentFile {
    name: string
    size: number
    lastModified: number
    openedAt: number
}

/** The document on disk, as far as a browser knows: a name, whether it has unsaved changes, and what was opened before. */
export interface FileApi {
    /** The document's name without extension; null until it is saved or opened. */
    readonly name: string | null
    /** True when the history moved since the last save, open or new. */
    readonly dirty: boolean
    readonly recent: RecentFile[]
    clearRecent(): void
    /** The scene as it is now counts as saved: an app's start scene, or after a save of its own. */
    markClean(): void
    /** A change the undo history does not record (an import) leaves unsaved changes. */
    markDirty(): void
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

/**
 * One row of a menu, as Blender's `Menu.draw` lays it out (`layout.operator`, `layout.menu`,
 * `layout.separator`, `layout.label`). Ports of `space_view3d.py` / `space_topbar.py` are lists of these.
 */
export type MenuItem =
    | MenuOperatorItem
    | MenuSubmenuItem
    | {type: 'separator', visible?: MenuPredicate}
    | {type: 'label', label: string, visible?: MenuPredicate}

/** Whether a row is drawn now - Blender's `if` around a `layout.*` call (select mode, selection counts). */
export type MenuPredicate = (ctx: EditorContext) => boolean

/** `layout.operator(idname, text=...)`, with the properties the menu sets on it. */
export interface MenuOperatorItem {
    type: 'operator'
    /** Operator id in the registry. An id that is not registered is shown disabled, "not available yet". */
    id: string
    /** The text Blender shows: the menu's `text=`, else the operator's `ot->name`. */
    label: string
    /** Properties the menu sets (`.type = 'VERT'`); passed to `run`, and matched against key bindings. */
    props?: Record<string, unknown>
    icon?: string
    /** Blender's operator idname, when this item's `id` is a different (engine) operator. */
    blender?: string
    /**
     * The engine has the operator, but not this variant of Blender's (an enum value it does not
     * implement, an option it has no equivalent for), now or in some contexts. Shown disabled with this
     * text after "Not available yet: ".
     */
    unavailable?: string | ((ctx: EditorContext) => string | undefined)
    visible?: MenuPredicate
}

/**
 * `layout.menu(idname, text=...)`: a submenu by id; or, with `items`, an inline one - Blender's
 * `operator_menu_enum`, which draws an operator's enum as a submenu without a registered menu type.
 */
export interface MenuSubmenuItem {
    type: 'menu'
    /** The submenu's id (a registered {@link MenuDescriptor}), or a key for an inline one. */
    id: string
    /** Overrides the submenu's own label (`text=`). */
    label?: string
    icon?: string
    /** Inline submenu content (`operator_menu_enum`). */
    items?: MenuItem[]
    /**
     * Blender has this submenu, but nothing in it exists here: shown as one disabled entry, not opened.
     * The text follows "Not available yet: ".
     */
    unavailable?: string
    visible?: MenuPredicate
}

/** A menu type: Blender's `bpy.types.Menu` subclass, ported as data. */
export interface MenuDescriptor {
    /** Blender's `bl_idname`, e.g. `VIEW3D_MT_edit_mesh_vertices`. */
    id: string
    /** `bl_label`. */
    label: string
    /** Where it was ported from, `space_view3d.py:4820` (Blender 5.3). */
    source?: string
    /**
     * The operator a key opens this menu with (`mesh.vertices_menu` for Ctrl+V, `mesh.delete` for X).
     * Its key is shown beside the submenu entry, as Blender shows the `wm.call_menu` binding.
     */
    operator?: string
    /**
     * The modes whose keymap has that key (Shift+A opens `VIEW3D_MT_add` in object mode and
     * `VIEW3D_MT_mesh_add` in edit mode); undefined means any. Blender looks the key up in the active
     * keymaps only, so the other mode's menu shows none.
     */
    operatorModes?: EditorMode[]
    /** The rows; a function for menus whose `draw` reads the context (Open Recent, the context menus). */
    items: MenuItem[] | ((ctx: EditorContext) => MenuItem[])
}

/** A menu row with everything worked out for the current context: what the shell draws. */
export type ResolvedMenuItem =
    | {
        type: 'operator'
        key: string
        id: string
        label: string
        props?: Record<string, unknown>
        icon?: string
        /** From the active keymap, for this operator with these props in this mode. */
        shortcut?: string
        enabled: boolean
        /** The operator exists with this variant. False: "not available yet". */
        available: boolean
        /** Description when enabled; the poll reason or "Not available yet ..." when not. */
        tooltip?: string
    }
    | {
        type: 'menu'
        key: string
        id: string
        label: string
        icon?: string
        shortcut?: string
        available: boolean
        tooltip?: string
        /** Absent when not available. */
        menu?: ResolvedMenu
    }
    | {type: 'separator', key: string}
    | {type: 'label', key: string, label: string}

export interface ResolvedMenu {
    id: string
    label: string
    items: ResolvedMenuItem[]
}

/** The tooltip prefix of a menu entry that has no operator behind it yet. */
export const NOT_AVAILABLE_YET = 'Not available yet'

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
    | {request: 'palette' | 'history' | 'shortcuts' | 'about' | 'operatorPanel' | 'welcome' | 'hints' | 'look' | 'agent'}
    | {
        request: 'menu'
        title?: string
        /** A registered menu to open (`wm.call_menu`'s `name`); the shell draws `engine.resolveMenu(menu)`. */
        menu?: string
        /** Or a one-off list (the keymap and input-device pickers). */
        items?: MenuRequestItem[]
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
    /** The document's name, dirty flag or recent-files list changed. */
    fileChanged: {name: string | null, dirty: boolean}
    /** Something to tell the user. The shell shows a toast. */
    message: {level: 'info' | 'warning' | 'error', text: string}
    /** An operator asks the shell to open one of its own surfaces, or a popup menu at the cursor. */
    uiRequest: UiRequest
    /** A `look` command finished - from an agent, a script or the `view.look` operator. */
    lookChanged: {look: LastLook}
}

/**
 * The most recent `look` render and its description, whoever asked for it.
 *
 * An agent driving the page sees through `look`; keeping its last render here is what lets a person
 * watching the editor see what the agent saw.
 */
export interface LastLook {
    /** The command as sent. */
    command: Record<string, unknown>
    /** The command's `data`: `image`, `views`, `style`, `highlight`, ... */
    data: Record<string, unknown>
    /** Command index within the modelling session. */
    index: number
    time: number
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
    /**
     * The display string for an operator or tool id in the active preset, if bound. With `props`, only
     * a binding that sets exactly those props counts (a menu's `Delete Vertices` is not X's bare
     * `mesh.delete`); without, any binding of the id.
     */
    shortcutFor(id: string, mode?: EditorMode, props?: Record<string, unknown>): string | undefined
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
    /** Menu types (header menus, the Ctrl+V/E/F and X menus, context menus), Blender's `VIEW3D_MT_*`. */
    readonly menus: Registry<MenuDescriptor>
    readonly history: HistoryApi
    readonly keymap: KeymapApi
    readonly input: InputApi
    readonly navigation: NavigationApi
    readonly file: FileApi

    readonly mode: EditorMode
    setMode(mode: EditorMode): boolean
    readonly selectMode: SelectModeName
    setSelectMode(mode: SelectModeName): void
    readonly activeTool: ToolDescriptor | null
    setActiveTool(id: string | null): void
    readonly lastOperation: LastOperation | null
    /** The most recent `look` render in this page, from any caller. */
    readonly lastLook: LastLook | null
    readonly status: StatusHints | null

    context(): EditorContext
    stats(): SceneStats
    /** The user's top-level objects: the model root's children, without gizmos and helpers. */
    modelObjects(): IObject3D[]
    /** Poll result as a boolean plus reason, with the `modes` check folded in. */
    poll(op: OperatorDescriptor, ctx?: EditorContext): {enabled: boolean, reason?: string}
    /** Run an operator by id through the registry (poll, exec, last-operation bookkeeping, toasts). */
    run(id: string, props?: Record<string, unknown>): Promise<OperatorResult>
    /**
     * The header's menus for the current mode, in order: the top bar's File / Edit, then Blender's
     * `VIEW3D_MT_editor_menus` (View, Select, Add, Object or Mesh / Vertex / Edge / Face / UV), then Help.
     */
    headerMenus(): ResolvedMenu[]
    /** The viewport's right-click menu for the current mode (`VIEW3D_MT_object_context_menu` / `VIEW3D_MT_edit_mesh_context_menu`). */
    readonly contextMenuId: string
    /** A menu with labels, keys, enabled state and tooltips worked out for now. Undefined if not registered. */
    resolveMenu(id: string, ctx?: EditorContext): ResolvedMenu | undefined
    /** Open a registered menu at the pointer (Blender's `wm.call_menu`). */
    callMenu(id: string, at?: {clientX: number, clientY: number}): void
    /** Record an already-performed action on the one undo stack so `Ctrl+Z` can reverse it. */
    record(cmd: LabelledUndoCommand): void
    /** Tell the user something. The shell shows a toast. */
    message(level: 'info' | 'warning' | 'error', text: string): void
    /**
     * The key for an operator in the active preset, formatted for a sentence: ` (Tab)`, or an empty
     * string when it has none. For messages that tell the user what to do next.
     */
    keyHint(id: string, mode?: EditorMode): string
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
