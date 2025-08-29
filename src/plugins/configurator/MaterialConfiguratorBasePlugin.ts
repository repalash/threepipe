import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from '../interaction/PickingPlugin'
import {escapeRegExp, getOrCall, imageBitmapToBase64, makeColorSvgCircle, serialize} from 'ts-browser-helpers'
import {UiObjectConfig} from 'uiconfig.js'
import {IMaterial, IObject3D, PhysicalMaterial} from '../../core'
import {MaterialPreviewGenerator} from '../../three'
import {Color} from 'three'
import {AnimationResult, PopmotionPlugin} from '../animation/PopmotionPlugin'
import {FrameFadePlugin} from '../pipeline/FrameFadePlugin'
import {AnimateTime} from '../../utils'

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
export class MaterialConfiguratorBasePlugin extends AViewerPluginSync<{'refreshUi': object} & AViewerPluginEventMap> {
    enabled = true
    public static PluginType = 'MaterialConfiguratorPlugin'
    private _picking: PickingPlugin | undefined
    protected _previewGenerator: MaterialPreviewGenerator | undefined
    private _uiNeedRefresh = false

    constructor() {
        super()
        this.addEventListener('deserialize', this.refreshUi)
        this.refreshUi = this.refreshUi.bind(this)
        this._preFrame = this._preFrame.bind(this)
        this._refreshUi = this._refreshUi.bind(this)
        this._refreshUiConfig = this._refreshUiConfig.bind(this)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        viewer.forPlugin(PickingPlugin, (p)=>{
            this._picking = p
            this._picking?.addEventListener('selectedObjectChanged', this._refreshUiConfig)
        }, ()=>{
            this._picking?.removeEventListener('selectedObjectChanged', this._refreshUiConfig)
            this._picking = undefined
        }, this)
        this._previewGenerator = new MaterialPreviewGenerator()
        viewer.addEventListener('preFrame', this._refreshUi)
        viewer.addEventListener('preFrame', this._preFrame)
    }

    /**
     * Apply all variations(by selected index or first item) when a config is loaded
     */
    @serialize()
        applyOnLoad = true

    applyOnLoadForce = false

    /**
     * Reapply all selected variations again.
     * Useful when a model or config is loaded or changed and the variations are not applied in the model.
     * It is automatically called when the config is loaded if `applyOnLoad` is true.
     */
    reapplyAll() {
        this.variations.forEach(async v => {
            if (v.selectedIndex === undefined) return // nothing selected
            this.applyVariation(v, v.selectedIndex)
        })
    }

    fromJSON(data: any, meta?: any): this | Promise<this | null> | null {
        this.variations = []
        if (!super.fromJSON(data, meta)) return null // it's not a promise
        if (this.applyOnLoadForce && data.applyOnLoad !== false ||
            data.applyOnLoad !== undefined && this.applyOnLoad) {
            this.reapplyAll()
        }
        return this
    }

    onRemove(viewer: ThreeViewer) {
        this._previewGenerator?.dispose()
        this._previewGenerator = undefined

        this._picking?.removeEventListener('selectedObjectChanged', this._refreshUiConfig)
        this.removeEventListener('deserialize', this.refreshUi)
        viewer.removeEventListener('preFrame', this._refreshUi)
        viewer.removeEventListener('preFrame', this._preFrame)

        this._picking = undefined

        return super.onRemove(viewer)
    }

    findVariation(mapping?: string): MaterialVariations|undefined {
        return mapping ? this.variations.find(v => {
            if (v.regex ?? true) return mapping.match(typeof v.uuid === 'string' ? '^' + v.uuid + '$' : v.uuid) !== null
            else return v.uuid === mapping
        }) : undefined
    }

    getSelectedVariation(): MaterialVariations|undefined {
        const selected = this._selectedMaterial()
        if (!selected) return undefined
        const v = this.findVariation(selected.uuid) || this.findVariation(selected.name)
        if (v && v.regex === undefined) v.regex = true // required for tweakpane and old files, it cannot be undefined
        return v
    }

