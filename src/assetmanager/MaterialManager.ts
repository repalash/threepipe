import {EventDispatcher, Material, ShaderChunk} from 'three'
import {AnimateTimeMaterial, IMaterial, iMaterialCommons, IMaterialParameters} from '../core'
import {downloadFile, safeSetProperty} from 'ts-browser-helpers'
import {MaterialExtension} from '../materials'
import {generateUUID} from '../three'
import {shaderReplaceString, ThreeSerialization} from '../utils'
import {upgradeMaterial} from '../core/material/iMaterialCommons'

/**
 * Material Manager
 * Utility class to manage materials.
 * Maintains a library of materials and material templates that can be used to manage or create new materials.
 * Used in {@link AssetManager} to manage materials.
 * @category Asset Manager
 */
export class MaterialManager<TEventMap extends object = object> extends EventDispatcher<TEventMap> {
    private _materials: IMaterial[] = []

    constructor() {
        super()
        legacyBumpScaleFixSetup()
    }

    /**
     * @deprecated
     * @param info - uuid or material type
     * @param params
     */
    public findOrCreate(info: string, params?: IMaterialParameters|Material): IMaterial | undefined {
        let mat = this.findMaterial(info)
        if (!mat) mat = this.create(info, params)
        return mat
    }

    /**
     * Create a material from the material type
     * @param type
     * @param register
     * @param params
     */
    public create<TM extends IMaterial>(type: string, params: IMaterialParameters = {}, register = true, uuid?: string): TM | undefined {
        const mat = this.findTemplate(type)
        if (!mat) {
            console.error('No material template found for type', type)
            return undefined
        }
        const material = this._create<TM>(mat, params)
        if (uuid) {
            safeSetProperty(material, 'uuid', uuid, true, true)
        }
        if (material && register) this.registerMaterial(material)
        return material
    }

    // make global function?
    protected _create<TM extends IMaterial>(template: IMaterial['constructor'], oldMaterial?: IMaterialParameters|Partial<TM>): TM|undefined {

        if (!template) {
            console.error('No material template provided')
            return undefined
        }

        const material = new template()
        if (oldMaterial && material) material.setValues(oldMaterial, true)

        return material as TM
    }

    protected _disposeMaterial = (e: {target?: IMaterial})=>{
        const mat = e.target
        if (!mat || mat.assetType !== 'material') return
        // mat.setDirty()
        this.unregisterMaterial(mat) // not unregistering on dispose, that has to be done explicitly as its ideally for GPU resources
    }
    protected _registerMaterial = (e: {target?: IMaterial})=>{
        const mat = e.target
        if (!mat || mat.assetType !== 'material') return
        this.registerMaterial(mat)
    }

    registerMaterial(material: IMaterial): void {
        if (!material) return
        if (this._materials.includes(material)) return
        if (!material.assetType) upgradeMaterial.call(material)
        const mat = this.findMaterial(material.uuid)
        // todo make an option to return the same material instance and replace it, instead of replacing uuid
        if (mat) {
            // console.warn('MaterialManager: imported material uuid already exists, creating new uuid')
            safeSetProperty(material, 'uuid', generateUUID(), true, true)
            if (material.userData.uuid) material.userData.uuid = material.uuid
        }
        // todo: check for name exists also?

        // console.warn('Registering material', material)
        // material.addEventListener('dispose', this._disposeMaterial)
        material.addEventListener('__unregister', this._disposeMaterial)
        material.addEventListener('__register', this._registerMaterial)
        // material.addEventListener('materialUpdate', this._materialUpdate) // from set dirty
        material.registerMaterialExtensions?.(this._materialExtensions)
        material.setDirty() // this is required to be done here, as it calls refreshTextureRefs
        this._materials.push(material)
    }

    registerMaterials(materials: IMaterial[]): void {
        materials.forEach(material => this.registerMaterial(material))
    }

    unregisterExtensionsOnRemove = false

