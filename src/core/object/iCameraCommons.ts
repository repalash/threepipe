import {iObjectCommons} from './iObjectCommons'
import {Camera, Vector3} from 'three'
import type {ICamera, ICameraEventMap, ICameraSetDirtyOptions} from '../ICamera'

export const iCameraCommons = {
    setDirty: function(this: ICamera, options?: ICameraSetDirtyOptions): void {
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
        // }
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
        if (canvas) this.setCanvas(canvas, _refresh)
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
    if (!this.refreshTarget) this.refreshTarget = iCameraCommons.refreshTarget

    if (!this.activateMain) this.activateMain = iCameraCommons.activateMain
    if (!this.deactivateMain) this.deactivateMain = iCameraCommons.deactivateMain
    if (!this.refreshUi) this.refreshUi = iCameraCommons.refreshUi
    if (!this.setDirty) this.setDirty = iCameraCommons.setDirty
    // if (!this.controlsMode) this.controlsMode = ''

    this.assetType = 'camera'
    // todo uiconfig, anything else?
}
