import type {IMaterial, IMaterialParameters, IObject3D, PhysicalMaterial} from '../../core'
import {
    BufferGeometry,
    Camera,
    DoubleSide,
    GLSL1,
    GLSL3,
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

    flagUpdaters: Map<string, GBufferUpdater['updateGBufferFlags']> = new Map()
    normalMapType: NormalMapTypes = TangentSpaceNormalMap
    flatShading = false

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

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

        if (isOverridden) {
            updateMaterialDefines({
                ['FORCED_LINEAR_DEPTH']: material.userData.forcedLinearDepth ?? undefined, // todo add to DepthBufferPlugin as well.
            }, material)
        } else {
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

            setMap('map')

            if (material.side !== undefined) this.side = material.side ?? DoubleSide
            setMap('alphaMap')
            if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
            if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

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
                // ['USE_ALPHAMAP']: this.uniforms.alphaMap.value ? 1 : undefined,
                ['ALPHAMAP_UV']: this.uniforms.alphaMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
                ['USE_DISPLACEMENTMAP']: this.uniforms.displacementMap.value ? 1 : undefined,
                ['DISPLACEMENTMAP_UV']: this.uniforms.displacementMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
                ['ALPHA_I_RGBA_PACKING']: material.userData.ALPHA_I_RGBA_PACKING ? 1 : undefined,
                ['FORCED_LINEAR_DEPTH']: material.userData.forcedLinearDepth ?? undefined, // todo add to DepthBufferPlugin as well.
            }, material)
        }

        this.updateFlagsUniform(material, renderer, scene, camera, geometry, object)

        this.uniformsNeedUpdate = true

        // todo: do the same in DepthBufferPlugin and NormalBufferPlugin
        // what about the material extension settings in the userData of the source materials?
        if (material.materialExtensions?.length) {
            this.registerMaterialExtensions(material.materialExtensions)
        }

        // this.transparent = true
        this.needsUpdate = true

    }

    updateFlagsUniform(material: IMaterial & Partial<PhysicalMaterial>, renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        /*
         GBuffer Flags has the following data
         1st Rendertarget has Depth and Normal buffers
         2nd Render Target::
          x : Empty
          y : first 3 bits lut index, second 5 bits bevel radius
          z : material id (userData.gBufferData?.materialId, userData.matId)
          w : this field is for setting bits - lutEnable-0, tonemap-1, bloom-2, ssao(cast)-3, dof-4, diamondMask-5
        */

        this.uniforms.flags.value.set(255, 255, 255, 255)

        const materialId = material.userData.gBufferData?.materialId ?? material.userData.matId // matId for backward compatibility
        this.uniforms.flags.value.z = materialId || 0

        this.flagUpdaters.forEach((updater) => updater(this.uniforms.flags.value, {
            material,
            renderer,
            scene,
            camera,
            geometry,
            object,
        }))

        this.uniforms.flags.value.x /= 255
        this.uniforms.flags.value.y /= 255
        this.uniforms.flags.value.z /= 255
        this.uniforms.flags.value.w /= 255
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onAfterRender(renderer, scene, camera, geometry, object)

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
