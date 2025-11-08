import {uiButton, uiConfig, uiDropdown, uiFolderContainer, uiPanelContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from './PickingPlugin'
import {JSUndoManager, onChange} from 'ts-browser-helpers'
import {OrbitControls3, TransformControls} from '../../three'
import {
    ICamera,
    IObject3D,
    IObject3DUserData,
    iObjectCommons,
    IWidget,
    UnlitLineMaterial,
    UnlitMaterial,
} from '../../core'
import {Euler, MathUtils, Object3D, Vector3} from 'three'
import type {UndoManagerPlugin} from './UndoManagerPlugin'

@uiPanelContainer('Transform Controls')
export class TransformControlsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'TransformControlsPlugin'

    @uiToggle()
    @onChange(TransformControlsPlugin.prototype.setDirty)
        enabled = true

    setDirty() { // todo rename to refresh or setEnabledDirty?
        if (!this._viewer) return
        const picking = this._viewer.getPlugin(PickingPlugin)!
        const enabled = !this.isDisabled()
        if (this.transformControls) {
            const selected = picking.getSelectedObject<IObject3D>()
            if (enabled && selected?.isObject3D) this.transformControls.attach(selected)
            else this.transformControls.detach()
        }
        this._viewer.setDirty()
    }

    constructor(enabled = true) {
        super()
        TransformControls.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
        TransformControls.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
        this.enabled = enabled
    }

    toJSON: any = undefined

    dependencies = [PickingPlugin]

    @uiConfig(undefined, {expanded: true})
        transformControls: TransformControls2 | undefined

    protected _isInteracting = false
    protected _viewerListeners = {
        postFrame: ()=>{
            if (!this.transformControls || !this._viewer) return
            // this._viewer.scene.mainCamera.setInteractions(!this._isInteracting, TransformControlsPlugin.PluginType)
        },
    }

    private _transformState = {
        obj: null as Object3D|null,
        position: new Vector3(),
        rotation: new Euler(),
        scale: new Vector3(),
    }
    undoManager?: JSUndoManager

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.setDirty()
        this.transformControls = new TransformControls2(viewer.scene.mainCamera, viewer.canvas)
        this._mainCameraChange = this._mainCameraChange.bind(this)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)
        this.transformControls.addEventListener('dragging-changed', (event) => {
            if (!this?._viewer) return
            const controls = this._viewer.scene.mainCamera.controls
            if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
            this._viewer.scene.mainCamera.setInteractions(!event.value, TransformControlsPlugin.PluginType)
            // this._viewer.scene.mainCamera.autoNearFar = !event.value // todo: maintain state
        })
        this.transformControls.addEventListener('axis-changed', (event) => {
            if (!this?._viewer) return
            this._isInteracting = !!event.value
            const controls = this._viewer.scene.mainCamera.controls
            if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
            this._viewer.setDirty() // rerender for color change
        })
        viewer.scene.addObject(this.transformControls, {addToRoot: true})
        const picking = viewer.getPlugin(PickingPlugin)!
        picking.addEventListener('selectedObjectChanged', (event) => {
            if (!this.transformControls) return
            if (this.isDisabled()) {
                if (this.transformControls.object) this.transformControls.detach()
                return
            }
            if (event.object) {
                const obj = event.intersects?.selectedHandle ?? event.intersects?.selectedObject ?? event.object
                this.transformControls.attach(obj)
            } else {
                this.transformControls.detach()
            }
        })

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=> {
            this.undoManager = um.undoManager
        }, ()=> this.undoManager = undefined, this)

        // same logic for undo as three.js editor. todo It can be made better by syncing with the UI so it supports the hotkeys and other properties inside TransformControls2
        this.transformControls.addEventListener('mouseDown', ()=> {
            if (!this.transformControls) return
            const object = this.transformControls.object
            if (!object) return

            this._transformState.obj = object
            this._transformState.position = object.position.clone()
            this._transformState.rotation = object.rotation.clone()
            this._transformState.scale = object.scale.clone()
        })

        this.transformControls.addEventListener('mouseUp', ()=> {
            if (!this.transformControls) return
            const object = this.transformControls.object
            if (!object) return

            if (this._transformState.obj !== object || !this.undoManager) return

            const key = ({
                'translate': 'position',
                'rotate': 'rotation',
                'scale': 'scale',
            } as const)[this.transformControls.getMode()]
            if (!key) return
            if (this._transformState[key].equals(object[key] as any)) return

            const command = {
                last: this._transformState[key].clone(), current: object[key].clone(),
                set: (value: any) => {
                    object[key].copy(value)
                    object.updateMatrixWorld(true)
                    this.transformControls?.dispatchEvent({type: 'change'} as any)
                    this.transformControls?.dispatchEvent({type: 'objectChange'} as any)
                },
                undo: () => command.set(command.last),
                redo: () => command.set(command.current),
            }
            this.undoManager.record(command)
        })

    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        if (this.transformControls) {
            this.transformControls.detach()
            viewer.scene.remove(this.transformControls)
            this.transformControls.dispose()
        }
        this.transformControls = undefined
        super.onRemove(viewer)
    }

    private _mainCameraChange = () => {
        if (!this.transformControls || !this._viewer) return
        this.transformControls.camera = this._viewer.scene.mainCamera
    }

    @uiButton('Center All Meshes')
    centerAllMeshes() {
        return this._viewer?.scene.centerAllGeometries(true)
    }

}