    /**
     * This is done automatically on material dispose.
     * @param material
     */
    unregisterMaterial(material: IMaterial): void {
        this._materials = this._materials.filter(v=>v.uuid !== material.uuid)
        if (this.unregisterExtensionsOnRemove) {
            material.unregisterMaterialExtensions?.(this._materialExtensions)
        }
        material.removeEventListener('__unregister', this._disposeMaterial)
        material.removeEventListener('__register', this._registerMaterial)
        // material.removeEventListener('materialUpdate', this._materialUpdate)
    }
    clearMaterials(): void {
        [...this._materials].forEach(material => this.unregisterMaterial(material))
    }

    dispose(disposeRuntimeMaterials = true) {
        const mats = this._materials
        this._materials = []
        for (const material of mats) {
            if (!disposeRuntimeMaterials && material.userData.runtimeMaterial) {
                this._materials.push(material)
                continue
            }
            material.dispose()
        }
        return
    }

    findMaterial(uuid: string): IMaterial | undefined {
        return !uuid ? undefined : this._materials.find(v=>v.uuid === uuid)
    }

    findMaterialsByName(name: string|RegExp, regex = false): IMaterial[] {
        return this._materials.filter(v=>
            typeof name !== 'string' || regex ?
                v.name.match(typeof name === 'string' ? '^' + name + '$' : name) !== null :
                v.name === name
        )
    }

    getMaterialsOfType<TM extends IMaterial = IMaterial>(typeSlug: string | undefined): TM[] {
        return typeSlug ? this._materials.filter(v=>v.constructor.TypeSlug === typeSlug) as TM[] : []
    }

    getAllMaterials(): IMaterial[] {
        return [...this._materials]
    }

    /**
     * Creates a new material if a compatible template is found or apply minimal upgrades and returns the original material.
     * Also checks from the registered materials, if one with the same uuid is found, it is returned instead with the new parameters.
     * Also caches the response.
     * Returns the same material if its already upgraded.
     * @param material - the material to upgrade/check
     * @param useSourceMaterial - if false, will not use the source material parameters in the new material. default = true
     * @param materialTemplate - any specific material template to use instead of detecting from the material type.
     * @param createFromTemplate - if false, will not create a new material from the template, but will apply minimal upgrades to the material instead. default = true
     */
    convertToIMaterial(material: Material&{assetType?:'material', iMaterial?: IMaterial}, {useSourceMaterial = true, materialTemplate, createFromTemplate = true}: {useSourceMaterial?:boolean, materialTemplate?: string, createFromTemplate?: boolean} = {}): IMaterial|undefined {
        if (!material) return
        if (material.assetType) return <IMaterial>material
        if (material.iMaterial?.assetType) return material.iMaterial
        const uuid = material.userData?.uuid || material.uuid
        let mat = this.findMaterial(uuid)
        if (!mat && createFromTemplate !== false) {
            const ignoreSource = useSourceMaterial === false || !material.isMaterial
            const template = materialTemplate || (!ignoreSource && material.type ? material.type || 'physical' : 'physical')
            mat = this.create(template, ignoreSource ? undefined : material)
        } else if (mat) {
            // if ((mat as any).iMaterial) mat = (mat as any).iMaterial
            console.warn('Material with the same uuid already exists, copying properties')
            if (material.type !== mat!.type) console.error('Material type mismatch, delete previous material first?', material, mat)
            mat!.setValues(material)
        }
        if (mat) {
            mat.uuid = uuid
            mat.userData.uuid = uuid
            material.iMaterial = mat
        } else {
            console.warn('Failed to convert material to IMaterial, just upgrading', material, useSourceMaterial, materialTemplate)
            mat = iMaterialCommons.upgradeMaterial.call(material)
        }
        return mat
    }

    protected _materialExtensions: MaterialExtension[] = []

    registerMaterialExtension(extension: MaterialExtension): void {
        if (this._materialExtensions.includes(extension)) return
        this._materialExtensions.push(extension)
        for (const mat of this._materials) mat.registerMaterialExtensions?.([extension])
    }
    unregisterMaterialExtension(extension: MaterialExtension): void {
        const i = this._materialExtensions.indexOf(extension)
        if (i < 0) return
        this._materialExtensions.splice(i, 1)
        for (const mat of this._materials) mat.unregisterMaterialExtensions?.([extension])
    }
    clearExtensions() {
        [...this._materialExtensions].forEach(v=>this.unregisterMaterialExtension(v))
    }

