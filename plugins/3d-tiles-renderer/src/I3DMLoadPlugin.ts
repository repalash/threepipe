import {
    BaseImporterPlugin,
    generateUUID,
    GLTF,
    GLTFLoader2,
    IAssetImporter,
    ILoader,
    ImportAddOptions,
    Importer,
    LoadingManager,
    ThreeViewer,
} from 'threepipe'
import type {I3DMResult} from '3d-tiles-renderer/src/three/loaders/I3DMLoader'
import {I3DMLoader, I3DMScene, LoaderBase} from '3d-tiles-renderer'

/**
 * Adds support for loading .i3dm files and data uris.
 * Instanced 3D Model (i3dm) file format is part of OGC 3D Tiles.
 * Specification - https://www.ogc.org/standards/3dtiles/
 */
export class I3DMLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'I3DMLoadPlugin'
    protected _importer = new Importer(I3DMLoader2, ['i3dm'], ['model/i3dm'], false)

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

// todo no need to extend GLTFLoader2 for just transform function, it can be called manually or rewritten
export class I3DMLoader2 extends GLTFLoader2 implements ILoader<I3DMResult, I3DMScene> {
    loader
    ai?: IAssetImporter

    constructor(manager: LoadingManager) {
        super(manager)
        this.loader = new I3DMLoader(manager)
    }

    transform(res: I3DMResult, options: ImportAddOptions): I3DMScene {
        return super.transform(res, options) as any
    }

    parse(data: ArrayBuffer, _path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void, _url?: string) {
        if (!this.ai) {
            console.error('[I3DMLoader] load failed, IAssetImporter not set')
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
