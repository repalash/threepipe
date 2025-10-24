import {IAnimationLoopEvent, IObject3D} from '../../../core'
import {generateUUID} from '../../../three'
import {UiObjectConfig} from 'uiconfig.js'
import {ComponentCtx, ComponentDefn, ComponentJSON} from './componentTypes.ts'
import {onChange2, serialize} from 'ts-browser-helpers'
import {refreshAllStateProperties} from './setupComponent.ts'

export type TObject3DComponent = typeof Object3DComponent

export class Object3DComponent {
    declare ['constructor']: TObject3DComponent & ComponentDefn

    @serialize()
    @onChange2('onEnabledChange')
        enabled: boolean

    static StateProperties: ComponentDefn['StateProperties'] = []
    static ComponentType = 'Object3DComponent'
    readonly isObject3DComponent = true
    // name: string
    object: IObject3D
    uuid = generateUUID()
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
        this.object = null as any
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
        this.object = object
        this.setState(state)
    }

    destroy() {
        this.object = null as any
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

    onEnabledChange() {
        // todo dispatch
    }



}
