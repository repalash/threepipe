import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from '../interaction/PickingPlugin'
import {imageBitmapToBase64, makeColorSvgCircle, serialize} from 'ts-browser-helpers'
import {UiObjectConfig} from 'uiconfig.js'
import {IMaterial, PhysicalMaterial} from '../../core'
import {MaterialPreviewGenerator} from '../../three'
import {Color} from 'three'

/**
 * Material Configurator Plugin (Base)
 *
 * This plugin allows you to create variations of materials mapped to material names or uuids in the scene.
 * These variations can be applied to the materials in the scene. (This copies the properties to the same material instances instead of assigning new materials)
 * The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
 *
 * See `MaterialConfiguratorPlugin` in [plugin-configurator](https://threepipe.org/plugins/configurator/docs/index.html) for example on inheriting with a custom UI renderer.
 *
 * @category Plugins
 */
export class MaterialConfiguratorBasePlugin extends AViewerPluginSync {
    enabled = true
    public static PluginType = 'MaterialConfiguratorPlugin'
    private _picking: PickingPlugin | undefined
    protected _previewGenerator: MaterialPreviewGenerator | undefined
    private _uiNeedRefresh = false

    constructor() {
        super()
        this.addEventListener('deserialize', this.refreshUi)
        this.refreshUi = this.refreshUi.bind(this)
        this._refreshUi = this._refreshUi.bind(this)
        this._refreshUiConfig = this._refreshUiConfig.bind(this)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        // todo subscribe to plugin add event if picking is not added yet.
        viewer.forPlugin(PickingPlugin, (p)=>{
            this._picking = p
            this._picking?.addEventListener('selectedObjectChanged', this._refreshUiConfig)
        }, ()=>{
            this._picking?.removeEventListener('selectedObjectChanged', this._refreshUiConfig)
            this._picking = undefined
        })
        this._previewGenerator = new MaterialPreviewGenerator()
        viewer.addEventListener('preFrame', this._refreshUi)
    }

    /**
     * Apply all variations(by selected index or first item) when a config is loaded
     */
    applyOnLoad = true

    /**
     * Reapply all selected variations again.
     * Useful when the scene is loaded or changed and the variations are not applied.
     */
    reapplyAll() {
        this.variations.forEach(v => this.applyVariation(v, v.materials[v.selectedIndex ?? 0].uuid))
    }

    fromJSON(data: any, meta?: any): this | Promise<this | null> | null {
        this.variations = []
        if (!super.fromJSON(data, meta)) return null // its not a promise
        if (data.applyOnLoad === undefined) { // old files
            this.applyOnLoad = false
        }
        if (this.applyOnLoad) this.reapplyAll()
        return this
    }

    onRemove(viewer: ThreeViewer) {
        this._previewGenerator?.dispose()
        this._previewGenerator = undefined

        this._picking?.removeEventListener('selectedObjectChanged', this._refreshUiConfig)
        this.removeEventListener('deserialize', this.refreshUi)
        viewer.removeEventListener('preFrame', this._refreshUi)

        this._picking = undefined

        return super.onRemove(viewer)
    }

    findVariation(uuid?: string): MaterialVariations|undefined {
        return uuid ? this.variations.find(v => v.uuid === uuid) : undefined
    }

    getSelectedVariation(): MaterialVariations|undefined {
        return this.findVariation(this._selectedMaterial()?.uuid) || this.findVariation(this._selectedMaterial()?.name)
    }

    /**
     * Apply a material variation based on index or uuid.
     * @param variations
     * @param matUuidOrIndex
     */
    applyVariation(variations: MaterialVariations, matUuidOrIndex: string|number): boolean {
        const m = this._viewer?.materialManager
        if (!m) return false
        const material = typeof matUuidOrIndex === 'string' ?
            variations.materials.find(m1 => m1.uuid === matUuidOrIndex) :
            variations.materials[matUuidOrIndex]
        if (!material) return false
        variations.selectedIndex = variations.materials.indexOf(material)
        return m.applyMaterial(material, variations.uuid)
    }

    /**
     * Get the preview for a material variation
     * Should be called from preFrame ideally. (or preRender but set viewerSetDirty = false)
     * @param preview - Type of preview. Could be generate:sphere, generate:cube, color, map, emissive, etc.
     * @param material - Material or index of the material in the variation.
     * @param viewerSetDirty - call viewer.setDirty() after setting the preview. So that the preview is cleared from the canvas.
     */
    getPreview(material: IMaterial, preview: string, viewerSetDirty = true): string {
        if (!this._viewer) return ''
        // const m = typeof material === 'number' ? variation.materials[material] : material
        const m = material
        if (!m) return ''
        let image = ''
        if (!preview.startsWith('generate:')) {
            const pp = (m as any)[preview] || '#ff00ff'
            image = pp.image ? imageBitmapToBase64(pp.image, 100) : ''
            if (!image.length) image = makeColorSvgCircle(pp.isColor ? (pp as Color).getHexString() : pp)
        } else {
            image = this._previewGenerator!.generate(m,
                this._viewer.renderManager.renderer,
                this._viewer.scene.environment,
                preview.split(':')[1]
            )
        }
        if (viewerSetDirty) this._viewer.setDirty() // because called from preFrame
        return image
    }

