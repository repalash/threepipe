import {ThreeViewer} from '../../viewer'
import {BufferAttribute, BufferGeometry} from 'three'
import {IGeometry, iGeometryCommons} from '../../core'
import {toIndexedGeometry} from '../../three'
import {SimplifyModifierPlugin} from './SimplifyModifierPlugin'
import {uiFolderContainer, uiNumber, uiToggle} from 'uiconfig.js'

/**
 * Simplify modifier using [meshoptimizer](https://github.com/zeux/meshoptimizer) library.
 * Loads the library at runtime from a customisable cdn url.
 */
@uiFolderContainer('Simplify Modifier (meshopt)')
export class MeshOptSimplifyModifierPlugin extends SimplifyModifierPlugin {
    public static readonly PluginType = 'MeshOptSimplifyModifierPlugin'

    constructor(initialize = true, public readonly rootNode = document.head) {
        super()
        // todo: check if compatible?
        if (initialize) this.initialize()
    }

    get initialized() {
        return !!window.MeshoptSimplifier
    }

    /**
     * Path to the meshopt simplifier library, default uses unpkg cdn
     */
    static SIMPLIFIER_URL = 'https://unpkg.com/meshoptimizer@0.20.0/meshopt_simplifier.module.js'
    // static SIMPLIFIER_URL = 'https://cdn.jsdelivr.net/gh/zeux/meshoptimizer@master/js/meshopt_simplifier.module.js'

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
    }

    protected _initializing?: Promise<void> = undefined
    protected _script?: HTMLScriptElement

    async initialize() {
        if (this.initialized) return
        if (this._initializing) return await this._initializing
        const s = document.createElement('script')
        s.type = 'module'
        const ev = Math.random().toString(36).substring(7)
        s.innerHTML = `
import { MeshoptSimplifier } from ${JSON.stringify(MeshOptSimplifyModifierPlugin.SIMPLIFIER_URL)};
MeshoptSimplifier.ready.then(() => {
window.MeshoptSimplifier = MeshoptSimplifier;
window.dispatchEvent(new CustomEvent('${ev}'))
});
`
        this._initializing = new Promise<void>((res) => {
            window.addEventListener(ev, ()=>res(), {once: true})
            this.rootNode.appendChild(s)
            this._script = s
        })
        return await this._initializing
    }

    dispose() {
        if (this._script) {
            this._script.remove()
            delete window.MeshoptSimplifier
        }
        this._script = undefined
    }

    @uiNumber()
        errorThreshold = 0.5
    @uiToggle()
        lockBorder = false

    protected _simplify(geometry: BufferGeometry, count: number): IGeometry {
        if (!this.initialized) throw new Error('MeshOptSimplifyModifierPlugin not initialized')
        if (!geometry.index) {
            geometry = toIndexedGeometry(geometry)
        } else {
            geometry = geometry.clone()
        }
        const srcIndexArray = geometry.index!.array
        const srcPositionArray = geometry.attributes.position.array
        const factor = count / geometry.attributes.position.count
        // console.log(factor)
        // const targetCount = count * 3
        const targetCount = 3 * Math.floor(factor * srcIndexArray.length / 3)
        // console.log('srcCount', srcIndexArray.length / 3, 'targetCount', targetCount / 3)
        // const errorThresh = 1e-2
        const [dstIndexArray, error] = window.MeshoptSimplifier.simplify(
            srcIndexArray,
            srcPositionArray,
            3,
            targetCount,
            this.errorThreshold,
            this.lockBorder ? ['LockBorder'] : [],
        )
        console.log('srcCount', srcIndexArray.length / 3, 'destCount', dstIndexArray.length / 3)
        if (error) {
            console.warn('Simplify error', error)
            // return geometry // todo
        }
        // (geometry.index!.array as Uint32Array).set(dstIndexArray)
        geometry.setIndex(new BufferAttribute(new Uint32Array(dstIndexArray), 1))
        // geometry.index!.needsUpdate = true
        // geometry.setDrawRange(0, dstIndexArray.length)
        return iGeometryCommons.upgradeGeometry.call(geometry.toNonIndexed())
    }
}

declare global{
    interface Window{
        MeshoptSimplifier?: any
    }
}