    /**
     * Apply a material variation based on index or uuid.
     * @param variations
     * @param matUuidOrIndex
     * @param setSelectedIndex - default true, to be used with animation
     * @param time - optional data to animate(lerp) from current value to the target material.
     */
    applyVariation(variations: MaterialVariations, matUuidOrIndex: string|number, setSelectedIndex?: boolean, time?: AnimateTime & {from?: string | number}): boolean {
        const m = this._viewer?.materialManager
        if (!m) return false
        const material = this.findMaterialVariation(matUuidOrIndex, variations)
        if (!material) return false
        setSelectedIndex && (variations.selectedIndex = variations.materials.indexOf(material))

        const fromMaterial = time?.from !== undefined ? this.findMaterialVariation(time.from, variations) : undefined
        return m.applyMaterial(material, variations.uuid, variations.regex ?? true, time?.from !== undefined ? {...time, from: fromMaterial} : (time as AnimateTime))
    }

    findMaterialVariation(matUuidOrIndex: string | number, variations: MaterialVariations) {
        return typeof matUuidOrIndex === 'string' ?
            variations.materials.find(m1 => m1.uuid === matUuidOrIndex) :
            variations.materials[matUuidOrIndex]
    }

    async applyVariationAnimate(variations: MaterialVariations, matUuidOrIndex: string|number, duration = 500): Promise<void> {
        if (variations._animation) {
            variations._animation.stop()
        }
        const popmotion = this._viewer?.getPlugin(PopmotionPlugin)
        if (!popmotion) {
            throw new Error('MaterialConfiguratorBasePlugin - PopmotionPlugin is required for animation, please add it to the viewer.')
        }
        this._viewer?.getPlugin(FrameFadePlugin)?.disable(MaterialConfiguratorBasePlugin.PluginType)
        const anim = popmotion.animateNumber({
            duration,
            onUpdate: (v, dv) => {
                this.applyVariation(variations, matUuidOrIndex, true, {t: v, dt: dv})
            },
            onComplete: () => {
                this.applyVariation(variations, matUuidOrIndex, true, {t: 1, dt: 0})
            },
            onEnd: ()=>{
                if (variations._animation !== anim) return
                variations._animation = undefined
            },
        })
        variations._animation = anim
        await variations._animation?.promise
        this._viewer?.getPlugin(FrameFadePlugin)?.enable(MaterialConfiguratorBasePlugin.PluginType)
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
        if (this.isDisabled() || !this._viewer || getOrCall(this.uiConfig.hidden)) return
        this.dispatchEvent({type: 'refreshUi'})
        this._uiNeedRefresh = true
    }

    private _refreshUiConfig() {
        if (this.isDisabled()) return
        this.uiConfig.uiRefresh?.(true, 'postFrame', 500) // don't call this.refreshUi here
    }

    // must be called from preFrame
    protected async _refreshUi(): Promise<boolean> {
        if (this.isDisabled()) return false
        if (!this._viewer || !this._uiNeedRefresh) return false
        this._uiNeedRefresh = false
        this._refreshUiConfig()
        return true
    }

    protected _preFrame() {
        if (this.isDisabled()) return false
        if (!this._viewer?.timeline.shouldRun() || !this.variations.length) return false
        const time = this._viewer?.timeline.time
        const delta = this._viewer?.timeline.delta || 0
        const looping = this._viewer?.timeline.resetOnEnd ?? false

        let applied = false
        for (const variation of this.variations) {
            if (!variation.timeline?.length) continue
            const selected = variation.selectedIndex
            const sortedTimeline = variation.timeline
                .sort((a, b) => -a.time + b.time)
            const selectedTime = sortedTimeline.find(t => t.time <= time)
            const selectedItemI = selectedTime ? sortedTimeline.indexOf(selectedTime) : -1
            const previousTime =
                selectedItemI < sortedTimeline.length - 1 && selectedItemI >= 0 ?
                    sortedTimeline[selectedItemI + 1] : // next item is the previous item because of sorting.
                    looping && selectedItemI > 0 ? sortedTimeline[0] : undefined
            const isSeeking = !this._viewer?.timeline.running

            if (selectedTime) {
                const notSelected = typeof selected === 'undefined' ||
                    selectedTime.index !== selected && (typeof selected !== 'number' || selectedTime.index !== variation.materials[selected]?.uuid)
                if (isSeeking || notSelected) {
                    const start = selectedTime.time

                    const duration = selectedTime.duration ?? 0.5

                    let t = duration < 1e-6 ? 1 : (time - start) / duration
                    let dt = duration < 1e-6 ? 0 : delta / duration

                    // if (t <= 1 || isSeeking) { // seeking if not running
                    if (t > 1) {
                        t = 1
                    }
                    if (dt < 1e-6)
                        dt = 1.0 / 60
                    // dt = 1. - t // if delta is too small, we can assume we are at the end of the timeline (like when dragging) (dragging uses from value now)
                    // dt = (1. - t) / 2
                    // console.log(selectedItemI, previousTime?.index, t, dt)
                    this.applyVariation(variation, selectedTime.index, t >= 1. - 0.00001, {
                        t, dt,
                        from: isSeeking ? previousTime?.index : undefined,
                        rm: this._viewer?.renderManager,
                    })
                    applied = true
                    // }
                }
            }
        }

        return applied
    }