@uiFolderContainer('Transform Controls')
export class TransformControls2 extends TransformControls implements IWidget, IObject3D {
    isWidget = true as const
    assetType = 'widget' as const
    setDirty = iObjectCommons.setDirty.bind(this)
    refreshUi = iObjectCommons.refreshUi.bind(this)
    lockProps: string[] | undefined = undefined // list of properties to lock.

    declare object: IObject3D | undefined
    private _keyDownListener(event: KeyboardEvent) {
        if (!this.enabled) return
        if (!this.object) return
        if (event.metaKey || event.ctrlKey) return
        if ((event.target as any)?.tagName === 'TEXTAREA' || (event.target as any)?.tagName === 'INPUT') return

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

        this.size = 1.25

        this.addEventListener('objectChange', () => {
            this?.object?.setDirty && this.object.setDirty({frameFade: false, change: 'transform'})
            // todo: do this.setDirty?
        })
        this.addEventListener('change', () => {
            this.setDirty({frameFade: false})
        })

        this._keyUpListener = this._keyUpListener.bind(this)
        this._keyDownListener = this._keyDownListener.bind(this)
        window.addEventListener('keydown', this._keyDownListener)
        window.addEventListener('keyup', this._keyUpListener)

        this.traverse(c=>{
            c.castShadow = false
            c.receiveShadow = false
            c.userData.__keepShadowDef = true
        })
    }

    protected _savedSettings = {} as any
    attach(object: Object3D): this {
        // check if object is ancestor of this
        let isAns = false
        this.traverseAncestors(o=>isAns = isAns || o === object)
        if (isAns) return this

        if (this._savedSettings.lockProps) this.lockProps = this._savedSettings.lockProps
        Object.assign(this, this._savedSettings)
        this._savedSettings = {}

        // see LineHelper for example
        if (object.userData.transformControls) {
            const props: ((keyof typeof this) & (keyof (Required<IObject3DUserData>['transformControls'])))[] =
                ['translationSnap', 'rotationSnap', 'scaleSnap', 'space', 'mode', 'showX', 'showY', 'showZ', 'lockProps']
            for (const prop of props) {
                if (object.userData.transformControls[prop] !== undefined) {
                    this._savedSettings[prop] = this[prop]
                    this[prop] = object.userData.transformControls[prop]
                }
            }
        }
        return super.attach(object)
    }
    detach(): this {
        if (this._savedSettings.lockProps) this.lockProps = this._savedSettings.lockProps
        Object.assign(this, this._savedSettings)
        this._savedSettings = {}
        return super.detach()
    }

    dispose() {
        window.removeEventListener('keydown', this._keyDownListener)
        window.removeEventListener('keyup', this._keyUpListener)
        super.dispose()
    }


    // region properties

    declare enabled: boolean

    // axis: 'X' | 'Y' | 'Z' | 'E' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'XYZE' | null

    // onChange not required for before since they fire 'change' event on changed. see TransformControls.js

    @uiDropdown('Mode', ['translate', 'rotate', 'scale'].map(label=>({label})))
    declare mode: 'translate' | 'rotate' | 'scale'

    declare translationSnap: number | null
    declare rotationSnap: number | null
    declare scaleSnap: number | null

    @uiDropdown('Space', ['world', 'local'].map(label=>({label})))
    declare space: 'world' | 'local'
    @uiSlider('Size', [0.1, 10], 0.01)
    declare size: number
    @uiToggle('Show X')
    declare showX: boolean
    @uiToggle('Show Y')
    declare showY: boolean
    @uiToggle('Show Z')
    declare showZ: boolean

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

    declare traverse: (callback: (object: IObject3D) => void) => void
    declare traverseVisible: (callback: (object: IObject3D) => void) => void
    declare traverseAncestors: (callback: (object: IObject3D) => void) => void
    declare getObjectById: (id: number) => IObject3D | undefined
    declare getObjectByName: (name: string) => IObject3D | undefined
    declare getObjectByProperty: (name: string, value: string) => IObject3D | undefined
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion
}
