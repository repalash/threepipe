import {
    BasicDepthPacking,
    BufferGeometry,
    Camera,
    Color,
    FrontSide,
    Group,
    MeshBasicMaterial,
    NoBlending,
    Object3D,
    Scene,
    WebGLRenderer,
} from 'three'
import {IMaterial, PhysicalMaterial} from '../../core'
import {shaderReplaceString} from '../../utils'
import {MeshDepthMaterialOverride} from '../pipeline/DepthBufferPlugin'
import {MeshNormalMaterialOverride} from '../pipeline/NormalBufferPlugin'

/*
 * The materials of ViewOverridesPlugin. Each one is set as the override material of the main render pass, so it draws
 * every mesh. The unlit, material ID and UV materials copy what they need from the material of each mesh in
 * onBeforeRender and reset it in onAfterRender, like MeshDepthMaterialOverride and MeshNormalMaterialOverride.
 */

type SourceMaterial = IMaterial & Partial<PhysicalMaterial>

/** The material of a mesh (the first one of a multi-material mesh) */
function sourceMaterial(object: Object3D): SourceMaterial | undefined {
    const m = (object as Object3D & {material?: SourceMaterial | SourceMaterial[]}).material
    return Array.isArray(m) ? m[0] : m
}

/** The same material draws every mesh: make the renderer upload its uniforms again for the next one */
function resetCurrentMaterial(renderer: WebGLRenderer) {
    (renderer as WebGLRenderer & {resetCurrentMaterial?: () => void}).resetCurrentMaterial?.()
}

/** Copies the side, wireframe and alpha settings of the mesh material */
function copyCommon(target: MeshBasicMaterial, material: SourceMaterial) {
    if (material.opacity !== undefined) target.opacity = material.opacity
    if (material.transparent !== undefined) target.transparent = material.transparent
    if (material.alphaMap !== undefined) target.alphaMap = material.alphaMap
    // never 0, so the alpha test define (and the program) does not change from one mesh to the next
    if (material.alphaTest !== undefined) target.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
    if (material.alphaHash !== undefined) target.alphaHash = material.alphaHash
    if (material.side !== undefined) target.side = material.side
    if (material.wireframe !== undefined) target.wireframe = material.wireframe
    if (material.wireframeLinewidth !== undefined) target.wireframeLinewidth = material.wireframeLinewidth
}

/** A MeshBasicMaterial that takes the common settings of each mesh material before it draws it */
abstract class PerObjectBasicMaterial extends MeshBasicMaterial {
    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        const material = sourceMaterial(object)
        if (!material) return
        copyCommon(this, material)
        this._copyFrom(material, geometry)
        resetCurrentMaterial(renderer)
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    /** Takes the settings of this override from the mesh material, after the common ones */
    protected abstract _copyFrom(material: SourceMaterial, geometry: BufferGeometry): void

    /** Resets what {@link copyCommon} and {@link _copyFrom} set */
    reset() {
        this.color.setHex(0xffffff)
        this.opacity = 1
        this.transparent = false
        this.alphaMap = null
        this.alphaTest = 0
        this.alphaHash = false
        this.side = FrontSide
        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}

/** Unlit: the base color, color map, AO map and light map of each mesh, no lights */
export class UnlitOverrideMaterial extends PerObjectBasicMaterial {
    constructor() {
        super()
        this.reset()
    }

    protected _copyFrom(material: SourceMaterial) {
        if (material.color !== undefined) this.color.copy(material.color)
        // the program depends on the presence of these maps, so get it again (from the program cache) when it changes
        const maps = this._maps()
        if (material.map !== undefined) this.map = material.map
        if (material.aoMap !== undefined) this.aoMap = material.aoMap
        if (material.aoMapIntensity !== undefined) this.aoMapIntensity = material.aoMapIntensity
        if (material.lightMap !== undefined) this.lightMap = material.lightMap
        if (material.lightMapIntensity !== undefined) this.lightMapIntensity = material.lightMapIntensity
        if (maps !== this._maps()) this.needsUpdate = true
    }

    private _maps() {
        return !!this.map + ',' + !!this.aoMap + ',' + !!this.lightMap
    }

    reset() {
        super.reset()
        this.map = null
        this.aoMap = null
        this.aoMapIntensity = 1
        this.lightMap = null
        this.lightMapIntensity = 1
    }
}

/** Material ID: one flat color for each material, golden-ratio hues from the material id */
export class MaterialIdOverrideMaterial extends PerObjectBasicMaterial {
    private _colors = new Map<number, Color>()

    constructor() {
        super()
        this.reset()
    }

    /** The color of the material with this `id` */
    colorFor(id: number): Color {
        let c = this._colors.get(id)
        if (!c) {
            c = new Color().setHSL(id * 0.618033988749895 % 1, 1, 0.5)
            this._colors.set(id, c)
        }
        return c
    }

