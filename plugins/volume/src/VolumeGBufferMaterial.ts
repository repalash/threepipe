import {
    BufferGeometry,
    Camera,
    GBufferMaterial,
    Group,
    IUniform,
    NoBlending,
    Object3D,
    Scene,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'threepipe'
import type {VolumeMaterial} from './VolumeMaterial'

// defines of the volume material that only matter for the colour
const colourDefines = ['VOL_LIGHTING', 'VOL_SHADOWS', 'VOL_AO', 'VOL_DEBUG_STEPS']

/**
 * Draws an isosurface of a {@link VolumeMaterial} into the G-buffer of `GBufferPlugin`: the depth and the normal of the
 * first crossing, and the flags of the plugins, so SSAO, outlines, depth of field and the other G-buffer effects see
 * the surface. Used by {@link VolumeObject} as its `customGBufferMaterial` in iso mode, as threepipe does for fat lines.
 *
 * It is a `GBufferMaterial` (for its flags and settings) whose shaders are the ray march of the volume material, with
 * the G-buffer output of `GBufferMaterial` at the end. It shares the uniforms of the volume material.
 *
 * @category Materials
 */
export class VolumeGBufferMaterial extends GBufferMaterial {
    readonly isVolumeGBufferMaterial = true

    constructor(readonly volumeMaterial: VolumeMaterial) {
        super(true, {blending: NoBlending, transparent: false})
        this.name = 'VolumeGBufferMaterial'
    }

    private _syncDefines() {
        const src = this.volumeMaterial.defines
        const d = this.defines as Record<string, any>
        let changed = false
        const want: Record<string, any> = {...src, VOL_GBUFFER: 1, IS_GLSL3: d.IS_GLSL3}
        for (const k of colourDefines) delete want[k]
        for (const k of Object.keys(d)) if (!(k in want)) {
            delete d[k]
            changed = true
        }
        for (const [k, v] of Object.entries(want)) if (d[k] !== v) {
            d[k] = v
            changed = true
        }
        if (changed) this.needsUpdate = true
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        // the uniforms of the march, for this target and camera
        this.volumeMaterial.onBeforeRender(renderer, scene, camera, geometry, object, group)
        this._syncDefines()
        this.side = this.volumeMaterial.side
        this.depthTest = true
        this.depthWrite = true
    }

    onBeforeCompile(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) {
        const gbFrag = shader.fragmentShader
        // the declarations and the output code of the G-buffer shader; the output code becomes volGBufferOutput, which the
        // march calls with the normal and the view space position of the surface
        const pars = (gbFrag.split('#glMarker importsEnd')[1] || '').split(/void\s+main\s*\(\s*\)/)[0]
            .replace(/varying\s+vec3\s+vViewPosition\s*;/, '')
            .replace(/uniform\s+vec2\s+cameraNearFar\s*;/, '')
        const output = (gbFrag.split('#glMarker beforeOutput')[1] || '').replace(/}\s*$/, '')
        if (!pars || !output) console.error('VolumeGBufferMaterial: the GBufferMaterial shader has changed, the isosurface is not drawn into the G-buffer')
        const fn = `\nvoid volGBufferOutput(vec3 normal, vec3 vViewPosition) {\n${output}\n}\n`
        const vm = this.volumeMaterial
        shader.vertexShader = vm.vertexShader
        shader.fragmentShader = vm.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, m => pars + fn + m)
        const u = shader.uniforms as Record<string, IUniform>
        for (const [k, v] of Object.entries(vm.uniforms as Record<string, IUniform>)) if (!(k in u)) u[k] = v
        // then the material extensions (those of the volume material too, like a custom volSample), as for any material
        super.onBeforeCompile(shader, renderer)
    }

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + 'volume'
    }
}
