import {Loader} from 'three'
import {IAssetImporter} from './IAssetImporter'
import {AnyOptions, IDisposable} from 'ts-browser-helpers'

export interface ILoader<T = any, T2 = any> extends Loader, Partial<IDisposable> {
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any>;
    /**
     * Transform after load, like convert geometry to mesh, etc. for reference see {@link DRACOLoader2}
     * @param res - result of load
     * @param options
     */
    transform?(res: T, options: AnyOptions): T2|Promise<T2>
}
export interface IImporter {
    ext: string[];
    mime: string[];
    root: boolean;
    extensions?: any[]; // extra plugins/extensions for this importer, like for gltf loader.
    ctor: (assetImporter: IAssetImporter)=>ILoader|undefined;
}
