import {IAssetImporter} from './IAssetImporter'
import {IImporter, ILoader} from './IImporter'
import {Class, ValOrFunc} from 'ts-browser-helpers'

/**
 * Importer for loading files through AssetImporter. By default, it's a wrapper for threejs loaders.
 */
export class Importer<T extends ILoader = ILoader> implements IImporter {
    cls?: Class<T>

    // Method syntax, not a function-typed property: a function-typed property is contravariant under
    // `strictFunctionTypes`, so `Importer<STLLoader>` would not be assignable to `Importer<ILoader>` in the
    // declarations of consumers that compile with `strict` and `skipLibCheck: false`.
    onCtor?(l: T|undefined, ai: IAssetImporter, i: IImporter): T|undefined

    ctor(assetImporter: IAssetImporter): ILoader | undefined { // attach all created loaders to this instance and create dispose method to dispose all.
        const loader = this.cls && new this.cls(assetImporter.loadingManager)
        return typeof this.onCtor === 'function' ? this.onCtor(loader, assetImporter, this) : loader
    }

    /**
     * Supported ext, must be in lower case.
     */
    ext: ValOrFunc<string[]> // ['json', 'png', 'jpg', 'data:image/png'...]
    /**
     * Supported mime types, must be in lower case.
     */
    mime: string[]
    root: boolean

    extensions: any[] = []

    constructor(cls: Class<T>, ext: ValOrFunc<string[]>, mime: string[], root: boolean, onCtor?: (l: T|undefined, ai: IAssetImporter, i: Importer) => T|undefined) {
        this.cls = cls
        this.ext = ext// .filter(Boolean).map(e => e.toLowerCase())
        this.mime = mime.filter(Boolean).map(e => e.toLowerCase())
        this.root = root
        this.onCtor = onCtor
    }
}
