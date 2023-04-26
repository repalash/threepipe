import {ShaderMaterial2} from './ShaderMaterial2'
import {getTexelDecoding2} from '../../three/utils/encoding'
import {
    BufferGeometry,
    Camera,
    ColorSpace,
    IUniform,
    LinearSRGBColorSpace,
    Object3D,
    Scene,
    Shader,
    ShaderMaterialParameters,
    Texture,
    WebGLRenderer,
} from 'three'

export class ExtendedShaderMaterial extends ShaderMaterial2 {
    declare ['constructor']: (typeof ExtendedShaderMaterial) & (typeof ShaderMaterial2)

    textures: {colorSpace: ColorSpace, id: string}[] = []

    constructor(parameters: ShaderMaterialParameters, textureIds: string[]) {
        super(parameters)
        this.setTextureIds(textureIds)
    }

    setTextureIds(ids: string[]) {
        if (this.textures.map(t=>t.id).join(';') !== ids.join(';')) {
            this.textures = ids.map(t=>({id: t, colorSpace: LinearSRGBColorSpace}))
            this.setDirty()
        }
    }

    private _setUniformTexSize(uniform?: IUniform, t?: Texture) {
        if (!t || !uniform) return
        const w = t.image?.width ?? 512
        const h = t.image?.height ?? 512
        const last = uniform.value
        if (!last.isVector2) console.warn('uniform is not a Vector2')
        if (last && Math.abs(last.x - w) + Math.abs(last.y - h) > 0.1) {
            last.x = w; last.y = h
            this.uniformsNeedUpdate = true
        }
    }
    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        this._setUniformTexSize(this.uniforms.screenSize, renderer.getRenderTarget()?.texture)

        for (const item of this.textures) {
            const textureID = item.id
            const t = this.uniforms[textureID]?.value
            if (t) {
                this._setUniformTexSize(this.uniforms[textureID + 'Size'], t)
                if (t.colorSpace !== item.colorSpace) {
                    item.colorSpace = t.colorSpace
                    this.needsUpdate = true
                }
            }
        }

        super.onBeforeRender(renderer, scene, camera, geometry, object)
    }

    onBeforeCompile(s: Shader, renderer: WebGLRenderer) {
        s.fragmentShader = this.textures
            .map(t=>`uniform sampler2D ${t.id}; \n`
                    + getTexelDecoding2(t.id ?? 'input', t.colorSpace ?? LinearSRGBColorSpace)).join('\n')
            + s.fragmentShader
        super.onBeforeCompile(s, renderer)
    }

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + this.textures.map(t=>t.id + t.colorSpace).join(';')
    }

}
