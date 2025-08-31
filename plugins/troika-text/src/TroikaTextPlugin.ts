import {
    AViewerPluginEventMap,
    AViewerPluginSync, DepthBufferPlugin, DoubleSide, GBufferPlugin, IMaterial, IObject3D, iObjectCommons,
    IObjectExtension, Mesh, Object3D2,
    Object3DGeneratorPlugin, PhysicalMaterial, PlaneGeometry,
    ThreeViewer, UiObjectConfig,
} from 'threepipe'
import {configureTextBuilder, createTextDerivedMaterial, Text} from 'troika-three-text'

/**
 * Event type map for the TroikaTextPlugin
 */
export type TroikaTextPluginEventMap = AViewerPluginEventMap

/**
 * Plugin that adds support for [troika text](https://protectwise.github.io/troika/troika-three-text/) objects.
 * The plugin extends troika Text with uiconfig, g-buffer and serialization support.
 * It also adds a generator to the Object3DGeneratorPlugin to create text objects from the UI.
 */
export class TroikaTextPlugin extends AViewerPluginSync<TroikaTextPluginEventMap> {
    public static readonly PluginType = 'TroikaTextPlugin'
    enabled = true

    constructor(useWorker = true) {
        super()
        this.createText = this.createText.bind(this)
        if (!useWorker) {
            configureTextBuilder({
                useWorker: false,
                // todo other options
            })
        }
    }

    dependencies = [Object3DGeneratorPlugin]

