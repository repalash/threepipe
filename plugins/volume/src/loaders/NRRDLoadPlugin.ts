import {AnyOptions, BaseImporterPlugin, ILoader, Importer} from 'threepipe'
import {NRRDLoader} from 'three/examples/jsm/loaders/NRRDLoader.js'
import type {Volume} from 'three/examples/jsm/misc/Volume.js'
import {VolumeData} from '../VolumeData'
import {VolumeObject} from '../VolumeObject'
import {VolumePlugin} from '../VolumePlugin'

/**
 * Options of `viewer.load` for `.nrrd` files, besides the usual import options.
 */
export interface NRRDLoadOptions {
    /**
     * Return the {@link VolumeData} instead of a {@link VolumeObject}. Default false.
     */
    volumeDataOnly?: boolean
    /**
     * Treat the file as a label map (segmentation): nearest sampling. Default false.
     */
    segmentation?: boolean
}

/**
 * Loads `.nrrd` files (`.nhdr` with a separate data file is not supported by the three.js loader yet) with the three.js
 * `NRRDLoader`, as a {@link VolumeObject}.
 *
 * ```ts
 * const viewer = new ThreeViewer({canvas, plugins: [NRRDLoadPlugin]})
 * const volume = await viewer.load<VolumeObject>('https://example.com/scan.nrrd')
 * ```
 *
 * @category Plugins
 */
export class NRRDLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'NRRDLoadPlugin'
    dependencies = [VolumePlugin]

    protected _importer = new Importer(class extends NRRDLoader implements ILoader {
        transform(res: Volume, options: AnyOptions & NRRDLoadOptions): VolumeObject | VolumeData {
            const data = VolumeData.fromVolume(res)
            // the url of this load (the loader is shared by loads that can run at the same time)
            const path = typeof options?.rootPath === 'string' ? options.rootPath : (res as any).__url ?? ''
            if (path && !path.startsWith('blob:') && !path.startsWith('data:')) {
                data.filePath = path
            }
            if (options?.segmentation) data.interpolate = false
            if (options?.volumeDataOnly) return data
            const object = new VolumeObject(data)
            // the material applies its interpolation to the field it draws
            if (options?.segmentation) object.material.interpolate = false
            const name = path ? path.split('/').pop()?.split('?')[0] : ''
            if (name) object.name = name
            return object
        }

        load(url: string, onLoad: (data: Volume) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void): void {
            super.load(url, (volume) => {
                (volume as any).__url = url
                onLoad(volume)
            }, onProgress, onError)
        }
    }, ['nrrd'], ['application/x-nrrd'], true)
}
