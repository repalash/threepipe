import {BaseImporterPlugin, Importer, LoadingManager, ThreeViewer} from 'threepipe'
// @ts-expect-error moduleResolution issue
import {XYZTilesPlugin} from '3d-tiles-renderer/plugins'
import {TilesRendererLoader, TilesRendererPlugin} from './TilesRendererPlugin'

/**
 * Adds support for loading slippy map tiles(OpenStreetMap) in png format
 * https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */
export class SlippyMapTilesLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'SlippyMapTilesLoadPlugin'
    static readonly DUMMY_EXT = 'xyztiles'
    protected _importer = new Importer(SlippyMapTilesLoader, [SlippyMapTilesLoadPlugin.DUMMY_EXT], [], false)

    dependencies = [TilesRendererPlugin]

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
    }
}

export class SlippyMapTilesLoader extends TilesRendererLoader {
    constructor(manager: LoadingManager) {
        super(manager)
        this.plugins.push(
            (opts)=>{
                if (opts?.XYZTilesPlugin === false) return undefined
                const op = typeof opts?.XYZTilesPlugin === 'object' ? opts.XYZTilesPlugin : {}
                return new XYZTilesPlugin(op)
            },
        )
    }
}

declare module 'TilesRendererPlugin'{
    interface TilesImportOptions {
        XYZTilesPlugin?: boolean | {
            levels: number // default = 20,
            tileDimension: number // default = 256,
            pixelSize: number // default = 1e-5,
            center?: boolean,
            projection?: 'ellipsoid' | 'planar',
            useRecommendedSettings?: boolean,
        }
    }
}