    exportMaterial(material: IMaterial, filename?: string, minify = true, download = false): File {
        const serialized = material.toJSON()
        const json = JSON.stringify(serialized, null, minify ? 0 : 2)
        const name = (filename || material.name || 'physical_material') + '.' + material.constructor.TypeSlug
        const blob = new File([json], name, {type: 'application/json'})
        if (download) downloadFile(blob)
        return blob
    }

    applyMaterial(material: IMaterial, nameRegexOrUuid: string, regex = true, time?: AnimateTimeMaterial): boolean {
        let currentMats = this.findMaterialsByName(nameRegexOrUuid, regex)
        if (!currentMats || currentMats.length < 1) currentMats = [this.findMaterial(nameRegexOrUuid) as any]
        let applied = false
        for (const c of currentMats) {
            // console.log(c)
            if (!c) continue
            if (c === material) continue
            if (c.userData.__isVariation) continue
            const applied2 = this.copyMaterialProps(c, material, time)
            if (applied2) applied = true
        }
        return applied
    }

    /**
     * copyProps from material to c
     * @param c
     * @param material
     * @param time
     */
    copyMaterialProps(c: IMaterial, material: IMaterial, time?: AnimateTimeMaterial) {
        let applied = false
        const mType = Object.getPrototypeOf(material).constructor.TYPE
        const cType = Object.getPrototypeOf(c).constructor.TYPE
        // console.log(cType, mType)
        if (cType === mType) {
            const n = c.name
            c.setValues(material, undefined, undefined, time)
            c.name = n
            applied = true
        } else {
            // todo
            // if ((c as any)['__' + mType]) continue
            const newMat = (c as any)['__' + mType] || this.create(mType)
            if (newMat) {
                const n = c.name
                // newMat.setValues(material, undefined, undefined, time)
                if (newMat.setValues) newMat.setValues(material)
                else Object.assign(newMat, material)
                newMat.name = n
                const meshes = c.appliedMeshes
                for (const mesh of [...meshes ?? []]) {
                    if (!mesh) continue
                    mesh.material = newMat
                    applied = true
                }
                (c as any)['__' + mType] = newMat
            }
        }
        return applied
    }


    /**
     * @deprecated use {@link ThreeSerialization.SerializableMaterials} directly
     * @param template
     */
    registerMaterialTemplate(template: IMaterial['constructor']): void {
        if (!template || ThreeSerialization.SerializableMaterials.has(template)) return
        const mat = ThreeSerialization.SerializableMaterials.values().find(v=>v.TYPE === template.TYPE)
        if (mat) {
            console.warn('Material template with the same type already exists', template, mat)
        }
        ThreeSerialization.SerializableMaterials.add(template)
    }

    /**
     * @deprecated use {@link ThreeSerialization.SerializableMaterials} directly
     * @param template
     */
    unregisterMaterialTemplate(template: IMaterial['constructor']): void {
        if (!template) return
        ThreeSerialization.SerializableMaterials.delete(template)
    }

    /**
     * @deprecated use {@link ThreeSerialization.SerializableMaterials} directly
     * @param type
     */
    findTemplate(type: string) {
        if (!type) return undefined
        return ThreeSerialization.SerializableMaterials.values().find(v => v.TYPE === type)
            || ThreeSerialization.SerializableMaterials.values().find(v => v.TypeAlias?.includes(type))
    }

}

function legacyBumpScaleFixSetup() {
    const a = `
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
`
    ShaderChunk.bumpmap_pars_fragment = shaderReplaceString(ShaderChunk.bumpmap_pars_fragment, a, `
    #ifdef BUMP_MAP_SCALE_LEGACY
        ${a.replace(/normalize/g, '')}
    #else
        ${a}
    #endif
    `)
}
