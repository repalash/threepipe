import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from '../interaction/PickingPlugin'
import {uiButton, uiSlider} from 'uiconfig.js'
import {IGeometry, IObject3D} from '../../core'
import {ValOrArr} from 'ts-browser-helpers'
import {Vector3} from 'three'

export interface SimplifyOptions{
    /**
     * Number of vertices to remove.
     * Factor is not used when count is set.
     */
    count?: number
    /**
     * Factor of vertices to remove. eg 0.5 will remove half of the vertices.
     */
    factor?: number
    /**
     * Replace the geometry with the simplified version in all meshes that use it.
     */
    replace?: boolean
    /**
     * Displace the simplified geometry in the scene. Only used when replace is true
     * If set to true, the geometry will be disposed when replaced.
     * Default is false.
     * This will automatically be done when disposeOnIdle is not false in the geometry.userData.
     */
    disposeOnReplace?: boolean
}

/**
 * Boilerplate for implementing a plugin for simplifying geometries.
 * This is a base class and cannot be used directly.
 * See {@link MeshOptSimplifyModifierPlugin} the [simplify-modifier-plugin](https://threepipe.org/examples/#simplify-modifier-plugin) example for a sample implementation.
 */
export abstract class SimplifyModifierPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'SimplifyModifierPlugin'
    enabled = true
    toJSON: any = undefined

    constructor() {
        super()
    }

    get initialized() { return true }
    async initialize() {return}

    private _pickingPlugin?: PickingPlugin
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._pickingPlugin = viewer.getPlugin(PickingPlugin)
    }

    /**
     * Factor of vertices to remove. eg 0.5 will remove half of the vertices.
     * Default is 0.5
     * This is used when no factor or count is provided in the options to simplifyGeometry or simplifyGeometries.
     */
    @uiSlider('Simplify Factor', [0, 1])
        simplifyFactor = 0.5

    simplifyGeometries(geometry?: ValOrArr<IGeometry>, options?: SimplifyOptions) {
        if (!geometry) {
            const selected = this._pickingPlugin?.getSelectedObject<IObject3D>()
            if (!selected?.isObject3D) return
            const geom: IGeometry[] = []
            selected?.traverse((o) => {
                if (o.geometry && !geom.includes(o.geometry)) geom.push(o.geometry)
            })
            geometry = geom
            if (!geometry || !geometry.length) return
        }
        if (!Array.isArray(geometry)) geometry = [geometry]
        const res: IGeometry[] = []
        for (const g of geometry) {
            res.push(this.simplifyGeometry(g, options)!)
        }
        return res
    }

    simplifyGeometry(geometry?: IGeometry, {
        factor,
        count,
        replace = true,
        disposeOnReplace = false,
    }: SimplifyOptions = {}): IGeometry|undefined {
        if (!geometry) {
            const selected = this._pickingPlugin?.getSelectedObject<IObject3D>()
            geometry = selected?.geometry
            if (!geometry) return undefined
        }
        if (!geometry.attributes.position) {
            this._viewer?.console.error('SimplifyModifierPlugin: Geometry does not have position attribute', geometry)
            return geometry
        }
        factor = factor || this.simplifyFactor
        count = count || geometry.attributes.position.count * factor
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const simplified = this._simplify(geometry, count)
        simplified.computeBoundingBox()
        simplified.computeBoundingSphere()
        simplified.computeVertexNormals()
        const bbox = simplified.boundingBox
        const size = bbox!.getSize(new Vector3())
        if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z)) {
            this._viewer?.console.error('SimplifyModifierPlugin: Unable to simplify', geometry, simplified, size)
            return geometry
        }
        const oldBB = geometry.boundingBox
        const oldSize = oldBB!.getSize(new Vector3())
        const diff = size.clone().sub(oldSize)
        const diffPerc = diff.clone().divide(oldSize)
        if (diffPerc.lengthSq() > 0.001) {
            // todo: add option to skip this
            console.warn('Simplify', geometry, simplified, bbox, oldBB, size, oldSize, diff, diffPerc)
        }
        // simplified.setDirty()
        if (!replace) return simplified

        // not working?
        // geometry.copy(simplified)
        // geometry.setDirty()
        // simplified.dispose()

        const meshes = geometry.appliedMeshes
        if (!meshes) {
            console.error('No meshes found for geometry, cannot replace', geometry)
            return simplified
        }
        for (const mesh of meshes) {
            mesh.geometry = simplified
        }
        if (disposeOnReplace) {
            geometry.dispose(true)
        }
        return simplified
    }

    /**
     * Sample for three.js addons SimplifyModifier:
     * `
     *     import {SimplifyModifier} from 'three/examples/jsm/modifiers/SimplifyModifier'
     *     protected _simplify(geometry: IGeometry, count: number): IGeometry {
     *         const modifier = new SimplifyModifier()
     *         return modifier.modify(geometry, count) as IGeometry
     *     }
     * `
     * @param geometry
     * @param count
     */
    protected abstract _simplify(geometry: IGeometry, count: number): IGeometry

    @uiButton('Simplify All', {sendArgs: false})
    async simplifyAll(root?: IObject3D, options?: SimplifyOptions) {
        if (!root && this._viewer) root = this._viewer.scene.modelRoot
        if (!root) {
            console.error('SimplifyModifierPlugin: No root found')
            return
        }
        if (!this.initialized) {
            await this.initialize()
            if (!this.initialized) {
                this._viewer?.console.error('SimplifyModifierPlugin cannot be initialized')
                return
            }
        }
        const geometries: IGeometry[] = []
        root.traverse((o) => {
            if (o.geometry && !geometries.includes(o.geometry)) geometries.push(o.geometry)
        })
        if (!geometries.length) {
            console.error('SimplifyModifierPlugin: No geometries found')
            return
        }
        return this.simplifyGeometries(geometries, options)
    }

    @uiButton('Simplify Selected')
    async simplifySelected() {
        if (!this._viewer) return
        if (!this.initialized) {
            await this.initialize()
            if (!this.initialized) {
                await this._viewer.dialog.alert('Simplify: SimplifyModifierPlugin cannot be initialized')
                return
            }
        }
        const selected = this._pickingPlugin?.getSelectedObject<IObject3D>()
        if (!selected?.isObject3D) {
            await this._viewer.dialog.alert('Simplify: No Object Selected')
            return
        }
        let doAll = false
        if (!selected.geometry) doAll = true
        else if (selected.children.length === 0) doAll = true
        if (!doAll) {
            const resp = await this._viewer.dialog.confirm('Simplify: Simplify all in hierarchy?')
            if (resp) doAll = true
        }
        if (doAll) {
            this.simplifyGeometries()
        } else {
            this.simplifyGeometry(selected.geometry)
        }
    }

}
