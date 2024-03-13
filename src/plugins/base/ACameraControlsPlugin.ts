import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {TControlsCtor} from '../../core'

export abstract class ACameraControlsPlugin extends AViewerPluginSync<''> {
    readonly enabled = true
    toJSON: any = undefined
    protected abstract _controlsCtor: TControlsCtor
    abstract readonly controlsKey: string

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this._cameraChanged({camera: viewer.scene.mainCamera})
        viewer.scene.addEventListener('mainCameraChange', this._cameraChanged)
    }

    onRemove(viewer: ThreeViewer): void {
        this._cameraChanged({lastCamera: viewer.scene.mainCamera})
        viewer.scene.removeEventListener('mainCameraChange', this._cameraChanged)
        super.onRemove(viewer)
    }

    private _cameraChanged = (e: any) => {
        e.lastCamera?.removeControlsCtor?.(this.controlsKey)
        e.camera?.setControlsCtor?.(this.controlsKey, this._controlsCtor)
    }
}
