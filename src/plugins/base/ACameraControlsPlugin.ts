import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IScene, ISceneEventMap, TControlsCtor} from '../../core'
import {Event2, EventListener2} from 'three'

export abstract class ACameraControlsPlugin extends AViewerPluginSync {
    readonly enabled = true
    toJSON: any = undefined
    protected abstract _controlsCtor: TControlsCtor
    abstract readonly controlsKey: string

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        // @ts-expect-error hack
        this._cameraChanged({camera: viewer.scene.mainCamera, lastCamera: undefined})
        viewer.scene.addEventListener('mainCameraChange', this._cameraChanged)
    }

    onRemove(viewer: ThreeViewer): void {
        // @ts-expect-error hack
        this._cameraChanged({lastCamera: viewer.scene.mainCamera, camera: undefined})
        viewer.scene.removeEventListener('mainCameraChange', this._cameraChanged)
        super.onRemove(viewer)
    }

    private _cameraChanged: EventListener2<'mainCameraChange', ISceneEventMap, IScene> = (e: Partial<Event2<'mainCameraChange', ISceneEventMap, IScene>>) => {
        e.lastCamera?.removeControlsCtor?.(this.controlsKey)
        e.camera?.setControlsCtor?.(this.controlsKey, this._controlsCtor)
    }
}
