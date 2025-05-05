import {
    AnyOptions,
    BaseImporterPlugin,
    FileLoader, generateUUID,
    IAssetImporter,
    ILoader,
    Importer,
    Loader,
    LoaderUtils,
    LoadingManager,
    ThreeViewer,
} from 'threepipe'
import type {PNTSResult} from '3d-tiles-renderer/src/three/loaders/PNTSLoader'
import {LoaderBase, PNTSLoader, PNTSScene} from '3d-tiles-renderer'

/**
 * Adds support for loading .pnts files and data uris.
 * Point Cloud (pnts) file format is part of OGC 3D Tiles.
 * Specification - https://www.ogc.org/standards/3dtiles/
 */
export class PNTSLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'PNTSLoadPlugin'
    protected _importer = new Importer(PNTSLoader2, ['pnts'], ['model/pnts'], false)

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

export class PNTSLoader2 extends Loader implements ILoader<PNTSResult, PNTSScene> {
    loader
    ai?: IAssetImporter

    constructor(manager: LoadingManager) {
        super(manager)
        this.loader = new PNTSLoader(manager)
    }

    load(url: string, onLoad: (data: unknown) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const scope = this

        let resourcePath

        if (this.resourcePath !== '') {

            resourcePath = this.resourcePath

        } else if (this.path !== '') {

            resourcePath = this.path

        } else {

            resourcePath = LoaderUtils.extractUrlBase(url)

        }

        // Tells the LoadingManager to track an extra item, which resolves after
        // the model is fully loaded. This means the count of items loaded will
        // be incorrect, but ensures manager.onLoad() does not fire early.
        this.manager.itemStart(url)

        // eslint-disable-next-line @typescript-eslint/naming-convention
        const _onError = function(e: any) {

            if (onError) {

                onError(e)

            } else {

                console.error(e)

            }

            scope.manager.itemError(url)
            scope.manager.itemEnd(url)

        }

        const loader = new FileLoader(this.manager)

        loader.setPath(this.path)
        loader.setResponseType('arraybuffer')
        loader.setRequestHeader(this.requestHeader)
        loader.setWithCredentials(this.withCredentials)

        loader.load(url, function(data) {

            try {

                scope.parse(data as any, resourcePath, function(gltf) {

                    onLoad(gltf)

                    scope.manager.itemEnd(url)

                }, _onError, url)

            } catch (e) {

                _onError(e)

            }

        }, onProgress, _onError)

    }

    transform(res: PNTSResult, _options: AnyOptions): PNTSScene {
        return res.scene
    }

    parse(data: ArrayBuffer, _path: string, onLoad: (res: PNTSResult) => void, onError?: (event: ErrorEvent) => void, _url?: string) {
        if (!this.ai) {
            console.error('[PNTSLoader] load failed, IAssetImporter not set')
        }

        const tmpFile = generateUUID() + '.drc'
        this.ai?.registerFile(tmpFile) // to set the draco loader in manager

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
