import {IAnimationLoopEvent, IObject3D} from '../../../core'
import {UiObjectConfig} from 'uiconfig.js'
import {ComponentCtx, ComponentDefn, ComponentJSON} from './componentTypes.ts'
import {onChange2} from 'ts-browser-helpers'
import {refreshAllStateProperties} from './setupComponent.ts'

export type TObject3DComponent = typeof Object3DComponent

export class Object3DComponent {
    declare ['constructor']: TObject3DComponent & ComponentDefn

    @onChange2('onEnabledChange')
        enabled: boolean

    static StateProperties: ComponentDefn['StateProperties'] = ['enabled']
    static ComponentType = 'Object3DComponent'
    readonly isObject3DComponent = true

    protected _object: IObject3D | null = null
    get object() {
        if (!this._object) {
            throw new Error('Cannot access object at this point.')
        }
        return this._object
    }
    set object(_: IObject3D) {
        console.error('Object3DComponent: object is read-only')
    }

    // name: string

    // uuid = generateUUID()
    uuid = Math.random().toString(32).slice(2, 10)
    declare uiConfig?: UiObjectConfig
    declare state: never // so that this name can never be used
    protected _state: ComponentJSON['state']
    get stateRef() {
        return this._state
    }
    // getState() {
    //     return {...this._state}
    // }
    setState(state: ComponentJSON['state']) {
        const oldState = this._state
        if (state === oldState) return
        if (state && typeof state === 'object') {
            this._state = state
        } else {
            this._state = {}
        }
        for (const key in oldState) {
            if (!(key in this._state)) {
                this._state[key] = oldState[key]
            }
        }
        refreshAllStateProperties(this, oldState)
        return this
    }

    declare ctx: ComponentCtx

    constructor() {
        this._state = {
            // ...stateFuncs,
        }

        // todo this has to be done after the subclass constructor, not before. move to the plugin
        // this.name = this.type
    }

    // hooks

    start() {
        // called when component is added to an object, usually when the scene is played
    }

    stop() {
        // called when scene is stopped or component is removed from an object when scene is playing
    }

    update(_e: IAnimationLoopEvent): boolean|void {
        // called every frame
    }

    init(object: IObject3D, state: ComponentJSON['state']) {
        if (!object) throw new Error('Object3DComponent: no object')
        this._object = object
        this.setState(state)
    }

    destroy() {
        this._object = null as any
        this.stateChangeHandlers = {}
        const state = this._state
        this._state = {}
        return state
    }

    stateChangeHandlers: Record<string, ((value: any, oldValue: any, key?: string) => void)[]> = {}
    onStateChange<K extends keyof this & string>(
        key: K,
        fn: (value: this[K], oldValue: this[K], key?: K) => void
    ) {
        if (!this.stateChangeHandlers[key]) this.stateChangeHandlers[key] = []
        this.stateChangeHandlers[key].push(fn)
    }

}
