import {iObjectCommons} from './iObjectCommons'
import {Camera, IUniform, Vector3} from 'three'
import type {ICamera, ICameraEventMap, ICameraSetDirtyOptions} from '../ICamera'
import {CameraView, ICameraView} from '../camera/CameraView'

export const iCameraCommons = {
    setDirty: function(this: ICamera, options?: ICameraSetDirtyOptions): void {
        if (!this._positionWorld) return // not initialized yet

        // noinspection SuspiciousTypeOfGuard it can be string when called from bindToValue
        const isStr = typeof options === 'string'
        const changeKey = isStr ? options as string : options?.key
        if (!changeKey || ['zoom', 'fov', 'left', 'right', 'top', 'bottom', 'aspect', 'frustumSize'].includes(changeKey))
            this.updateProjectionMatrix()

        if (isStr) options = undefined

        this.getWorldPosition(this._positionWorld)
        // console.log('target', target, this._controls, this._camera)
        // noinspection PointlessBooleanExpressionJS
        if (this.controls && this.controls.target && this.controls.enabled !== false && this.target !== this.controls.target) {
            this.controls.target.copy(this.target)
            // this.controls.update() // this should be done automatically postFrame
        }
        // if (!this.controls || !this.controls.enabled) {
        else if (this.userData.autoLookAtTarget) {
            this.lookAt(this.target)
        }
        // todo refresh target on rotation change if autoLookAtTarget is false? (calculate distanceToTarget from the current/prev target and position

        this.dispatchEvent({...options, type: 'update', bubbleToParent: false, camera: this}) // does not bubble
        this.dispatchEvent({...options, type: 'cameraUpdate', bubbleToParent: true, camera: this}) // this sets dirty in the viewer
        iObjectCommons.setDirty.call(this, {refreshScene: false, ...options})
    },
    activateMain: function(this: ICamera, options: Omit<ICameraEventMap['activateMain'], 'bubbleToParent'> = {}, _internal = false, _refresh = true, canvas?: HTMLCanvasElement): void {
        if (!_internal) {
            if (options.camera === null) return this.deactivateMain(options, _internal, _refresh)
            return this.dispatchEvent({
                type: 'activateMain', ...options,
                camera: this,
                bubbleToParent: true,
            })
        } // this will be used by RootScene to deactivate other cameras and activate this one
        if (this.userData.__isMainCamera) return
        this.userData.__isMainCamera = true
        this.userData.__lastScale = this.scale.clone()
        this.scale.divide(this.getWorldScale(new Vector3())) // make unit scale, for near far and all
        if (canvas && this.setCanvas) this.setCanvas(canvas, _refresh)
        else if (_refresh) {
            this.refreshCameraControls(false)
            this.refreshAspect(false)
        }
        this.setDirty({change: 'activateMain', ...options})
        // console.log({...this._camera.modelObject.position})
    },
    deactivateMain: function(this: ICamera, options: Omit<ICameraEventMap['activateMain'], 'bubbleToParent'> = {}, _internal = false, _refresh = true, clearCanvas = false): void {
        if (!_internal) return this.dispatchEvent({
            type: 'activateMain', ...options,
            camera: null,
            bubbleToParent: true,
        }) // this will be used by RootScene to deactivate other cameras and activate this one
        if (!this.userData.__isMainCamera) return
        this.userData.__isMainCamera = false // or delete?
        if (this.userData.__lastScale) {
            this.scale.copy(this.userData.__lastScale)
            delete this.userData.__lastScale
        }
        if (clearCanvas) this.setCanvas(undefined, _refresh)
        else if (_refresh) this.refreshCameraControls(false)
        if (_refresh) {
            this.refreshCameraControls(false)
        }
        this.setDirty({change: 'deactivateMain', ...options})
    },
    refreshUi: function(this: ICamera) {
        // todo
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    },
    refreshTarget: function(this: ICamera, distanceFromTarget = 4, setDirty = true) {
        if (this.controls?.enabled && this.controls.target) {
            if (this.controls.target !== this.target) this.target.copy(this.controls.target)
        } else {
            // this.cameraObject.updateWorldMatrix(true, false)
            this.getWorldDirection(this.target)
                // .transformDirection(this.cameraObject.matrixWorldInverse)
                // .multiplyScalar(distanceFromTarget).add(this._position)
                .multiplyScalar(distanceFromTarget).add(this.getWorldPosition(new Vector3()))
            // if (this.cameraObject.parent) this.cameraObject.parent.worldToLocal(this._target)
        }
        if (setDirty) this.setDirty({change: 'target'})
    },
    refreshAspect: function(this: ICamera, setDirty = true) {
        if (this.autoAspect) {
            if (!this._canvas) console.error('ICamera: cannot calculate aspect ratio without canvas/container')
            else {
                let aspect = this._canvas.clientWidth / this._canvas.clientHeight
                if (!isFinite(aspect)) aspect = 1
                this.aspect = aspect
                this.refreshFrustum && this.refreshFrustum(false)
            }
        }
        if (setDirty) this.setDirty({change: 'aspect'})
    },
    updateShaderProperties: function(this: ICamera, material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}) {
        material.uniforms.cameraPositionWorld?.value?.copy(this._positionWorld)
        material.uniforms.cameraNearFar?.value?.set(this.near, this.far)
        if (material.uniforms.projection) material.uniforms.projection.value = this.projectionMatrix // todo: rename to projectionMatrix2?
        material.defines.PERSPECTIVE_CAMERA = this.type === 'PerspectiveCamera' ? '1' : '0'
        material.defines.ORTHOGRAPHIC_CAMERA = this.type === 'OrthographicCamera' ? '1' : '0' // todo
        return this
    },

    upgradeCamera: upgradeCamera,

    copy: (superCopy: ICamera['copy']): ICamera['copy'] =>
        function(this: ICamera, camera: ICamera | Camera, recursive?, distanceFromTarget?, worldSpace?, ...args): ICamera {
            if (!camera.isCamera) {
                console.error('ICamera.copy: camera is not a Camera', camera)
                return this
            }
            superCopy.call(this, camera, recursive, ...args)
            // moved to setView in ThreeViewer
            // const worldPos = camera.getWorldPosition(this.position)
            // camera.getWorldQuaternion(this.quaternion)
            // if (this.parent) {
            //     this.position.copy(this.parent.worldToLocal(worldPos))
            //     this.quaternion.premultiply(this.parent.quaternion.clone().invert())
            // }
            if ((<ICamera>camera).target?.isVector3) this.target.copy((<ICamera>camera).target)
            else {
                const minDistance = (this.controls as any)?.minDistance ?? distanceFromTarget ?? 4
                camera.getWorldDirection(this.target).multiplyScalar(minDistance).add(this.getWorldPosition(new Vector3()))
            }


            if (worldSpace) { // default = false
                const worldPos = camera.getWorldPosition(this.position)
                // this.getWorldQuaternion(this.quaternion) // todo: do if autoLookAtTarget is false
                // todo up vector
                if (this.parent) {
                    this.position.copy(this.parent.worldToLocal(worldPos))
                    //     this.quaternion.premultiply(this.parent.quaternion.clone().invert())
                }
            }

            this.updateMatrixWorld(true)
            this.updateProjectionMatrix()
            this.refreshAspect(false)
            this.setDirty()
            return this
        },

    getView: function<T extends ICameraView = CameraView>(this: ICamera, worldSpace = true, _view?: T): T {
        const up = new Vector3()
        this.updateWorldMatrix(true, false)
        const matrix = this.matrixWorld
        up.x = matrix.elements[4]
        up.y = matrix.elements[5]
        up.z = matrix.elements[6]
        up.normalize()
        const view = _view || new CameraView()
        view.name = this.name
        view.position.copy(this.position)
        view.target.copy(this.target)
        view.quaternion.copy(this.quaternion)
        view.zoom = this.zoom
        // view.up.copy(up)
        const parent = this.parent
        if (parent) {
            if (worldSpace) {
                view.position.applyMatrix4(parent.matrixWorld)
                this.getWorldQuaternion(view.quaternion)
                // target, up is already in world space
            } else {
                up.transformDirection(parent.matrixWorld.clone().invert())
                // pos is already in local space
                // target should always be in world space
            }
        }
        view.isWorldSpace = worldSpace
        return view as T
    },

    setView: function<T extends ICameraView = CameraView>(this: ICamera, view: T): void {
        this.position.copy(view.position)
        this.target.copy(view.target)
        // this.up.copy(view.up)
        this.quaternion.copy(view.quaternion)
        this.zoom = view.zoom
        this.setDirty()
    },

    // todo rename to setFromCamera?
    setViewFromCamera: function(this: ICamera, camera: Camera|ICamera, distanceFromTarget?: number, worldSpace = true): void {
        // todo: getView, setView can also be used, do we need copy? as that will copy all the properties
        this.copy(camera, undefined, distanceFromTarget, worldSpace)
    },

    setViewToMain: function(this: ICamera, eventOptions: Omit<ICameraEventMap['setView'], 'camera'|'bubbleToParent'>): void {
        this.dispatchEvent({type: 'setView', ...eventOptions, camera: this, bubbleToParent: true})
    },

}

