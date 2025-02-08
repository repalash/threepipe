import {Color, Material, Texture, WebGLMultipleRenderTargets, WebGLRenderTarget} from 'three'
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js'
import {IPassID, IPipelinePass} from './Pass'
import {ICamera, IMaterial, IRenderManager, IScene, IWebGLRenderer, PhysicalMaterial} from '../core'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {getOrCall, ValOrFunc} from 'ts-browser-helpers'

@uiFolderContainer<GBufferRenderPass>((c)=>c.passId + ' Render Pass')
export class GBufferRenderPass<TP extends IPassID=IPassID, T extends WebGLMultipleRenderTargets | WebGLRenderTarget|undefined=WebGLMultipleRenderTargets | WebGLRenderTarget> extends RenderPass implements IPipelinePass<TP> { // todo: extend from jittered?
    readonly isGBufferRenderPass = true
    uiConfig: UiObjectConfig

    @uiToggle('Enabled') enabled = true

    declare scene?: IScene
    before?: IPassID[]
    after?: IPassID[]
    required?: IPassID[]

    constructor(public readonly passId: TP, public target: ValOrFunc<T>, material: Material, clearColor: Color = new Color(1, 1, 1), clearAlpha = 1) {
        super(undefined, undefined, material, clearColor, clearAlpha)
    }

    private _transparentMats = new Set<IMaterial>()
    private _transmissiveMats = new Set<[IMaterial, number]>()

    preprocessMaterial = (material: IMaterial, renderToGBuffer?: boolean) => {
        renderToGBuffer = renderToGBuffer ?? material.userData.renderToGBuffer
        if (material.userData.pluginsDisabled) renderToGBuffer = false
        if (
            material.transparent && (renderToGBuffer || material.opacity > 0.99 && !material.map && !material.alphaMap) || // transparent and render to gbuffer
            !material.transparent && !material.transmission && renderToGBuffer === false // opaque and dont render to gbuffer
        ) {
            this._transparentMats.add(material)
            material.transparent = !material.transparent
            // material.needsUpdate = true
        }
        if (
            material.transmission &&
            Math.abs(material.transmission || 0) > 0 && renderToGBuffer // transmission and render to gbuffer
        ) {
            this._transmissiveMats.add([material, material.transmission])
            material.transmission = 0
            // material.needsUpdate = true
        }
    }

    /**
     * Renders to {@link target}
     * @param renderer
     * @param _ - this is ignored
     * @param _1 - this is ignored
     * @param deltaTime
     * @param maskActive
     */
    render(renderer: IWebGLRenderer, _?: WebGLRenderTarget<Texture|Texture[]>|null, _1?: WebGLRenderTarget<Texture|Texture[]>, deltaTime?: number, maskActive?: boolean) {
        if (!this.scene || !this.camera) return

        const t = renderer.getRenderTarget()
        const activeCubeFace = renderer.getActiveCubeFace()
        const activeMipLevel = renderer.getActiveMipmapLevel()

        this.scene.traverse(({material}) => {
            if (!material) return
            if (Array.isArray(material)) material.forEach((m)=>this.preprocessMaterial(m))
            else this.preprocessMaterial(material)
        })

        // todo; copy double sided, check with post processing

        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: false,
            transmissionRender: false,
            mainRenderPass: false,
        }, ()=> super.render(renderer, null, getOrCall(this.target), deltaTime as any, maskActive as any)) // here this.target is the write-buffer, variable writeBuffer is ignored

        this._transparentMats.forEach(m => m.transparent = !m.transparent)
        this._transparentMats.clear()

        this._transmissiveMats.forEach(([m, tr]: [PhysicalMaterial, number]) => m.transmission = tr)
        this._transmissiveMats.clear()

        renderer.setRenderTarget(t, activeCubeFace, activeMipLevel)
    }

    beforeRender(scene: IScene, camera: ICamera, _: IRenderManager): void {
        this.scene = scene
        this.camera = camera
    }

}
