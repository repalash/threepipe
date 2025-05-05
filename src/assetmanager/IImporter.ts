import {Loader} from 'three'
import {IAssetImporter} from './IAssetImporter'
import {IDisposable} from 'ts-browser-helpers'
import {ImportAddOptions} from './AssetManager'

export interface ILoader<T = any, T2 = T> extends Loader, Partial<IDisposable> {
    importOptions?: ImportAddOptions
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any>;
    /**
     * Transform after load, like convert geometry to mesh, etc. for reference see {@link DRACOLoader2} or {@link PLYLoadPlugin}
     * @param res - result of load
     * @param options
     */
    transform?(res: T, options: ImportAddOptions): T2|Promise<T2>
}
export interface IImporter {
    ext: string[];
    mime: string[];
    root: boolean;
    extensions?: any[]; // extra plugins/extensions for this importer, like for gltf loader.
    ctor: (assetImporter: IAssetImporter)=>ILoader|undefined;
}
