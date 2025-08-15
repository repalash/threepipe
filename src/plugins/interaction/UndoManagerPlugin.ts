import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {
    ActionUndoCommand,
    AnyFunction,
    getUrlQueryParam,
    JSUndoManager,
    onChange,
    PrimitiveVal,
    recordUndoCommand,
    SetValueUndoCommand,
    setValueUndoCommand,
    SetValueUndoCommandProps,
} from 'ts-browser-helpers'

/**
 * UndoManagerPlugin is a plugin for ThreeViewer that provides undo/redo functionality.
 * It uses the JSUndoManager(from ts-browser-helpers) library to maintain a common undo/redo history across the viewer and other plugins.
 */
// @uiPanelContainer('Undo Manager')
export class UndoManagerPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'UndoManagerPlugin'

    // @uiToggle()
    @onChange(UndoManagerPlugin.prototype._refresh)
        enabled = true

    undoManager?: JSUndoManager

    @onChange(UndoManagerPlugin.prototype._refresh)
        limit = 1000

    constructor(enabled = true, limit = 1000) {
        super()
        this.enabled = enabled
        this.limit = limit
    }

    protected _refresh() {
        if (!this.undoManager) return
        this.undoManager.enabled = this.enabled
        this.undoManager.limit = this.limit
        this.undoManager.options.debug = this._viewer?.debug || this.undoManager.options.debug
        if (this.undoManager) Object.assign(this.undoManager.presets, this.undoPresets)
    }

    toJSON: any = undefined

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.undoManager = new JSUndoManager({bindHotKeys: true, limit: this.limit, debug: viewer.debug || getUrlQueryParam('debugUndo') !== null, hotKeyRoot: document as any})
        this._refresh()
    }

    onRemove(viewer: ThreeViewer) {
        this.undoManager?.dispose()
        this.undoManager = undefined
        super.onRemove(viewer)
    }

    undoEditingWaitTime = 2000 // todo sync time with any ui plugins
    recordUndo(com: SetValueUndoCommand|ActionUndoCommand) {
        return recordUndoCommand(this.undoManager, com, this.undoCommandTypes.setValue, this.undoEditingWaitTime)
    }

    /**
     * Performs an action with undo/redo support.
     * @param targ - the target object to call the action on
     * @param action - a function that returns - 1. an undo function, 2. an object with undo and redo functions (and optional action)
     * @param args - the arguments to pass to the action function
     * @param uid - unique identifier for the command, not really used in actions
     * @param onUndoRedo - optional callback function to be called on undo/redo of the command. Not called on first action execution, only on undo/redo.
     */
    async performAction<T extends AnyFunction>(targ: any|undefined, action: T, args: Parameters<T>, uid: any, onUndoRedo?: (c: ActionUndoCommand)=>void) {
        const ac = ()=> targ === undefined ? action(...args) : action.call(targ, ...args) // if a function is returned, it is treated as undo function
        let res = await ac()
        const undo = typeof res === 'function' ? res : res?.undo?.bind(res)
        const resAction = typeof res !== 'function' ? res?.action?.bind(res) : null
        const redo = typeof res === 'function' ? ac : res?.redo?.bind(res) ?? resAction
        if (typeof resAction === 'function') {
            res = await resAction() // execute the action now. adding await just in case
        }
        if (typeof undo === 'function') {
            this.recordUndo({
                type: 'UiConfigMethods_action',
                uid: uid,
                target: targ,
                undo: undo,
                redo: redo,
                args,
                onUndoRedo,
            })
        }
    }

    /**
     * Sets a value in the target object with undo/redo support.
     * @param binding - a tuple of target object and key to set the value on
     * @param value - the value to set
     * @param props - properties for the undo command, including last, and lastValue(optional)
     * @param uid - unique identifier for the command, used to merge commands
     * @param forceOnChange
     * @param trackUndo - whether to track the undo command or not, defaults to true
     * @param onUndoRedo - optional callback function to be called on undo/redo of the command
     * @returns true if the value was set and the command was recorded, false if the command was not recorded (e.g. if it was not undoable or forceOnChange was false)
     */
    setValue<T extends PrimitiveVal, T1 = any>(binding: [T1, keyof T1], value: T, props: SetValueUndoCommandProps<T>, uid?: any, forceOnChange?: boolean, trackUndo = true, onUndoRedo?: (c: SetValueUndoCommand)=>void) {
        const ev = setValueUndoCommand(this.undoManager, binding, value, props, uid, this.undoCommandTypes.setValue, trackUndo, this.undoEditingWaitTime, true, onUndoRedo)
        if (!ev.undoable && !forceOnChange) return false
        // this.dispatchOnChangeSync({...props, ...ev}) // todo
        return true
    }

    setValues(bindings: [any, keyof any][], defs: any[], v: any[], props: SetValueUndoCommandProps<any>, uid?: any, forceOnChange?: boolean, trackUndo = true, onUndoRedo?: (c: SetValueUndoCommand)=>void) {
        // array proxy for bindings, this is required because undo modifies arrays in place, and it's better as we only update the bindings that are actually changed.
        const proxy = createBindingsProxy(bindings, defs)
        return this.setValue([proxy, 'value'], v, props, uid, forceOnChange, trackUndo, onUndoRedo)
    }


    readonly undoCommandTypes = {
        setValue: 'ThreeViewerUM_set' as const,
        action: 'ThreeViewerUM_action' as const,
    } as const

    undoPresets = {
        [this.undoCommandTypes.setValue]: (c: SetValueUndoCommand)=>{
            const ref = ()=>{
                c.onUndoRedo && c.onUndoRedo(c)
                // c.uid.uiRefresh?.(false)
            }
            return {
                undo: ()=>{
                    console.log('undo', c.lastVal)
                    if (!c.binding) return
                    this.setValue(c.binding, c.lastVal, c.props, c.uid, undefined, false)
                    // .then(ref)
                    ref()
                },
                redo: ()=>{
                    // console.log('redo', c.val)
                    if (!c.binding) return
                    this.setValue(c.binding, c.val, c.props, c.uid, undefined, false)
                    // .then(ref)
                    ref()
                },
            }
        },
        [this.undoCommandTypes.action]: (c: ActionUndoCommand)=>{
            const ref = ()=>{
                c.onUndoRedo && c.onUndoRedo(c)
            }
            return {
                undo: async()=>{
                    await c.undo.call(c.target, ...c.args)
                    ref()
                },
                redo: async()=>{
                    await c.redo.call(c.target, ...c.args)
                    ref()
                },
            }
        },
    }

}

