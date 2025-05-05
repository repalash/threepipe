import {BaseImporterPlugin, Importer, LoadingManager, ThreeViewer} from 'threepipe'
// @ts-expect-error moduleResolution issue
import {DeepZoomImagePlugin} from '3d-tiles-renderer/plugins'
import {TilesRendererLoader, TilesRendererPlugin} from './TilesRendererPlugin'

/**
 * Adds support for loading .dzi files and data uris.
 * Deep Zoom Image (dzi) file format - https://openseadragon.github.io/
 */
export class DeepZoomImageLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'DeepZoomImageLoadPlugin'
    protected _importer = new Importer(DeepZoomImageLoader, ['dzi'], ['image/dzi'], false)

    dependencies = [TilesRendererPlugin]

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

export class DeepZoomImageLoader extends TilesRendererLoader {
    constructor(manager: LoadingManager) {
        super(manager)
        this.plugins.push(
            (opts)=>{
                if (opts?.DeepZoomImagePlugin === false) return undefined
                const op = typeof opts?.DeepZoomImagePlugin === 'object' ? opts.DeepZoomImagePlugin : {}
                return new DeepZoomImagePlugin({
                    // center: true,
                    ...op,
                })
            },
        )
    }
}

declare module 'TilesRendererPlugin'{
    interface TilesImportOptions {
        DeepZoomImagePlugin?: boolean | {
            center?: boolean,
            pixelSize?: number,
            useRecommendedSettings?: boolean,
        }
    }
}
