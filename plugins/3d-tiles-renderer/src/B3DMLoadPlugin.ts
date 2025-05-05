import {
    BaseImporterPlugin,
    generateUUID,
    GLTFLoader2,
    IAssetImporter,
    ILoader, ImportAddOptions,
    Importer,
    LoadingManager,
    ThreeViewer,
} from 'threepipe'
import type {B3DMResult} from '3d-tiles-renderer/src/three/loaders/B3DMLoader'
import {B3DMLoader, B3DMScene, LoaderBase} from '3d-tiles-renderer'
import {GLTF} from 'three/examples/jsm/loaders/GLTFLoader'

/**
 * Adds support for loading .b3dm files and data uris.
 * Batched 3D Model (b3dm) file format is part of OGC 3D Tiles.
 * Specification - https://www.ogc.org/standards/3dtiles/
 */
export class B3DMLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'B3DMLoadPlugin'
    protected _importer = new Importer(B3DMLoader2, ['b3dm'], ['model/b3dm'], false)

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

// todo no need to extend GLTFLoader2 for just transform function, it can be called manually or rewritten
export class B3DMLoader2 extends GLTFLoader2 implements ILoader<B3DMResult, B3DMScene> {
    loader
    ai?: IAssetImporter

    constructor(manager: LoadingManager) {
        super(manager)
        this.loader = new B3DMLoader(manager)
    }

    transform(res: B3DMResult, options: ImportAddOptions): B3DMScene {
        return super.transform(res, options) as any
    }

    parse(data: ArrayBuffer, _path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void, _url?: string) {
        if (!this.ai) {
            console.error('[B3DMLoader] load failed, IAssetImporter not set')
        }
        const tmpFile = generateUUID() + '.gltf'
        this.ai?.registerFile(tmpFile) // to set the gltf loader in manager

        ;(this.loader as LoaderBase).workingPath = _path

        this.loader.parse(data)
            .then(onLoad)
            .catch(onError)
            .finally(() => {
                if (tmpFile) this.ai?.unregisterFile(tmpFile)
            })
        // super.parse(data, path, onLoad, onError, url)
    }
}
