import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js'
import {BufferGeometry, Color, LoadingManager, Mesh, MeshStandardMaterial} from 'three'
import {AnyOptions} from 'ts-browser-helpers'
import {ILoader} from '../IImporter'

export class DRACOLoader2 extends DRACOLoader implements ILoader<BufferGeometry, Mesh|undefined> {
    public encoderPending: Promise<any>|null = null
    public encoderConfig: any = {type: 'js'}

    public static DRACO_LIBRARY_PATH = 'https://cdn.jsdelivr.net/gh/google/draco@1.4.1/javascript/' // https://github.com/google/draco
    // public static DRACO_LIBRARY_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.4.1/'
    // public static DRACO_LIBRARY_PATH = 'https://threejs.org/examples/jsm/libs/draco/'

    constructor(manager?: LoadingManager) {
        super(manager)
        this.setDecoderPath(DRACOLoader2.DRACO_LIBRARY_PATH)
        this.setDecoderConfig({type: 'js'}) // todo: hack for now, encoder works with wasm, maybe not decoder.
    }

    transform(res: BufferGeometry, _: AnyOptions): Mesh|undefined {
        if (!res.attributes?.normal) res.computeVertexNormals()
        // todo set mesh name from options/path
        return res ? new Mesh(res, new MeshStandardMaterial({color: new Color(1, 1, 1)})) : undefined
    }

    preload(decoder = true, encoder = false): DRACOLoader {
        if (decoder) super.preload()
        if (encoder) this.initEncoder()
        return this
    }

    public async initEncoder() {

        if (this.encoderPending) return this.encoderPending
        // this.setDecoderConfig({type: 'js'}) // todo: hack for now.

        const useJS = typeof WebAssembly !== 'object' || this.encoderConfig.type === 'js'
        const librariesPending = []

        if (useJS) {
            librariesPending.push(this._loadLibrary('draco_encoder.js', 'text'))
        } else {
            // todo: not tested
            librariesPending.push(this._loadLibrary('draco_wasm_wrapper.js', 'text'))
            librariesPending.push(this._loadLibrary('draco_encoder.wasm', 'arraybuffer'))
        }

        this.encoderPending = Promise.all(librariesPending)
            .then((libraries) => {
                const jsContent = libraries[ 0 ]
                if (!useJS) {
                    this.encoderConfig.wasmBinary = libraries[ 1 ]
                }
                const eval2 = eval
                return eval2(jsContent + '\nDracoEncoderModule;')?.()
            })

        return this.encoderPending

    }

    public async initDecoder() {
        await (this as any)._initDecoder()
        const jsContent = await fetch((this as any).workerSourceURL).then(async response => response.text()).then(text => {
            const i = text.indexOf('/* worker */')
            if (i < 1) throw new Error('unable to load decoder module')
            return text.substring(0, i - 1)
        })
        const eval2 = eval
        return eval2(jsContent + '\nDracoDecoderModule;')?.()
    }

}
