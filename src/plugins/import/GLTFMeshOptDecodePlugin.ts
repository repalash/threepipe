import {IViewerPluginSync} from '../../viewer'
import {SimpleEventDispatcher} from 'ts-browser-helpers'

/**
 * Loads the MeshOpt Decoder module from [meshoptimizer](https://github.com/zeux/meshoptimizer) library at runtime from a customisable cdn url.
 * The loaded module is set in window.MeshoptDecoder and then used by {@link GLTFLoader2} to decode files using [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md) extension
 *
 * The plugin name includes GLTF, but its not really GLTF specific, it can be used to decode any meshopt compressed files.
 */
export class GLTFMeshOptDecodePlugin extends SimpleEventDispatcher<'initialized'> implements IViewerPluginSync {
    declare ['constructor']: typeof GLTFMeshOptDecodePlugin
    public static readonly PluginType = 'GLTFMeshOptDecodePlugin'
    enabled = true
    toJSON: any = undefined

    constructor(initialize = true, public readonly rootNode = document.head) {
        super()
        // todo: check if compatible?
        if (initialize) this.initialize()
    }

    get initialized() {
        return !!window.MeshoptDecoder
    }

    /**
     * Path to the meshopt decoder library, default uses unpkg cdn
     */
    static DECODER_URL = 'https://unpkg.com/meshoptimizer@0.20.0/meshopt_decoder.module.js'
    // static DECODER_URL = 'https://cdn.jsdelivr.net/gh/zeux/meshoptimizer@master/js/meshopt_decoder.module.js'

    protected _script?: HTMLScriptElement

    protected _initializing?: Promise<void> = undefined

    async initialize() {
        if (this.initialized) return
        if (this._initializing) return await this._initializing
        const s = document.createElement('script')
        s.type = 'module'
        const ev = Math.random().toString(36).substring(7)
        s.innerHTML = `
import { MeshoptDecoder } from ${JSON.stringify(GLTFMeshOptDecodePlugin.DECODER_URL)};
window.MeshoptDecoder = MeshoptDecoder; // setting it before ready as GLTFLoader supports it.
MeshoptDecoder.ready.then(() => {
window.dispatchEvent(new CustomEvent('${ev}'))
});
`
        this._initializing = new Promise<void>((res) => {
            window.addEventListener(ev, ()=>res(), {once: true})
            this.rootNode.appendChild(s)
            this._script = s
        })
        await this._initializing
        this.dispatchEvent({type: 'initialized'})
    }

    dispose() {
        if (this._script) {
            this._script.remove()
            delete window.MeshoptDecoder
        }
        this._script = undefined
    }

    onAdded(): void { return }
    onRemove(): void { return }
}

declare global{
    interface Window{
        MeshoptDecoder?: any
    }
}
