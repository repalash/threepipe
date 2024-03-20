import {TransformControls} from './TransformControls.js'
import {MathUtils} from 'three'
import type {ICamera, IObject3D, ISceneEvent, IWidget} from '../../core'
import {iObjectCommons} from '../../core'
import {uiDropdown, uiNumber, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {onChange2} from 'ts-browser-helpers'

@uiPanelContainer('Transform Controls')
export class TransformControls2 extends TransformControls implements IWidget, IObject3D {
    isWidget = true as const
    assetType = 'widget' as const
    setDirty = iObjectCommons.setDirty
    refreshUi = iObjectCommons.refreshUi.bind(this)

    object: IObject3D | undefined
    private _keyDownListener(event: KeyboardEvent) {
        if (!this.enabled) return
        if (!this.object) return

        switch (event.code) {

        case 'KeyQ':
            this.space = this.space === 'local' ? 'world' : 'local'
            break

        case 'ShiftLeft':
            this.translationSnap = 0.5
            this.rotationSnap = MathUtils.degToRad(15)
            this.scaleSnap = 0.25
            break

        case 'KeyW':
            this.mode = 'translate'
            break

        case 'KeyE':
            this.mode = 'rotate'
            break

        case 'KeyR':
            this.mode = 'scale'
            break

        case 'Equal':
        case 'NumpadAdd':
        case 'Plus':
            this.size = this.size + 0.1
            break

        case 'Minus':
        case 'NumpadSubtract':
        case 'Underscore':
            this.size = Math.max(this.size - 0.1, 0.1)
            break

        case 'KeyX':
            this.showX = !this.showX
            break

        case 'KeyY':
            this.showY = !this.showY
            break

        case 'KeyZ':
            this.showZ = !this.showZ
            break

        case 'Space':
            this.enabled = !this.enabled
            break

        default:
            return
        }

        this.setDirty({refreshScene: true, frameFade: true})

    }

    private _keyUpListener(event: KeyboardEvent) {
        if (!this.enabled) return

        // reset events
        switch (event.code) {
        case 'ShiftLeft':
            this.translationSnap = null
            this.rotationSnap = null
            this.scaleSnap = null
            break

        default:
            break
        }

        if (!this.object) return

        // non-reset events
        switch (event.code) {
        default:
            break
        }

    }

    constructor(camera: ICamera, canvas: HTMLCanvasElement) {
        super(camera, canvas)

        this.visible = false
        this.userData.bboxVisible = false

        this.size = 2

        this.addEventListener('objectChange', () => {
            this?.object?.setDirty({fadeFrame: false})
            // todo: do this.setDirty?
        })

        this._keyUpListener = this._keyUpListener.bind(this)
        this._keyDownListener = this._keyDownListener.bind(this)
        window.addEventListener('keydown', this._keyDownListener)
        window.addEventListener('keyup', this._keyUpListener)
    }

    dispose() {
        window.removeEventListener('keydown', this._keyDownListener)
        window.removeEventListener('keyup', this._keyUpListener)
        super.dispose()
    }


    // region properties

    enabled: boolean

    // axis: 'X' | 'Y' | 'Z' | 'E' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'XYZE' | null

    @uiDropdown('Mode', ['translate', 'rotate', 'scale'].map(label=>({label})))
    @onChange2('setDirty')
        mode: 'translate' | 'rotate' | 'scale'

    translationSnap: number | null
    rotationSnap: number | null
    scaleSnap: number | null

    @uiDropdown('Space', ['world', 'local'].map(label=>({label})))
    @onChange2('setDirty')
        space: 'world' | 'local'
    @uiNumber('Size')
    @onChange2('setDirty')
        size: number
    @uiToggle('Show X')
    @onChange2('setDirty')
        showX: boolean
    @uiToggle('Show Y')
    @onChange2('setDirty')
        showY: boolean
    @uiToggle('Show Z')
    @onChange2('setDirty')
        showZ: boolean

    // dragging: boolean

    // endregion



    /**
     * Get the threejs object
     * @deprecated
     */
    get modelObject(): this {
        return this as any
    }

    // todo: https://helpx.adobe.com/after-effects/using/3d-transform-gizmo.html

    // region inherited type fixes

    traverse: (callback: (object: IObject3D) => void) => void
    traverseVisible: (callback: (object: IObject3D) => void) => void
    traverseAncestors: (callback: (object: IObject3D) => void) => void
    getObjectById: <T extends IObject3D = IObject3D>(id: number) => T | undefined
    getObjectByName: <T extends IObject3D = IObject3D>(name: string) => T | undefined
    getObjectByProperty: <T extends IObject3D = IObject3D>(name: string, value: string) => T | undefined
    copy: (source: this, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ISceneEvent) => void
    parent: IObject3D | null
    children: IObject3D[]

    // endregion
}
