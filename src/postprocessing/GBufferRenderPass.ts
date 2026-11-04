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

    /**
     * Draw the flags of the materials that have `userData.renderToFlags` set to `true` and are not drawn into the target
     * (like the helper widgets): only the flags output of `GBufferMaterial`, no depth and no normal, after all the
     * other objects. See `IMaterialUserData.renderToFlags`. GBufferPlugin sets it when its target has the flags
     * texture (multiple render targets, WebGL2). The other passes leave it `false`.
     */
    renderFlagsOnly = false

    /**
     * The materials whose objects write only their flags in the current render. {@link preprocessMaterial} fills it when
     * {@link renderFlagsOnly} is set, the `GBufferMaterial` reads it for each draw, and it is cleared after the render.
     */
    readonly flagsOnlyMaterials = new Set<IMaterial>()

    private _transparentMats = new Set<IMaterial>()
    private _transmissiveMats = new Set<[IMaterial, number]>()

    // todo make a global parameter in the viewer to be able to render all transparent and transmissive materials to gbuffer by default
    preprocessMaterial = (material: IMaterial, renderToGBuffer?: boolean) => {
        renderToGBuffer = renderToGBuffer ?? material.userData.renderToGBuffer
        if (material.userData.pluginsDisabled) renderToGBuffer = false
        if (
            material.transparent && (renderToGBuffer || renderToGBuffer !== false && material.opacity > 0.99 && !material.map && !material.alphaMap) || // transparent and render to gbuffer (or draws as opaque, when not set)
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
        // left out of the target, but writes its flags: drawn in the transparent pass of the render, see render. Not when
        // it is fully transparent: it adds no colour, so its pixels keep the flags of the scene behind
        if (this.renderFlagsOnly && material.userData.renderToFlags === true && !material.userData.pluginsDisabled && material.opacity > 0 &&
            (material.transparent || Math.abs(material.transmission || 0) > 0) && this._drawsWithGBufferMaterial(material)) {
            const transmission = material.transmission || 0
            if (Math.abs(transmission) > 0) {
                this._transmissiveMats.add([material, transmission])
                material.transmission = 0
            }
            if (!material.transparent) {
                this._transparentMats.add(material)
                material.transparent = true
            }
            this.flagsOnlyMaterials.add(material)
        }
    }

    /**
     * Whether a `GBufferMaterial` draws the material: the override material of the pass, or its own (like the
     * `customGBufferMaterial` of fat lines). Any other shader would write its color into the depth and normal.
     */
    private _drawsWithGBufferMaterial(material: IMaterial) {
        const m = material.allowOverride === true && this.overrideMaterial ? this.overrideMaterial as IMaterial : material
        return !!m.isGBufferMaterial
    }

    private _savedForcedMaterials = new Map<IObject3D, IObject3D['forcedOverrideMaterial']>()

    /**
     * Sets `object.forcedOverrideMaterial` for the render of this pass, and saves the one that the object had: a plugin
     * can set one for the whole frame, as ViewOverridesPlugin does for fat lines. {@link restoreObjectMaterial} puts it back.
     */
    forceObjectMaterial(object: IObject3D, material: Material) {
        if (!this._savedForcedMaterials.has(object)) this._savedForcedMaterials.set(object, object.forcedOverrideMaterial)
        object.forcedOverrideMaterial = material
    }

    /** Puts back the `forcedOverrideMaterial` that the object had before {@link forceObjectMaterial} */
    restoreObjectMaterial(object: IObject3D) {
        if (!this._savedForcedMaterials.has(object)) return
        const saved = this._savedForcedMaterials.get(object)
        this._savedForcedMaterials.delete(object)
        if (saved === undefined) delete object.forcedOverrideMaterial
        else object.forcedOverrideMaterial = saved
    }

    preprocessObject = (object: IObject3D) => {
        if (object.customDepthMaterial) {
            const mat = object.customDepthMaterial
            mat.allowOverride = false
            const current = object.material
            this.forceObjectMaterial(object, mat)
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
        this.restoreObjectMaterial(object)
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
        const materials = new Set<IMaterial>()
        // once for each material: the first call changes it (transparent, transmission), a second one on a material shared
        // by two objects would see the changed material and could undo the change
        const preprocessMaterial = (m: IMaterial) => {
            if (materials.has(m)) return
            materials.add(m)
            this.preprocessMaterial(m)
        }
        this.scene.traverse((object) => {
            if (!object.visible) return
            objects.add(object)
            const material = this.preprocessObject(object)
            if (!material) return
            if (Array.isArray(material)) material.forEach(preprocessMaterial)
            else preprocessMaterial(material)
        })

        // The flags-only materials are drawn in the transparent pass, after all the opaque objects, so they are tested
        // against the full depth and later objects do not write over their flags. The other materials that are left out
        // of the target are transparent too, and are hidden for this render.
        const flagsOnly = this.flagsOnlyMaterials.size > 0
        const hidden: IMaterial[] = []
        if (flagsOnly) materials.forEach(m => {
            if (!m.transparent || !m.visible || this.flagsOnlyMaterials.has(m)) return
            m.visible = false
            hidden.push(m)
        })

        // todo; copy double sided, check with post processing

        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: flagsOnly,
            transmissionRender: false,
            mainRenderPass: false,
        }, ()=> super.render(renderer, null, getOrCall(this.target), deltaTime as any, maskActive as any)) // here this.target is the write-buffer, variable writeBuffer is ignored

        hidden.forEach(m => m.visible = true)
        this.flagsOnlyMaterials.clear()

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