    @serialize()
        variations: MaterialVariations[] = []

    private _selectedMaterial = () => {
        const selected = this._picking?.getSelectedObject()
        if (!selected) return undefined
        if ((selected as IMaterial).isMaterial) return selected as IMaterial
        else {
            const mat = ((selected as IObject3D)?.material || undefined) as IMaterial | undefined
            if (Array.isArray(mat)) return mat[0]
            return mat
        }
    }

    protected _uicShowAllVariations = false

    createVariationsUiConfig(v?: MaterialVariations) {
        // if(!v) v = this.getSelectedVariation()
        if (!v) return undefined
        return {
            type: 'folder',
            label: v.title,
            uuid: v.uuid,
            children: [
                {
                    type: 'input',
                    label: 'mapping',
                    property: () => [v, 'uuid'],
                    onChange: async() => this.refreshUi(),
                },
                {
                    type: 'input',
                    label: 'title',
                    property: () => [v, 'title'],
                    onChange: async() => this.refreshUi(),
                },
                {
                    type: 'dropdown',
                    label: 'Preview Type',
                    property: () => [v, 'preview'],
                    onChange: async() => this.refreshUi(),
                    children: ['generate:sphere', 'generate:cube', 'color', 'map', 'emissive', ...Object.keys(PhysicalMaterial.MaterialProperties).filter(x => x.endsWith('Map'))].map(k => ({
                        label: k,
                        value: k,
                    })),
                },
                {
                    type: 'checkbox',
                    label: 'regex mapping',
                    // hidden: () => !this._selectedMaterial()/* || this.getSelectedVariation()?.uuid.match(/[.*+?[\](){}^$|\\]/) === null*/,
                    property: () => [v, 'regex'],
                    onChange: async() => this.refreshUi(),
                },

                ...v.materials.map(m => {
                    return m.uiConfig ? Object.assign(m.uiConfig, {expanded: false}) : {}
                }),
            ],
        }
    }

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
                this.createVariationsUiConfig(this.getSelectedVariation()) ?? (this._uicShowAllVariations ? {} : {
                    type: 'button',
                    label: 'Select a material to see or add variations',
                    readOnly: true,
                }),
                this._uicShowAllVariations && !this._selectedMaterial() ? this.variations.map(v => this.createVariationsUiConfig(v)) : [],
                {
                    type: 'button',
                    label: 'Clear variations',
                    hidden: () => !this.getSelectedVariation(),
                    value: async() => {
                        const v = this.getSelectedVariation()
                        if (v && await this._viewer!.dialog.confirm('Material configurator: Remove all variations for this material?')) v.materials = []
                        this.refreshUi()
                    },
                },
                {
                    type: 'button',
                    label: 'Remove completely',
                    hidden: () => !this.getSelectedVariation(),
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
                {
                    type: 'checkbox',
                    label: 'Show All',
                    hidden: () => this._selectedMaterial(),
                    property: () => [this, '_uicShowAllVariations'],
                    onChange: async() => this.uiConfig?.uiRefresh?.(),
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
            uuid: variationKey ?? material.name.length > 0 ? escapeRegExp(material.name) : material.uuid,
            title: material.name.length > 0 ? material.name : 'No Name',
            preview: 'generate:sphere',
            materials: [],
            regex: true,
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
    /**
     * Whether to use regex to match the material name.
     * @default true
     */
    regex?: boolean
    selectedIndex?: number | string
    /**
     * Keyframes for the viewer timeline animation
     */
    timeline?: {
        time: number,
        index: number|string,
        duration?: number,
    }[]

    _animation?: AnimationResult
}