function upgradeCamera(this: ICamera) {
    if (!this.isCamera) {
        console.error('Object is not a camera', this)
        return
    }
    if (this.userData.__cameraSetup) return
    this.userData.__cameraSetup = true
    iObjectCommons.upgradeObject3D.call(this)
    this.copy = iCameraCommons.copy(this.copy)
    if (!this.target) this.target = new Vector3()
    if (!this._positionWorld) this._positionWorld = new Vector3()
    if (!this.refreshTarget) this.refreshTarget = iCameraCommons.refreshTarget
    if (!this.refreshAspect) this.refreshAspect = iCameraCommons.refreshAspect
    if (!this.updateShaderProperties) this.updateShaderProperties = iCameraCommons.updateShaderProperties

    if (!this.activateMain) this.activateMain = iCameraCommons.activateMain
    if (!this.deactivateMain) this.deactivateMain = iCameraCommons.deactivateMain
    if (!this.refreshUi) this.refreshUi = iCameraCommons.refreshUi
    if (!this.setDirty) this.setDirty = iCameraCommons.setDirty
    // if (!this.controlsMode) this.controlsMode = ''

    if (!this.getView) this.getView = iCameraCommons.getView
    if (!this.setView) this.setView = iCameraCommons.setView
    if (!this.setViewFromCamera) this.setViewFromCamera = iCameraCommons.setViewFromCamera
    if (!this.setViewToMain) this.setViewToMain = iCameraCommons.setViewToMain

    if (!this.setCanvas) this.setCanvas = ()=>notSupported('setCanvas')
    if (!this.setControlsCtor) this.setControlsCtor = ()=>notSupported('setControlsCtor')
    if (!this.removeControlsCtor) this.removeControlsCtor = ()=>notSupported('removeControlsCtor')
    if (!this.refreshCameraControls) this.refreshCameraControls = ()=>notSupported('refreshCameraControls')
    if (!this.setInteractions) this.setInteractions = ()=>notSupported('setInteractions')
    if (!this.dispose) this.dispose = ()=>notSupported('dispose')


    this.assetType = 'camera'
    // todo uiconfig, anything else?
}

function notSupported(n: string) {
    console.warn(`ICamera.${n} is not supported on this object. Please use objects of PerspectiveCamera2 or OrthographicCamera2 classes.`)
}
