import {
    AnyOptions,
    AViewerPluginSync,
    createStyles,
    EventListener2,
    ILoader,
    Importer,
    ISceneEventMap,
    Scene,
    ThreeViewer,
} from 'threepipe'
import styles from './ThreeGaussianSplatPlugin.css?inline'
import {GaussianSplatMesh} from './index'
import {SplatLoader} from './loaders/SplatLoader'
import {SortWorkerManager} from './cpp-sorter/SortWorkerManager'
import {GaussianSplatGeometry} from './geometry/GaussianSplatGeometry'

export class ThreeGaussianSplatPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'ThreeGaussianSplatPlugin'
    enabled = true
    dependencies = []
    toJSON: any = null

    constructor() {
        super()
    }

    splats: GaussianSplatMesh[] = []
    private _ready = false
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        createStyles(styles, viewer.container)
        viewer.assetManager.importer.addImporter(this._importer)
        viewer.scene.addEventListener('mainCameraUpdate', this._activeCameraUpdate)
        viewer.scene.addEventListener('geometryUpdate', this._geometryUpdate)
        this._ready = true
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.importer.removeImporter(this._importer)
    }

    private _activeCameraUpdate = () => {
        if (!this._ready || this.isDisabled()) return
        this.splats.forEach(async splat=>splat.update(this._viewer!.scene.mainCamera, this._viewer!.renderManager.webglRenderer))
    }

    private _geometryUpdate: EventListener2<'geometryUpdate', ISceneEventMap, Scene> = (event) => {
        if (!this._ready || this.isDisabled() || !(event.geometry as GaussianSplatGeometry)?.isGaussianSplatGeometry) return
        event.geometry!.appliedMeshes.forEach(async(splat: GaussianSplatMesh)=>splat.update ? splat.update(this._viewer!.scene.mainCamera, this._viewer!.renderManager.webglRenderer) : undefined)
    }

    private _sortWorkerManager = new SortWorkerManager() // todo: dispose?
    protected _importer = new Importer(class extends SplatLoader implements ILoader {
        onDispose: (mesh: GaussianSplatMesh)=>void = ()=>{return}
        onCreate: (mesh: GaussianSplatMesh)=>void = ()=>{return}
        transform(res: GaussianSplatMesh, _: AnyOptions): any {
            res.addEventListener('dispose', ()=>this.onDispose(res))
            this.onCreate(res)
            return res
        }
    }, ['splat'], [], true, (l)=>{
        if (!l) return l
        l.sortWorkerManager = this._sortWorkerManager
        l.onDispose = (mesh: GaussianSplatMesh)=>{ // todo: dispose should only remove from GPU?
            this.splats = this.splats.filter(splat=>splat !== mesh)
        }
        l.onCreate = (mesh: GaussianSplatMesh)=>{
            this.splats.push(mesh)
        }
        l.onGeometryLoad = (_)=>{
            // console.log('geometry loaded')
            // console.log(geometry.boundingBox)
            this._viewer?.setDirty()
        }
        return l
    })

    // protected _viewerListeners = {
    //     preRender: (_: IViewerEvent) => {
    //     },
    // }
}
