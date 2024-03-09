import {FileLoader, ILoader, IMaterial, Loader, LoadingManager} from 'threepipe'
import {SortWorkerManager, SPLAT_ROW_LENGTH} from '../cpp-sorter/SortWorkerManager'
import {GaussianSplatGeometry} from '../geometry/GaussianSplatGeometry'
import {GaussianSplatMesh} from '../mesh/GaussianSplatMesh'
import {GaussianSplatMaterialUnlit} from '../materials/GaussianSplatMaterialUnlit'

export class SplatLoader extends Loader implements ILoader {
    sortWorkerManager: SortWorkerManager

    materialConstructor = (_: GaussianSplatGeometry): IMaterial|undefined => new GaussianSplatMaterialUnlit()

    constructor(manager?: LoadingManager) {
        super(manager)
    }

    onGeometryLoad = (_: GaussianSplatGeometry)=>{
        return
    }

    public load(url: string, onLoad?: (data: GaussianSplatMesh) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): void {
        // const path = ( scope.path === '' ) ? LoaderUtils.extractUrlBase( url ) : scope.path;
        const loader = new FileLoader(this.manager)
        loader.setPath(this.path)
        loader.setResponseType('arraybuffer')
        loader.setRequestHeader(this.requestHeader)
        loader.setWithCredentials(this.withCredentials)
        loader.load(url, async(buffer) => {
            try {
                const data = new Uint8Array(buffer as ArrayBuffer)
                const maxSplats = 1000000
                const vertexCount = Math.floor(data.length / SPLAT_ROW_LENGTH)
                const worker = await this.sortWorkerManager.createWorker(data, maxSplats)
                const geometry = new GaussianSplatGeometry(worker, vertexCount, maxSplats, this.onGeometryLoad)
                const mesh = new GaussianSplatMesh(geometry, this.materialConstructor(geometry) as any)
                // const mesh = new GaussianSplatMesh(geometry, new UnlitMaterial() as any)
                mesh.rotation.x = Math.PI
                if (!url.startsWith('blob:') && !url.startsWith('data:'))
                    mesh.name = url.split('/').pop()!.split('?')[0]
                onLoad && onLoad(mesh)
            } catch (e) {
                if (onError) onError(e)
                else console.error(e)
                this.manager.itemError(url)
            }
        }, onProgress, onError)
    }

    public async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GaussianSplatMesh> {
        return new Promise((resolve, reject) => this.load(url, resolve, onProgress, reject))
    }
}
