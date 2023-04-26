import {IAssetImporter} from './IAssetImporter'
import {IImporter, ILoader} from './IImporter'
import {Class} from 'ts-browser-helpers'

/**
 * Importer for loading files through AssetImporter. By default, it's a wrapper for threejs loaders.
 */
export class Importer<T extends ILoader = ILoader> implements IImporter {
    cls?: Class<T>

    onCtor?: (l: T|undefined, ai: IAssetImporter, i: IImporter) => T|undefined

    ctor(assetImporter: IAssetImporter): ILoader | undefined { // attach all created loaders to this instance and create dispose method to dispose all.
        const loader = this.cls && new this.cls(assetImporter.loadingManager)
        return typeof this.onCtor === 'function' ? this.onCtor(loader, assetImporter, this) : loader
    }

    /**
     * Supported ext, must be in lower case.
     */
    ext: string[] // ['json', 'png', 'jpg', 'data:image/png'...]
    /**
     * Supported mime types, must be in lower case.
     */
    mime: string[]
    root: boolean

    extensions: any[] = []

    constructor(cls: Class<T>, ext: string[], mime: string[], root: boolean, onCtor?: (l: T|undefined, ai: IAssetImporter, i: Importer) => T|undefined) {
        this.cls = cls
        this.ext = ext.filter(Boolean).map(e => e.toLowerCase())
        this.mime = mime.filter(Boolean).map(e => e.toLowerCase())
        this.root = root
        this.onCtor = onCtor
    }
}