/**
 * Creates a proxy for an array of bindings, allowing to access and set values in the target objects by editing the value.
 * Useful for updating multiple properties in a single undo/redo command when dragging.
 * @param bindings
 * @param defs
 */
export function createBindingsProxy(bindings: [any, keyof any][], defs: any[]) {
    return {
        p: new Proxy([] as any[], {
            get(_target, p, ...rest): any {
                if (p === 'length') {
                    return bindings.length
                }
                const index = Number(p)
                if (isNaN(index) || index < 0 || index >= bindings.length) {
                    return Reflect.get(Array.prototype, p, ...rest) || Reflect.get(_target, p, ...rest)
                }
                const [target, key] = bindings[index]
                return target?.[key] ?? defs[index]
            },
            set(_target, p, newValue: any, ...rest): boolean {
                const index = Number(p)
                if (isNaN(index) || index < 0 || index >= bindings.length) {
                    return Reflect.set(_target, p, newValue, ...rest)
                }
                const [target, key] = bindings[index]
                if (target) {
                    target[key] = newValue
                    return true
                }
                return false
            },
            // for every etc.
            has(_target, p, ...rest) {
                const index = Number(p)
                if (isNaN(index) || index < 0 || index >= bindings.length) {
                    return Reflect.has(Array.prototype, p, ...rest) || Reflect.has(_target, p, ...rest)
                }
                return true
            },
        }),
        get value() {
            return this.p
        },
        set value(va: any[]) {
            if (bindings.length !== va.length) {
                console.error(`UndoManager - setValues: bindings length (${bindings.length}) does not match value length (${va.length})`)
            }
            for (let i = 0; i < Math.min(va.length, bindings.length); i++) {
                this.p[i] = va[i]
            }
        },
    }
}
