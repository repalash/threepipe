import {ShaderMaterial2} from './ShaderMaterial2'
import {getTexelDecoding} from '../../three'
import {
    BufferGeometry,
    Camera,
    ColorSpace,
    IUniform,
    LinearSRGBColorSpace,
    Object3D,
    Scene,
    ShaderMaterialParameters,
    Vector2,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'three'
import {shaderReplaceString} from '../../utils'
import {IMaterialEventMap, IMaterialUserData} from '../IMaterial'

// earlier it was ShaderMaterialEncodingSupport
export class ExtendedShaderMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends ShaderMaterial2<TE & IMaterialEventMap> {
    declare ['constructor']: (typeof ExtendedShaderMaterial) & (typeof ShaderMaterial2)

    textures: {colorSpace: ColorSpace, id: string}[] = []

    declare userData: IMaterialUserData

    constructor(parameters: ShaderMaterialParameters, textureIds: string[], isRawShaderMaterial = false) {
        super(parameters, isRawShaderMaterial)
        this.setTextureIds(textureIds)
    }

    setTextureIds(ids: string[]) {
        if (this.textures.map(t=>t.id).join(';') !== ids.join(';')) {
            this.textures = ids.map(t=>({id: t, colorSpace: LinearSRGBColorSpace}))
            this.setDirty()
        }
    }

    private _setUniformTexSize(uniform?: IUniform, t?: {width: number, height: number}) {
        if (!t || !uniform) return
        const w = t?.width ?? 512
        const h = t?.height ?? 512
        const last = uniform.value
        if (!last.isVector2) console.warn('uniform is not a Vector2')
        if (last && Math.abs(last.x - w) + Math.abs(last.y - h) > 0.1) {
            last.x = w; last.y = h
            this.uniformsNeedUpdate = true
        }
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        this.uniforms.screenSize && this._setUniformTexSize(this.uniforms.screenSize, renderer.getRenderTarget() ?? renderer.getSize(new Vector2()))

        for (const item of this.textures) {
            const textureID = item.id
            const t = this.uniforms[textureID]?.value
            if (t) {
                this._setUniformTexSize(this.uniforms[textureID + 'Size'], t.image)
                if (t.colorSpace !== item.colorSpace) {
                    item.colorSpace = t.colorSpace
                    this.needsUpdate = true
                }
            }
        }

        super.onBeforeRender(renderer, scene, camera, geometry, object)
    }

    onBeforeCompile(s: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) {
        const pars = '\n' + this.textures
            .map(t=>`uniform sampler2D ${t.id}; \n`
                    + getTexelDecoding(t.id ?? 'input', t.colorSpace)).join('\n')

        if (s.fragmentShader.includes('#include <encodings_pars_fragment>')) {
            s.fragmentShader = shaderReplaceString(s.fragmentShader, '#include <encodings_pars_fragment>', pars, {append: true})
        } else if (s.fragmentShader.includes('precision highp float;')) {
            s.fragmentShader = shaderReplaceString(s.fragmentShader, 'precision highp float;', pars, {append: true})
        } else {
            s.fragmentShader = pars + s.fragmentShader
        }
        super.onBeforeCompile(s, renderer)
    }

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + this.textures.map(t=>t.id + t.colorSpace).join(';')
    }

}