    /**
     * Refreshes the UI in the next frame
     */
    refreshUi(): void {
        if (!this.enabled || !this._viewer) return
        this._uiNeedRefresh = true
    }

    private _refreshUiConfig() {
        if (!this.enabled) return
        this.uiConfig.uiRefresh?.() // don't call this.refreshUi here
    }

    // must be called from preFrame
    protected async _refreshUi(): Promise<boolean> {
        if (!this.enabled) return false
        if (!this._viewer || !this._uiNeedRefresh) return false
        this._uiNeedRefresh = false
        this._refreshUiConfig()
        return true
    }

    @serialize()
        variations: MaterialVariations[] = []

    private _selectedMaterial = () => (this._picking?.getSelectedObject()?.material || undefined) as IMaterial | undefined
    uiConfig: UiObjectConfig = {
        label: 'Material Configurator',
        type: 'folder',
        // expanded: true,
        children: [
            () => [
                {
                    type: 'input',
                    label: 'uuid',
                    property: [this._selectedMaterial(), 'uuid'],
                    hidden: () => !this._selectedMaterial(),
                    disabled: true,
                },
                {
                    type: 'input',
                    label: 'mapping',
                    hidden: () => !this._selectedMaterial(),
                    property: () => [this.getSelectedVariation(), 'uuid'],
                    onChange: async() => this.refreshUi(),
                },
                {
                    type: 'input',
                    label: 'title',
                    hidden: () => !this._selectedMaterial(),
                    property: () => [this.getSelectedVariation(), 'title'],
                    onChange: async() => this.refreshUi(),
                },
                {
                    type: 'dropdown',
                    label: 'Preview Type',
                    hidden: () => !this._selectedMaterial(),
                    property: () => [this.getSelectedVariation(), 'preview'],
                    onChange: async() => this.refreshUi(),
                    children: ['generate:sphere', 'generate:cube', 'color', 'map', 'emissive', ...Object.keys(PhysicalMaterial.MaterialProperties).filter(x => x.endsWith('Map'))].map(k => ({
                        label: k,
                        value: k,
                    })),
                },
                ...this.getSelectedVariation()?.materials.map(m => {
                    return m.uiConfig ? Object.assign(m.uiConfig, {expanded: false}) : {}
                }) || [],
                {
                    type: 'button',
                    label: 'Clear variations',
                    hidden: () => !this._selectedMaterial(),
                    value: async() => {
                        const v = this.getSelectedVariation()
                        if (v && await this._viewer!.dialog.confirm('Material configurator: Remove all variations for this material?')) v.materials = []
                        this.refreshUi()
                    },
                },
                {
                    type: 'button',
                    label: 'Remove completely',
                    hidden: () => !this._selectedMaterial(),
                    value: async() => {
                        const v = this.getSelectedVariation()
                        if (v && await this._viewer!.dialog.confirm('Material configurator: Remove this variation?')) {
                            this.removeVariation(v)
                        }
                    },
                },
                {
                    type: 'button',
                    label: 'Add Variation',
                    hidden: () => !this._selectedMaterial(),
                    value: async() => {
                        const mat = this._selectedMaterial()
                        if (!mat) return
                        if (!mat.name && !await this._viewer?.dialog.confirm('Material configurator: Material has no name. Use uuid instead?')) return
                        this.addVariation(mat)
                    },
                },
                {
                    type: 'button',
                    label: 'Refresh Ui',
                    value: () => this.refreshUi(),
                },
                {
                    type: 'button',
                    label: 'Apply All',
                    value: () => {
                        this.variations.forEach(v => this.applyVariation(v, v.materials[0].uuid))
                    },
                },
            ],
        ],
    }

    removeVariationForMaterial(material: IMaterial) {
        let variation = this.findVariation(material.uuid)
        if (!variation && material.name.length > 0) variation = this.findVariation(material.name)
        if (variation) this.removeVariation(variation)
    }
    removeVariation(variation: MaterialVariations) {
        if (!variation) return
        this.variations.splice(this.variations.indexOf(variation), 1)
        this.refreshUi()
    }
    addVariation(material?: IMaterial, variationKey?: string, cloneMaterial = true) {
        const clone = cloneMaterial && material?.clone ? material.clone() : material
        if (material && clone) {
            let variation = this.findVariation(variationKey ?? material.uuid)
            if (!variation && !variationKey && material.name.length > 0) variation = this.findVariation(material.name)
            if (!variation) {
                variation = this.createVariation(material, variationKey)
            }
            variation.materials.push(clone)
            this.refreshUi()
        }
    }

    createVariation(material: IMaterial, variationKey?: string) {
        this.variations.push({
            uuid: variationKey ?? material.name.length > 0 ? material.name : material.uuid,
            title: material.name.length > 0 ? material.name : 'No Name',
            preview: 'generate:sphere',
            materials: [],
        })
        return this.variations[this.variations.length - 1]
    }
}

export interface MaterialVariations {
    /**
     * The name or the uuid of the material in the scene
     */
    uuid: string
    /**
     * Title to show in the UI
     */
    title: string
    preview: keyof PhysicalMaterial | 'generate:sphere' | 'generate:cube' | 'generate:cylinder'
    materials: IMaterial[]
    data?: {
        icon?: string,
        [key: string]: any
    }[]
    selectedIndex?: number
}