    protected _copyFrom(material: SourceMaterial) {
        this.color.copy(this.colorFor(material.id ?? 0))
    }
}

/** UV: U in red and V in green for the UV set {@link uvChannel} (0-3), magenta when the mesh has no such UV set */
export class UvOverrideMaterial extends PerObjectBasicMaterial {
    uvChannel: 0 | 1 | 2 | 3 = 0
    // set for each mesh before it draws: a missing attribute reads as 0, black, which looks like a UV value
    private _uvMissing = {value: 0}

    constructor() {
        super()
        this.reset()
    }

    customProgramCacheKey() {
        return 'view-override-uv-' + this.uvChannel
    }

    onBeforeCompile(shader: any) {
        shader.defines = shader.defines ?? {}
        shader.defines.USE_UV = ''
        shader.uniforms.uvMissing = this._uvMissing
        // declares the uv1-uv3 attributes and defines USE_UV1-USE_UV3 (three's program parameters)
        shader.vertexUv1s = true
        shader.vertexUv2s = true
        shader.vertexUv3s = true
        const varyings = `
#ifdef USE_UV1
    varying vec2 vUv1;
#endif
#ifdef USE_UV2
    varying vec2 vUv2;
#endif
#ifdef USE_UV3
    varying vec2 vUv3;
#endif
`
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <common>', varyings, {append: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_vertex>', `
#ifdef USE_UV1
    vUv1 = uv1;
#endif
#ifdef USE_UV2
    vUv2 = uv2;
#endif
#ifdef USE_UV3
    vUv3 = uv3;
#endif
`, {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'uniform float opacity;', '\nuniform float uvMissing;\n#define vUv0 vUv\n' + varyings, {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>', `
    gl_FragColor = uvMissing > 0.5 ? vec4( 1.0, 0.0, 1.0, diffuseColor.a ) : vec4( fract(vUv${this.uvChannel}.x), fract(vUv${this.uvChannel}.y), 0.0, diffuseColor.a );
`)
    }

    protected _copyFrom(_: SourceMaterial, geometry: BufferGeometry) {
        this._uvMissing.value = geometry.attributes[this.uvChannel ? 'uv' + this.uvChannel : 'uv'] ? 0 : 1
    }
}

/**
 * three's MeshNormalMaterial and MeshDepthMaterial write gl_FragColor without the output encoding. threepipe renders
 * to an RGBM target by default (`rgbm: true`), so their raw values decode as very bright colors and the meshes show
 * white. Add the encoding at the end of main(), as the other built-in materials do.
 */
function encodeOutput(shader: any) {
    shader.fragmentShader = shaderReplaceString(shader.fragmentShader, /}\s*$/, '\n#include <colorspace_fragment>\n}\n')
}

/** View-space normals */
export class NormalOverrideMaterial extends MeshNormalMaterialOverride {
    constructor() {
        super({blending: NoBlending})
    }

    customProgramCacheKey() {
        return 'view-override-normal'
    }

    onBeforeCompile(shader: any) {
        encodeOutput(shader)
    }
}

/**
 * World-space normals: the view-space normal of the normal view (after skinning, morphs, the normal matrix, the back
 * face flip and the normal and bump maps) turned to world space with the view matrix
 */
export class NormalWorldOverrideMaterial extends NormalOverrideMaterial {
    customProgramCacheKey() {
        return 'view-override-normal-world'
    }

    onBeforeCompile(shader: any) {
        super.onBeforeCompile(shader)
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );',
            'gl_FragColor = vec4( packNormalToRGB( normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ) ), diffuseColor.a );')
    }
}

/**
 * Depth: linear view depth from {@link depthNear} (white) to {@link depthFar} (black). A linear range in the shader
 * does not change the camera (threepipe cameras set their near and far planes themselves with autoNearFar).
 */
export class LinearDepthOverrideMaterial extends MeshDepthMaterialOverride {
    readonly depthNear = {value: 0.1}
    readonly depthFar = {value: 100}

    constructor() {
        super({depthPacking: BasicDepthPacking, blending: NoBlending})
    }

    customProgramCacheKey() {
        return 'view-override-linear-depth'
    }

    onBeforeCompile(shader: any) {
        shader.uniforms.depthNear = this.depthNear
        shader.uniforms.depthFar = this.depthFar
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <common>', '\nvarying float vViewOverrideZ;', {append: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <project_vertex>', '\nvViewOverrideZ = -mvPosition.z;', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'varying vec2 vHighPrecisionZW;',
            '\nvarying float vViewOverrideZ;\nuniform float depthNear;\nuniform float depthFar;', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;',
            'float fragCoordZ = clamp((vViewOverrideZ - depthNear) / max(depthFar - depthNear, 1e-6), 0., 1.);')
        encodeOutput(shader)
    }
}
