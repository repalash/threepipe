import {BaseEvent, ColorManagement, EventDispatcher, Material} from 'three'
import {
    IMaterial,
    iMaterialCommons,
    IMaterialEvent,
    IMaterialParameters,
    IMaterialTemplate,
    ITexture,
    ITextureEvent,
    PhysicalMaterial,
    UnlitMaterial,
} from '../core'
import {downloadFile} from 'ts-browser-helpers'
import {MaterialExtension} from '../materials'
import {generateUUID} from '../three/utils/misc'


export class MaterialManager<T = ''> extends EventDispatcher<BaseEvent, T> {
    readonly templates: IMaterialTemplate[] = [
        PhysicalMaterial.MaterialTemplate,
        UnlitMaterial.MaterialTemplate,
    ]

    private _materials: IMaterial[] = []

    constructor() {
        super()
    }

    /**
     * @param info: uuid or template name or material type
     * @param params
     */
    public findOrCreate(info: string, params?: IMaterialParameters|Material): IMaterial | undefined {
        let mat = this.findMaterial(info)
        if (!mat) mat = this.create(info, params)
        return mat
    }

    /**
     * Create a material from the template name or material type
     * @param nameOrType
     * @param register
     * @param params
     */
    public create<TM extends IMaterial>(nameOrType: string, params: IMaterialParameters = {}, register = true): TM | undefined {
        let template: IMaterialTemplate<any> = {materialType: nameOrType, name: nameOrType}
        while (!template.generator) { // looping so that we can inherit templates, not fully implemented yet
            const t2 = this.findTemplate(template.materialType) // todo add a baseTemplate property to the template?
            if (!t2) {
                console.error('Template has no generator or materialType', template, nameOrType)
                return undefined
            }
            template = {...template, ...t2}
        }
        const material = this._create<TM>(template, params)
        if (material && register) this.registerMaterial(material)
        return material
    }

    // make global function?
    protected _create<TM extends IMaterial>(template: IMaterialTemplate<TM>, oldMaterial?: IMaterialParameters|Partial<TM>): TM|undefined {

        if (!template.generator) {
            console.error('Template has no generator', template)
            return undefined
        }

        const legacyColors = (oldMaterial as any)?.metadata && (oldMaterial as any)?.metadata.version <= 4.5
        const lastColorManagementEnabled = ColorManagement.enabled
        if (legacyColors) ColorManagement.enabled = false

        const material = template.generator(template.params || {})
        if (oldMaterial && material) material.setValues(oldMaterial, true)

        if (legacyColors) ColorManagement.enabled = lastColorManagementEnabled

        return material
    }

    public findTemplate(nameOrType: string, withGenerator = false): IMaterialTemplate|undefined {
        if (!nameOrType) return undefined
        return this.templates.find(v => (v.name === nameOrType || v.materialType === nameOrType) && (!withGenerator || v.generator))
            || this.templates.find(v => v.alias?.includes(nameOrType) && (!withGenerator || v.generator))
    }

    protected _getMapsForMaterial(material: IMaterial) {
        const maps = new Set<ITexture>()
        // todo use MaterialProperties or similar to find the maps in the material. This is a bit hacky
        for (const val of Object.values(material)) {
            if (val && val.isTexture) {
                maps.add(val)
            }
        }
        for (const val of Object.values(material.userData ?? {})) {
            if (val && (val as any).isTexture) {
                maps.add(val as ITexture)
            }
        }
        return maps
    }

    protected _disposeMaterial = (e: {target?: IMaterial})=>{
        const mat = e.target
        if (!mat || mat.assetType !== 'material') return
        mat.setDirty()
        const maps = this._getMapsForMaterial(mat)
        maps.forEach(map=>{
            const mats = map.userData.__appliedMaterials!
            mats?.delete(mat)
            if (!mats || map.userData.disposeOnIdle === false) return
            if (mats.size === 0) map.dispose()
        })
        this.unregisterMaterial(mat)
    }

    private _materialMaps = new Map<string, Set<ITexture>>()

    protected _materialUpdate = (e: IMaterialEvent<'materialUpdate'>)=>{
        const mat = e.material || e.target
        if (!mat || mat.assetType !== 'material') return
        this._refreshTextureRefs(mat)
    }

    protected _textureUpdate = function(this: IMaterial, e: ITextureEvent<'update'>) {
        if (!this || this.assetType !== 'material') return
        this.dispatchEvent({texture: e.target, bubbleToParent: true, bubbleToObject: true, ...e, type: 'textureUpdate'})
    }

    private _refreshTextureRefs(mat: any) {
        if (!mat.__textureUpdate) mat.__textureUpdate = this._textureUpdate.bind(mat)
        const newMaps = this._getMapsForMaterial(mat)
        const oldMaps = this._materialMaps.get(mat.uuid) || new Set<ITexture>()
        for (const map of newMaps) {
            if (oldMaps.has(map)) continue
            if (!map.userData.__appliedMaterials) map.userData.__appliedMaterials = new Set<IMaterial>()
            map.userData.__appliedMaterials.add(mat)
            map.addEventListener('update', mat.__textureUpdate)
        }
        for (const map of oldMaps) {
            if (newMaps.has(map)) continue
            map.removeEventListener('update', mat.__textureUpdate)
            if (!map.userData.__appliedMaterials) continue
            const mats = map.userData.__appliedMaterials
            mats?.delete(mat)
            if (!mats || map.userData.disposeOnIdle === false) continue
            if (mats.size === 0) map.dispose()
        }
        this._materialMaps.set(mat.uuid, newMaps)
    }

