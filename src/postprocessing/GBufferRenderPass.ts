import {Color, Material, WebGLRenderTarget} from 'three'
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js'
import {IPassID, IPipelinePass} from './Pass'
import {ICamera, IMaterial, IObject3D, IRenderManager, IScene, IWebGLRenderer, PhysicalMaterial} from '../core'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {getOrCall, ValOrFunc} from 'ts-browser-helpers'

@uiFolderContainer<GBufferRenderPass>((c)=>c.passId + ' Render Pass')
export class GBufferRenderPass<TP extends IPassID=IPassID, T extends WebGLRenderTarget|undefined=WebGLRenderTarget> extends RenderPass implements IPipelinePass<TP> { // todo: extend from jittered?
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

    // todo make a global parameter in the viewer to be able to render all transparent and transmissive materials to gbuffer by default
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

    preprocessObject = (object: IObject3D) => {
        if (object.customDepthMaterial) {
            const mat = object.customDepthMaterial
            mat.allowOverride = false
            // todo save the current forcedOverrideMaterial to restore it later?
            const current = object.material
            object.forcedOverrideMaterial = mat
            const current0 = Array.isArray(current) ? current[0] : current
            if (current0) {
                mat.userData.renderToGBuffer = current0.userData.renderToGBuffer
                mat.userData.renderToDepth = current0.userData.renderToDepth
                mat.userData.pluginsDisabled = current0.userData.pluginsDisabled
                // todo other plugin userData
                mat.side = current0.side
            }
            return mat as IMaterial
        }
        return object.material
    }

    postprocessObject = (object: IObject3D) => {
        if (object.customDepthMaterial) {
            delete object.forcedOverrideMaterial
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
    render(renderer: IWebGLRenderer, _?: WebGLRenderTarget|null, _1?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        if (!this.scene || !this.camera) return

        const t = renderer.getRenderTarget()
        const activeCubeFace = renderer.getActiveCubeFace()
        const activeMipLevel = renderer.getActiveMipmapLevel()

        const objects = new Set<IObject3D>()
        this.scene.traverse((object) => {
            if (!object.visible) return
            objects.add(object)
            const material = this.preprocessObject(object)
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

        objects.forEach(o => this.postprocessObject(o))
    }

    beforeRender(scene: IScene, camera: ICamera, _: IRenderManager): void {
        this.scene = scene
        this.camera = camera
    }

}
