import {Color, Material, WebGLMultipleRenderTargets, WebGLRenderTarget} from 'three'
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js'
import {IPassID, IPipelinePass} from './Pass'
import {ICamera, IMaterial, IRenderManager, IScene, IWebGLRenderer, PhysicalMaterial} from '../core'

export class GBufferRenderPass<TP extends IPassID, T extends WebGLMultipleRenderTargets | WebGLRenderTarget> extends RenderPass implements IPipelinePass<TP> { // todo: extend from jittered?
    readonly isGBufferRenderPass = true

    scene?: IScene
    before?: IPassID[]
    after?: IPassID[]
    required?: IPassID[]

    constructor(public readonly passId: TP, public target: T, material: Material, clearColor: Color = new Color(1, 1, 1), clearAlpha = 1) {
        super(undefined, undefined, material, clearColor, clearAlpha)
    }

    private _transparentMats = new Set<IMaterial>()
    private _transmissiveMats = new Set<[IMaterial, number]>()

    /**
     * Renders to {@link target}
     * @param renderer
     * @param _ - this is ignored
     * @param _1 - this is ignored
     * @param deltaTime
     * @param maskActive
     */
    render(renderer: IWebGLRenderer, _?: WebGLRenderTarget|null, _1?: WebGLRenderTarget|WebGLMultipleRenderTargets, deltaTime?: number, maskActive?: boolean) {
        if (!this.scene || !this.camera) return

        const t = renderer.getRenderTarget()
        const activeCubeFace = renderer.getActiveCubeFace()
        const activeMipLevel = renderer.getActiveMipmapLevel()

        const preprocessMaterial = (material: IMaterial) => {
            const renderToGBuffer = material.userData.renderToGBuffer === undefined ? material.userData.renderToDepth : material.userData.renderToGBuffer
            if (
                material.transparent && material.userData.renderToDepth || // transparent and render to gbuffer
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

        this.scene.traverse(({material}) => {
            if (!material) return
            if (Array.isArray(material)) material.forEach(preprocessMaterial)
            else preprocessMaterial(material)
        })

        // todo; copy double sided, check with post processing

        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: false,
            transmissionRender: false,
            mainRenderPass: false,
        }, ()=> super.render(renderer, null, this.target, deltaTime as any, maskActive as any)) // here this.target is the write-buffer, variable writeBuffer is ignored

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