    public registerMaterial(material: IMaterial): void {
        if (!material) return
        if (this._materials.includes(material)) return
        const mat = this.findMaterial(material.uuid)
        if (mat) {
            console.warn('Material UUID already exists', material, mat)
            return
        }
        // console.warn('Registering material', material)
        material.addEventListener('dispose', this._disposeMaterial)
        material.addEventListener('materialUpdate', this._materialUpdate) // from set dirty
        material.registerMaterialExtensions?.(this._materialExtensions)
        this._materials.push(material)
        this._refreshTextureRefs(material)
    }

    registerMaterials(materials: IMaterial[]): void {
        materials.forEach(material => this.registerMaterial(material))
    }

    /**
     * This is done automatically on material dispose.
     * @param material
     */
    public unregisterMaterial(material: IMaterial): void {
        this._materials = this._materials.filter(v=>v.uuid !== material.uuid)
        material.unregisterMaterialExtensions?.(this._materialExtensions)
        material.removeEventListener('dispose', this._disposeMaterial)
        material.removeEventListener('materialUpdate', this._materialUpdate)
    }
    clearMaterials(): void {
        [...this._materials].forEach(material => this.unregisterMaterial(material))
    }

    public registerMaterialTemplate(template: IMaterialTemplate): void {
        if (!template.templateUUID) template.templateUUID = generateUUID()
        const mat = this.templates.find(v=>v.templateUUID === template.templateUUID)
        if (mat) {
            console.error('MaterialTemplate already exists', template, mat)
            return
        }
        this.templates.push(template)
    }

    public unregisterMaterialTemplate(template: IMaterialTemplate): void {
        const i = this.templates.findIndex(v=>v.templateUUID === template.templateUUID)
        if (i >= 0) this.templates.splice(i, 1)
    }

    dispose() {
        for (const material of this._materials) {
            material.dispose()
        }
        this._materials = []
        return
    }

    public findMaterial(uuid: string): IMaterial | undefined {
        return !uuid ? undefined : this._materials.find(v=>v.uuid === uuid)
    }

    public findMaterialsByName(name: string): IMaterial[] {
        return this._materials.filter(v=>v.name === name)
    }

    public getMaterialsOfType<TM extends IMaterial = IMaterial>(typeSlug: string | undefined): TM[] {
        return typeSlug ? this._materials.filter(v=>v.constructor.TypeSlug === typeSlug) as TM[] : []
    }

    public getAllMaterials(): IMaterial[] {
        return [...this._materials]
    }

    // processModel(object: IModel, options: AnyOptions): IModel {
    //     const k = this._processModel(object, options)
    //     safeSetProperty(object, 'modelObject', k)
    //     return object
    // }
    // protected abstract _processModel(object: any, options: AnyOptions): any
    convertToIMaterial(material: Material&{assetType?:'material', iMaterial?: IMaterial}, options: {useSourceMaterial?:boolean, materialTemplate?: string} = {}): IMaterial|undefined {
        if (!material) return
        if (material.assetType) return <IMaterial>material
        if (material.iMaterial?.assetType) return material.iMaterial
        const uuid = material.userData?.uuid || material.uuid
        let mat = this.findMaterial(uuid)
        if (!mat) {
            const ignoreSource = options.useSourceMaterial === false || !material.isMaterial
            const template = options.materialTemplate || (!ignoreSource && material.type ? material.type || 'physical' : 'physical')
            mat = this.create(template, ignoreSource ? undefined : material)
        } else {
            console.warn('Material with the same uuid already exists, copying properties')
            if (material.type !== mat.type) console.error('Material type mismatch, delete previous material first?', material.type, mat.type)
            mat.setValues(material)
        }
        if (mat) {
            mat.uuid = uuid
            mat.userData.uuid = uuid
            material.iMaterial = mat
        } else {
            console.warn('Failed to convert material to IMaterial, just upgrading', material, options)
            mat = iMaterialCommons.upgradeMaterial.call(material)
        }
        return mat
    }

    // processMaterial(material: IMaterial, options: AnyOptions&{useSourceMaterial?:boolean, materialTemplate?: string, register?: boolean}): IMaterial {
    //     if (!material.materialObject)
    //         material = (this._processMaterial(material, {...options, register: false}))!
    //     if (options.register !== false) this.registerMaterial(material)
    //
    //     return material
    // }

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

    applyMaterial(material: IMaterial, nameOrUuid: string): boolean {
        const mType = Object.getPrototypeOf(material).constructor.TYPE
        let currentMats = this.findMaterialsByName(nameOrUuid)
        if (!currentMats || currentMats.length < 1) currentMats = [this.findMaterial(nameOrUuid) as any]
        let applied = false
        for (const c of currentMats) {
            // console.log(c)
            if (!c) continue
            if (c === material) continue
            if (c.userData.__isVariation) continue
            const cType = Object.getPrototypeOf(c).constructor.TYPE
            // console.log(cType, mType)
            if (cType === mType) {
                const n = c.name
                c.setValues(material)
                c.name = n
                applied = true
            } else {
                // todo
                // if ((c as any)['__' + mType]) continue
                const newMat = (c as any)['__' + mType] || this.create(mType)
                if (!newMat) continue
                const n = c.name
                newMat.setValues(material)
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
}