    createText(params?: any) {
        const textWrapper = new Object3D2()
        textWrapper.name = 'troika-text-plane'
        textWrapper.userData.textParams = {
            anchorX: 'center',
            anchorY: 'middle',
            fontSize: 1,
            text: 'Troika Text',
            ...params,
        }
        textWrapper.userData.userSelectable = true
        this.setupTextWrapper(textWrapper)
        return textWrapper
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.registerObjectExtension(this._objectExtension)

        viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', (plugin)=>{
            plugin.addObject3DGenerator('troika-text-plane', this.createText)
        }, (plugin)=>{
            plugin.removeObject3DGenerator('troika-text-plane')
        }, this)

    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))
        viewer.object3dManager.unregisterObjectExtension(this._objectExtension)

        super.onRemove(viewer)
    }

    setupTextWrapper(textWrapper: IObject3D, material?: IMaterial|IMaterial[]) {
        const text: IObject3D & Text = this.createTextChild(material)
        textWrapper.add(text)
        this.updateText(textWrapper)

        const dummyMesh = new Mesh(new PlaneGeometry(1, 1, 1, 1), material!)
        dummyMesh.userData.isTextDummyMesh = true
        dummyMesh.userData.userSelectable = true
        textWrapper._sChildren = [dummyMesh] // so that it's children are not saved in the gltf exporter.

        text.addEventListener('materialChanged', () => {
            if (text.material) dummyMesh.material = text.material
        })
        textWrapper.addEventListener('dispose', () => {
            text.dispose()
        })
        // todo handle clone, dispose text on remove

    }

    updateText(textWrapper: IObject3D, params?: any) {
        const text = textWrapper.children[0] as any /* as Text*/
        if (!text || typeof text.sync !== 'function') return
        if (!textWrapper.userData.textParams) {
            return this.createText(params)
        }
        if (params) Object.assign(textWrapper.userData.textParams, params)
        params = {
            text: 'No Text',
            // color: 0xFF00FF,
            fontSize: 1,
            // anchorX: 'center',
            // anchorY: 'middle',
            // font: 'https://raw.githubusercontent.com/pmndrs/assets/refs/heads/main/src/fonts/inter_bold.woff',
            ...textWrapper.userData.textParams,
        }
        if (params.text !== undefined) text.text = params.text
        if (params.fontSize !== undefined) text.fontSize = params.fontSize
        if (params.colorRanges !== undefined) text.colorRanges = params.colorRanges
        // if (params.color) text.color = params.color
        if (params.font !== undefined) text.font = params.font
        if (params.fontStyle) text.fontStyle = params.fontStyle
        if (params.fontWeight) text.fontWeight = params.fontWeight
        if (params.lang !== undefined) text.lang = params.lang
        if (params.letterSpacing !== undefined) text.letterSpacing = params.letterSpacing
        if (params.lineHeight) text.lineHeight = params.lineHeight
        if (params.maxWidth !== undefined) text.maxWidth = params.maxWidth
        if (params.overflowWrap) text.overflowWrap = params.overflowWrap
        if (params.direction) text.direction = params.direction
        if (params.textAlign) text.textAlign = params.textAlign
        if (params.textIndent !== undefined) text.textIndent = params.textIndent
        if (params.whiteSpace) text.whiteSpace = params.whiteSpace
        if (params.sdfGlyphSize !== undefined) text.sdfGlyphSize = params.sdfGlyphSize
        if (params.glyphGeometryDetail !== undefined) text.glyphGeometryDetail = params.glyphGeometryDetail
        if (params.orientation) text.orientation = params.orientation
        if (params.anchorX) text.anchorX = params.anchorX
        if (params.anchorY) text.anchorY = params.anchorY
        if (params.curveRadius !== undefined) text.curveRadius = params.curveRadius
        // if (params.material) text.material.setValues(params.material)
        // todo outline etc
        text.sync()
        textWrapper.setDirty()
        return textWrapper
    }

    createTextChild(material?: IMaterial|IMaterial[]) {
        const text = new Text()
        text.material = material || new PhysicalMaterial({
            side: DoubleSide,
            userData: {renderToGBuffer: true, renderToDepth: true},
            // emissive: 0xffffff,
            // emissiveIntensity: 8,
            transparent: true,
        })
        text.castShadow = true
        text.receiveShadow = true
        text.userData.userSelectable = false
        iObjectCommons.upgradeObject3D.call(text)

        // todo only create materials when getter is called
        const depthBufferPlugin = this._viewer?.getPlugin(DepthBufferPlugin)
        if (depthBufferPlugin) text.customDepthMaterial.depthPacking = depthBufferPlugin.depthPacking

        const gbufferPlugin = this._viewer?.getPlugin(GBufferPlugin)
        if (gbufferPlugin) {
            text.customGBufferMaterial = createTextDerivedMaterial(gbufferPlugin.createMaterial())
            text.customGBufferMaterial.transparent = false
        }

        // Update the rendering:
        text.sync(async() => {
            text.parent?.setDirty()
            // we need to render once as onBeforeRender has to be called once to set the depth material?
            this._viewer?.doOnce('postRender', ()=>{
                this._viewer?.renderManager.resetShadows()
                text.parent?.setDirty()
            })
            text.addEventListener('synccomplete', async() => {
                this._viewer?.renderManager.resetShadows() // todo only if geometry has changed?
                text.parent?.setDirty()
            })
        })
        return text
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj?.userData?.textParams) return
        const child = obj.children[0]
        if (!child) return
        if (child.userData.isTextDummyMesh) {
            const material = child.material
            child.dispose()
            child.removeFromParent()
            this.setupTextWrapper(obj, material)
        }
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj?.userData?.textParams) return
        const child = obj.children[0]
        if (!child) return
        // todo dispose the geometry and set the dummy material? it will be recreated on add
        child.dispose && child.dispose()
    }


    private _objectExtension: IObjectExtension = {
        uuid: 'TroikaTextPluginUiExt',
        isCompatible: object => object.userData?.textParams !== undefined,
        getUiConfig: (object): UiObjectConfig[]|undefined => {
            if (!object.userData?.textParams) return undefined
            return [...([{
                type: 'textarea',
                label: 'Text',
                rows: 4,
                property: [object.userData.textParams, 'text'],
            }, {
                type: 'number',
                label: 'Font Size',
                property: [object.userData.textParams, 'fontSize'],
                bounds: [0.001, 10000],
            }, {
                type: 'input',
                label: 'Font URL',
                getValue: ()=>object.userData.textParams?.font || '',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.font = v),
            }, {
                type: 'dropdown',
                label: 'Font Style',
                getValue: ()=>object.userData.textParams?.fontStyle || 'normal',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.fontStyle = v),
                children: [
                    {label: 'Normal', value: 'normal'},
                    {label: 'Italic', value: 'italic'},
                ],
            }, {
                type: 'dropdown',
                label: 'Font Weight',
                getValue: ()=>object.userData.textParams?.fontWeight || 'normal',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.fontWeight = v),
                children: [
                    {label: 'Normal', value: 'normal'},
                    {label: 'Bold', value: 'bold'},
                ],
            }, {
                type: 'input',
                label: 'Language',
                getValue: ()=>object.userData.textParams?.lang || '',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.lang = v),
            }, {
                type: 'number',
                label: 'Letter Spacing',
                getValue: ()=>object.userData.textParams?.letterSpacing || 0,
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.letterSpacing = v),
            }, {
                type: 'string',
                label: 'Line Height',
                getValue: ()=>object.userData.textParams?.lineHeight || 'normal',
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.lineHeight = v),
            }, {
                type: 'number',
                label: 'Max Width',
                getValue: ()=>{
                    const r = object.userData.textParams?.maxWidth || 0
                    if (!isFinite(r)) return 100000 // for ui that doesnt support infinity
                    return r
                },
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.maxWidth = v),
            }, {
                type: 'dropdown',
                label: 'Overflow Wrap',
                getValue: ()=>object.userData.textParams?.overflowWrap || 'normal',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.overflowWrap = v),
                children: [
                    {label: 'Normal', value: 'normal'},
                    {label: 'Break Word', value: 'break-word'},
                ],
            }, {
                type: 'dropdown',
                label: 'Direction',
                getValue: ()=>object.userData.textParams?.direction || 'auto',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.direction = v),
                children: [
                    {label: 'Auto', value: 'auto'},
                    {label: 'LTR', value: 'ltr'},
                    {label: 'RTL', value: 'rtl'},
                ],
            }, {
                type: 'dropdown',
                label: 'Text Align',
                getValue: ()=>object.userData.textParams?.textAlign || 'left',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.textAlign = v),
                children: [
                    {label: 'Left', value: 'left'},
                    {label: 'Right', value: 'right'},
                    {label: 'Center', value: 'center'},
                    {label: 'Justify', value: 'justify'},
                ],
            }, {
                type: 'number',
                label: 'Text Indent',
                getValue: ()=>object.userData.textParams?.textIndent || 0,
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.textIndent = v),
            }, {
                type: 'dropdown',
                label: 'White Space',
                getValue: ()=>object.userData.textParams?.whiteSpace || 'normal',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.whiteSpace = v),
                children: [
                    {label: 'Normal', value: 'normal'},
                    {label: 'Nowrap', value: 'nowrap'},
                ],
            }, {
                type: 'number',
                label: 'SDF Glyph Size',
                getValue: ()=>object.userData.textParams?.sdfGlyphSize || 64,
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.sdfGlyphSize = v),
                bounds: [1, 128],
            }, {
                type: 'number',
                label: 'Glyph Geometry Detail',
                getValue: ()=>object.userData.textParams?.glyphGeometryDetail || 1,
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.glyphGeometryDetail = v),
                bounds: [1, 10],
            }, {
                type: 'input',
                label: 'Orientation',
                getValue: ()=>object.userData.textParams?.orientation || '+x+y',
                setValue: (v: string)=>object.userData.textParams && (object.userData.textParams.orientation = v),
            }, {
                type: 'dropdown',
                label: 'Anchor X',
                property: [object.userData.textParams, 'anchorX'],
                children: [
                    {label: 'Left', value: 'left'},
                    {label: 'Center', value: 'center'},
                    {label: 'Right', value: 'right'},
                ],
            }, {
                type: 'dropdown',
                label: 'Anchor Y',
                property: [object.userData.textParams, 'anchorY'],
                children: [
                    {label: 'Top', value: 'top'},
                    {label: 'Middle', value: 'middle'},
                    {label: 'Bottom', value: 'bottom'},
                ],
            }, {
                type: 'number',
                label: 'Curve Radius',
                getValue: ()=>object.userData.textParams?.curveRadius || 0,
                setValue: (v: number)=>object.userData.textParams && (object.userData.textParams.curveRadius = v),
                bounds: [0.001, 10000],
            }] as UiObjectConfig[]).map(c=>{
                c.onChange = () => this.updateText(object)
                c.tags = [...c.tags || [], 'troika-text-params']
                return c
            }), ()=>{
                const mat = object.children[0].material
                return Array.isArray(mat) ? mat.map(m=>m.uiConfig) : mat?.uiConfig
            }]
        },
    }
}
