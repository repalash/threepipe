import {
    AnyOptions,
    BaseImporterPlugin,
    FileLoader, generateUUID,
    Group,
    IAssetImporter,
    ILoader,
    Importer,
    Loader,
    LoaderUtils,
    LoadingManager,
    ThreeViewer,
} from 'threepipe'
import type {CMPTResult} from '3d-tiles-renderer/src/three/loaders/CMPTLoader'
import {CMPTLoader, LoaderBase} from '3d-tiles-renderer'

/**
 * Adds support for loading .cmpt files and data uris.
 * Composite (cmpt) file format is part of OGC 3D Tiles.
 * Specification - https://www.ogc.org/standards/3dtiles/
 */
export class CMPTLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'CMPTLoadPlugin'
    protected _importer = new Importer(CMPTLoader2, ['cmpt'], ['model/cmpt'], false)

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

export class CMPTLoader2 extends Loader implements ILoader<CMPTResult, Group> {
    loader
    ai?: IAssetImporter

    constructor(manager: LoadingManager) {
        super(manager)
        this.loader = new CMPTLoader(manager)
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

    transform(res: CMPTResult, _options: AnyOptions): Group {
        return res.scene
    }

    parse(data: ArrayBuffer, _path: string, onLoad: (res: CMPTResult) => void, onError?: (event: ErrorEvent) => void, _url?: string) {
        if (!this.ai) {
            console.error('[CMPTLoader] load failed, IAssetImporter not set')
        }
        // todo register draco for inside pnts files

        const tmpFile = generateUUID()
        this.ai?.registerFile(tmpFile + '.gltf') // to set the gltf loader in manager
        this.ai?.registerFile(tmpFile + '.drc') // to set the draco loader in manager

        ;(this.loader as LoaderBase).workingPath = _path

        this.loader.parse(data)
            .then(onLoad)
            .catch(onError)
            .finally(() => {
                if (tmpFile && this.ai) {
                    this.ai.unregisterFile(tmpFile + '.gltf')
                    this.ai.unregisterFile(tmpFile + '.drc')
                }
            })
        // super.parse(data, path, onLoad, onError, url)
    }
}
