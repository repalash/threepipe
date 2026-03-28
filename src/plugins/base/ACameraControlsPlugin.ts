import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {ICamera, IScene, ISceneEventMap, TControlsCtor} from '../../core'
import {EventListener2} from 'three'

export abstract class ACameraControlsPlugin extends AViewerPluginSync {
    readonly enabled = true
    toJSON: any = undefined
    protected abstract _controlsCtor: TControlsCtor
    abstract readonly controlsKey: string

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this._registerControls(viewer.scene.mainCamera)
        viewer.scene.addEventListener('mainCameraChange', this._cameraChanged)
    }

    onRemove(viewer: ThreeViewer): void {
        this._unregisterControls(viewer.scene.mainCamera)
        viewer.scene.removeEventListener('mainCameraChange', this._cameraChanged)
        super.onRemove(viewer)
    }

    private _registerControls(camera?: ICamera) {
        camera?.setControlsCtor?.(this.controlsKey, this._controlsCtor)
    }

    private _unregisterControls(camera?: ICamera) {
        camera?.removeControlsCtor?.(this.controlsKey)
    }

    private _cameraChanged: EventListener2<'mainCameraChange', ISceneEventMap, IScene> = (e) => {
        this._unregisterControls(e.lastCamera)
        this._registerControls(e.camera)
    }
}
