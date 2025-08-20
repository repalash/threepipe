import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {AssetManager} from '../../assetmanager'
import {onChange, serialize} from 'ts-browser-helpers'
import {IMaterial, IObject3D} from '../../core'
import {UiObjectConfig} from 'uiconfig.js'
import {
    GLTFMaterialsVariantsExtensionImport,
    khrMaterialsVariantsGLTF,
} from './helpers/GLTFMaterialsVariantsExtensionImport'
import {gltfExporterMaterialsVariantsExtensionExport} from './helpers/GLTFMaterialsVariantsExtensionExport'

/**
 * GLTF khr_material_variants plugin
 *
 * This plugin allows to import and export gltf files with KHR_materials_variants extension.
 * The material data is stored in the object userData. The plugin also provides a UI to select the variant.
 *
 * @category Plugins
 */
export class GLTFKHRMaterialVariantsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'GLTFKHRMaterialVariantsPlugin'
    enabled = true

    constructor() {
        super()
    }

    onAdded(v: ThreeViewer): void {
        super.onAdded(v)
        // v.addEventListener('preRender', this._preRender)
        // todo use object3dmanager here instead of addSceneObject
        v.scene.addEventListener('addSceneObject', this._objectAdded)
        v.assetManager.registerGltfExtension(khrMaterialVariantsGLTFExtension)
    }

    onRemove(v: ThreeViewer): void {
        v.scene.removeEventListener('addSceneObject', this._objectAdded)
        v.assetManager.unregisterGltfExtension(khrMaterialVariantsGLTFExtension.name)
        this.variants = {}
        return super.onRemove(v)
    }


    variants: Record<string, IObject3D[]> = {} // dont serialize this

    /**
     * The selected variant. Changing this will automatically apply the variant to the objects.
     */
    @onChange(GLTFKHRMaterialVariantsPlugin.prototype._variantChanged)
    @serialize()
        selectedVariant = ''

    /**
     * If true, the first variant will be applied to the objects when object is added and nothing is selected.
     */
    @serialize()
        applyFirstVariantOnLoad = true

    private _variantChanged() {
        this.applyVariant(this.selectedVariant || '', true)
    }

    /**
     * Apply the variant to objects.
     * It will also change the `selectedVariant` if `root` is not provided.
     * @param name
     * @param force
     * @param root
     * @param doTraverse
     */
    applyVariant(name: string, force = false, root?: IObject3D[], doTraverse = true) {
        if (!force && !root && this.selectedVariant === name) return
        if (!name) return
        if (!root) this.selectedVariant = name
        const objects = root ?
            Array.isArray(root) ? root : [root] :
            name ? this.variants[name] || [] : Object.values(this.variants).flat()
        for (const object of objects) {
            const done = new Set()
            const apply = (obj: IObject3D)=>{
                if (!obj.userData._variantMaterials || done.has(obj)) return
                const va = name ? obj.userData._variantMaterials[name]?.material : obj.userData._originalMaterial
                if (va) {
                    if (!obj.userData._originalMaterial) obj.userData._originalMaterial = obj.material
                    obj.material = va
                }
                done.add(obj)
            }
            if (doTraverse) object.traverse(apply)
            else apply(object)
        }
    }

    private _objectAdded = (ev: any)=>{
        const object = ev.object as IObject3D
        if (!object?.isObject3D) return
        if (!this._viewer) return
        object.traverse((obj)=>{
            if (obj.userData._variantMaterials) {
                for (const val of Object.values(obj.userData._variantMaterials) as any) {
                    if (val?.material) val.material = this._viewer?.materialManager.convertToIMaterial(val.material, {}) || val.material
                }
            }

            const d = obj.userData?.__importData?.[khrMaterialsVariantsGLTF]
            if (!d) return
            const names = d.names || [] as string[]
            for (const name of names) {
                if (!this.variants[name]) this.variants[name] = []
                this.variants[name].push(obj)
            }
            delete obj.userData.__importData[khrMaterialsVariantsGLTF]
        })
        if (!this.selectedVariant && this.applyFirstVariantOnLoad) {
            this.selectedVariant = Object.keys(this.variants)[0] || ''

        }
        this.uiConfig.uiRefresh?.()
        return
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'KHR Material Variants',
        children: [
            ()=>({
                children: [null, ...Object.keys(this.variants)].map((label) => !label ? {label: 'none', value: ''} : {label}),
                type: 'dropdown',
                label: 'Variant',
                property: [this, 'selectedVariant'],
            }),
        ],
    }

}

declare module './../../core/IObject'{
    interface IObject3DUserData{
        /**
         * Starts with `_` so that its not saved in gltf, but saved in json.
         */
        _variantMaterials?: Record<string, {material: IMaterial}>
        _originalMaterial?: IObject3D['material']
    }
}

export const khrMaterialVariantsGLTFExtension = {
    name: khrMaterialsVariantsGLTF,
    import: (p) => new GLTFMaterialsVariantsExtensionImport(p),
    export: gltfExporterMaterialsVariantsExtensionExport,
    // textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]
