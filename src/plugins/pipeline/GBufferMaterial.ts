import type {ICamera, IMaterial, IMaterialParameters, IObject3D, PhysicalMaterial} from '../../core'
import {
    BufferGeometry,
    Camera,
    DepthModes,
    DoubleSide,
    GLSL1,
    GLSL3, Group,
    NormalMapTypes,
    Object3D,
    Scene,
    ShaderMaterialParameters,
    TangentSpaceNormalMap,
    Texture,
    UniformsLib,
    UniformsUtils,
    Vector2,
    Vector4,
    WebGLRenderer,
} from 'three'
import GBufferMatVert from './shaders/GBufferPlugin.mat.vert.glsl'
import GBufferMatFrag from './shaders/GBufferPlugin.mat.frag.glsl'
import {updateMaterialDefines} from '../../materials'
import {ShaderMaterial2} from '../../core/material/ShaderMaterial2'

export interface GBufferUpdaterContext {
    material: IMaterial, renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D
}
export interface GBufferUpdater {
    updateGBufferFlags: (data: Vector4, context: GBufferUpdaterContext) => void
}

/**
 * Renders DepthNormal to a texture and flags to another
 */
export class GBufferMaterial extends ShaderMaterial2 {

    constructor(multipleRT = true, parameters?: ShaderMaterialParameters & IMaterialParameters) {
        super({
            vertexShader: GBufferMatVert,
            fragmentShader: GBufferMatFrag,
            uniforms: UniformsUtils.merge([
                UniformsLib.common,
                UniformsLib.bumpmap,
                UniformsLib.normalmap,
                UniformsLib.displacementmap,
                {
                    cameraNearFar: {value: new Vector2(0.1, 1000)}, // this has to be set from outside
                    flags: {value: new Vector4(255, 255, 255, 255)},
                },
            ]),
            defines: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                IS_GLSL3: multipleRT ? '1' : '0',
            },
            glslVersion: multipleRT ? GLSL3 : GLSL1,
            ...parameters,
        })
        this.reset()
    }

    readonly isGBufferMaterial = true

    flagUpdaters: Map<string, GBufferUpdater['updateGBufferFlags']> = new Map()

    /**
     * The materials whose objects this material draws with only the flags output: no depth, no normal and no depth
     * write, with the depth test of the material of the object. The objects of the other materials are drawn as usual.
     * GBufferPlugin sets it to `GBufferRenderPass.flagsOnlyMaterials`, the materials with `userData.renderToFlags`
     * that are not drawn into the GBuffer. Only with multiple render targets (`multipleRT`, WebGL2).
     */
    flagsOnlyMaterials?: Set<IMaterial>

    /** Set during a flags-only draw: the number of color attachments of the target, and the depth state to put back */
    private _flagsOnlyDraw?: {attachments: number, depthWrite: boolean, depthTest: boolean, depthFunc: DepthModes}

    normalMapType: NormalMapTypes = TangentSpaceNormalMap
    flatShading = false

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)

        let isOverridden = false

        let material = (object as any).material as IMaterial & Partial<PhysicalMaterial>
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (material === this as any) {
            material = (object as IObject3D).currentMaterial as IMaterial & Partial<PhysicalMaterial>
            isOverridden = true
        }
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (!material) return

        this._beginFlagsOnlyDraw(renderer, object, group, material)

        const setMap = (key: keyof IMaterial) => {
            const map = material[key]
            if (!map) return
            this.uniforms[key].value = map
            if (!this.uniforms[key + 'Transform']) console.error('GBufferMaterial: ' + key + 'Transform is not defined in uniform')
            else {
                if ((map as Texture).isTexture)
                    renderer.materials.refreshTransformUniform((map as Texture), this.uniforms[key + 'Transform'])
            }
        }

        // the alpha of the material, also for a GBuffer material set on the object (customGBufferMaterial): the pixels
        // that the material cuts (its map and alphaMap alpha under alphaTest) are not written, as in the render
        setMap('map')
        setMap('alphaMap')
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        // three.js sets the alphaTest uniform only for its own materials, not for a ShaderMaterial
        this.uniforms.alphaTest.value = this.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash
        // three.js compiles the map chunks only for a material with its own `map` (`alphaMap`), so they are defined here
        updateMaterialDefines({
            ['USE_MAP']: this.uniforms.map.value ? 1 : undefined,
            ['MAP_UV']: this.uniforms.map.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
            ['USE_ALPHAMAP']: this.uniforms.alphaMap.value ? 1 : undefined,
            ['ALPHAMAP_UV']: this.uniforms.alphaMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
        }, this)

        if (isOverridden) {
            updateMaterialDefines({
                ['FORCED_LINEAR_DEPTH']: material.userData.forcedLinearDepth ?? undefined, // todo add to DepthBufferPlugin as well.
            }, this)

        } else {
            if (material.side !== undefined) this.side = material.side ?? DoubleSide

            setMap('bumpMap')
            if (material.bumpScale !== undefined) this.uniforms.bumpScale.value = material.bumpScale

            setMap('normalMap')
            if (material.normalScale !== undefined) this.uniforms.normalScale.value.copy(material.normalScale)
            if (material.normalMapType !== undefined) this.normalMapType = material.normalMapType
            if (material.flatShading !== undefined) this.flatShading = material.flatShading

            setMap('displacementMap')
            if (material.displacementScale !== undefined) this.uniforms.displacementScale.value = material.displacementScale
            if (material.displacementBias !== undefined) this.uniforms.displacementBias.value = material.displacementBias

            if (material.wireframe !== undefined) this.wireframe = material.wireframe
            if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

            updateMaterialDefines({
                ['USE_DISPLACEMENTMAP']: this.uniforms.displacementMap.value ? 1 : undefined,
                ['DISPLACEMENTMAP_UV']: this.uniforms.displacementMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
                ['ALPHA_I_RGBA_PACKING']: material.userData.ALPHA_I_RGBA_PACKING ? 1 : undefined,
                ['FORCED_LINEAR_DEPTH']: material.userData.forcedLinearDepth ?? undefined, // todo add to DepthBufferPlugin as well.
            }, this)
        }

        const flags = this.uniforms.flags.value
        this._updateFlagsUniform(flags, material, renderer, scene, camera, geometry, object)

        ;(camera as ICamera).updateShaderProperties(this) // for cameraNearFar

        this.uniformsNeedUpdate = true

        // todo: do the same in DepthBufferPlugin and NormalBufferPlugin
        // what about the material extension settings in the userData of the source materials?
        // wont this be very expensive? todo we should expect devs to expose their own gbuffer material instance if they want to use some extension
        if (material.materialExtensions?.length) {
            this.registerMaterialExtensions(material.materialExtensions)
        }

        // this.transparent = true
        this.needsUpdate = true
        // @ts-expect-error todo add to type
        renderer.resetCurrentMaterial && renderer.resetCurrentMaterial()

    }

    /**
     * A flags-only draw (see {@link flagsOnlyMaterials}): the draw buffers of the target are set to the flags texture
     * (location 1) only, so the depth and normal (location 0) are not written. three.js sets all the attachments as draw
     * buffers of a target with multiple textures, {@link _endFlagsOnlyDraw} puts them back.
     */
    private _beginFlagsOnlyDraw(renderer: WebGLRenderer, object: Object3D, group: Group|null, material: IMaterial) {
        if (!this.flagsOnlyMaterials || this.glslVersion !== GLSL3) return
        // the material of the object that the pass looked at: this one for a custom GBuffer material (fat lines)
        const objectMaterial = (object as IObject3D).material
        const drawn = Array.isArray(objectMaterial) ? objectMaterial[(group as any)?.materialIndex ?? 0] : objectMaterial
        if (!drawn || !this.flagsOnlyMaterials.has(drawn)) return
        const attachments = renderer.getRenderTarget()?.textures.length ?? 1
        if (attachments < 2) return
        const gl = renderer.getContext() as WebGL2RenderingContext
        gl.drawBuffers(Array.from({length: attachments}, (_, i) => i === 1 ? gl.COLOR_ATTACHMENT1 : gl.NONE))
        this._flagsOnlyDraw = {attachments, depthWrite: this.depthWrite, depthTest: this.depthTest, depthFunc: this.depthFunc}
        this.depthWrite = false
        // the same pixels as the source material: its depth test and depth function (an x-ray overlay uses GreaterDepth)
        this.depthTest = material.depthTest
        this.depthFunc = material.depthFunc
    }

    private _endFlagsOnlyDraw(renderer: WebGLRenderer) {
        const d = this._flagsOnlyDraw
        if (!d) return
        this._flagsOnlyDraw = undefined
        const gl = renderer.getContext() as WebGL2RenderingContext
        gl.drawBuffers(Array.from({length: d.attachments}, (_, i) => gl.COLOR_ATTACHMENT0 + i))
        this.depthWrite = d.depthWrite
        this.depthTest = d.depthTest
        this.depthFunc = d.depthFunc
    }

    protected _updateFlagsUniform(flags: Vector4, material: IMaterial & Partial<PhysicalMaterial>, renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        /*
         GBuffer Flags has the following data
         1st Rendertarget has Depth and Normal buffers
         2nd Render Target::
          x : Empty
          y : first 3 bits lut index, second 5 bits bevel radius
          z : material id (userData.gBufferData?.materialId, userData.matId)
          w : this field is for setting bits - lutEnable-0, tonemap-1, bloom-2, ssao(cast)-3, dof-4, diamondMask-5
        */

        flags.set(255, 255, 255, 255)

        const materialId = material.userData.gBufferData?.materialId ?? material.userData.matId // matId for backward compatibility
        flags.z = materialId || 0

        this.flagUpdaters.forEach((updater) => updater(flags, {
            material,
            renderer,
            scene,
            camera,
            geometry,
            object,
        }))

        flags.x /= 255
        flags.y /= 255
        flags.z /= 255
        flags.w /= 255
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this._endFlagsOnlyDraw(renderer)

        let material = (object as any).material as IMaterial & Partial<PhysicalMaterial>
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (!material || material === this as any) return

        if (material.materialExtensions?.length) {
            this.unregisterMaterialExtensions(material.materialExtensions)
        }

        this.reset()
    }

    reset() {
        this.uniforms.map.value = null
        this.side = DoubleSide
        this.uniforms.alphaMap.value = null
        this.alphaTest = 0.001
        this.alphaHash = false

        this.uniforms.bumpMap.value = null
        this.uniforms.bumpScale.value = 1

        this.uniforms.normalMap.value = null
        this.uniforms.normalScale.value.set(1, 1)
        this.normalMapType = TangentSpaceNormalMap
        this.flatShading = false

        this.uniforms.displacementMap.value = null
        this.uniforms.displacementScale.value = 1
        this.uniforms.displacementBias.value = 0

        this.uniforms.flags.value.set(255, 255, 255, 255)

        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}


/**
 * @deprecated use GBufferMaterial instead
 */
export class DepthNormalMaterial extends GBufferMaterial {
    constructor(multipleRT: boolean, parameters?: ShaderMaterialParameters & IMaterialParameters) {
        super(multipleRT, parameters)
        console.warn('DepthNormalMaterial is deprecated, use GBufferMaterial instead')
    }
}
