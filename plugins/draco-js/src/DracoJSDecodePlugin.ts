import {getOrCall} from 'ts-browser-helpers'
import {IImporter, Importer, IViewerPluginSync, ThreeViewer} from 'threepipe'
import {DRACOLoader2Pure} from './DRACOLoader2Pure'

/**
 * Opt-in: decode Draco-compressed meshes (standalone `.drc` and glTF `KHR_draco_mesh_compression`)
 * with the pure-JS {@link https://github.com/mrdoob/draco.js | draco.js} decoder instead of the
 * default WASM decoder — smaller, no `.wasm` fetch, no worker spin-up, Node/SSR-safe.
 *
 * Anything draco.js can't decode (sequential connectivity, point-cloud, KD-tree, metadata, or any
 * error) **transparently falls back to the WASM decoder** ({@link DRACOLoader2Pure}), so enabling
 * this never breaks a model. The WASM path also remains the encoder for Draco export.
 *
 * It works by replacing the registered `.drc` importer on the viewer's {@link AssetImporter} with
 * one backed by {@link DRACOLoader2Pure}; removing the plugin restores the original importer. No
 * core wiring is changed — this is a fully reversible, public-API swap.
 *
 * @example
 * ```ts
 * import {ThreeViewer} from 'threepipe'
 * import {DracoJSDecodePlugin} from 'threepipe'
 * const viewer = new ThreeViewer({canvas})
 * viewer.addPluginSync(DracoJSDecodePlugin)
 * await viewer.load('model.glb') // draco meshes now decode via pure JS, WASM-fallback on unsupported
 * ```
 */
export class DracoJSDecodePlugin implements IViewerPluginSync {
    declare ['constructor']: typeof DracoJSDecodePlugin
    public static readonly PluginType = 'DracoJSDecodePlugin'
    enabled = true
    toJSON: any = undefined

    /** The importer we added (DRACOLoader2Pure-backed). */
    protected _added?: Importer
    /** The original `.drc` importer(s) we removed, restored on plugin removal. */
    protected _removed: IImporter[] = []

    /** Number of decodes that fell back to the WASM decoder (unsupported stream / error). `0` means draco.js handled everything natively. */
    get fallbackCount(): number {
        return DRACOLoader2Pure.fallbackCount
    }

    onAdded(viewer: ThreeViewer): void {
        const im = viewer.assetManager.importer
        // Replace every importer that claims the `.drc` extension (the WASM DRACOLoader2 importer).
        const drc = im.importers.filter(i => getOrCall(i.ext)?.includes('drc'))
        for (const old of drc) im.removeImporter(old)
        this._removed = drc

        this._added = new Importer(DRACOLoader2Pure, ['drc'], ['model/mesh+draco', 'model/drc'], true)
        im.addImporter(this._added)

        // Warm the lazy decoder chunk now so the first Draco decode doesn't stall on the import.
        DRACOLoader2Pure.loadDecoderModule().catch(() => {/* decode-time fallback handles failures */})
    }

    onRemove(viewer: ThreeViewer): void {
        const im = viewer.assetManager.importer
        if (this._added) {
            im.removeImporter(this._added)
            this._added = undefined
        }
        if (this._removed.length) {
            im.addImporter(...this._removed)
            this._removed = []
        }
    }

    dispose(): void {
        return
    }
}
