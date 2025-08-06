import {
    BufferGeometry,
    Camera,
    IUniform,
    Material,
    Object3D,
    Scene,
    ShaderMaterial,
    ShaderMaterialParameters,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'three'
import {IMaterial, IMaterialEventMap, IMaterialParameters, IMaterialUserData} from '../IMaterial'
import {MaterialExtension} from '../../materials'
import {iMaterialCommons} from './iMaterialCommons'
import {threeMaterialInterpolateProps, threeMaterialPropList} from './threeMaterialPropList'

export class ShaderMaterial2<TE extends IMaterialEventMap = IMaterialEventMap> extends ShaderMaterial<TE & IMaterialEventMap> implements IMaterial<TE> {
    declare ['constructor']: typeof ShaderMaterial2

    static readonly TypeSlug = 'shaderMat'
    static readonly TYPE = 'ShaderMaterial2'
    static readonly MaterialProperties = {
        ...threeMaterialPropList,
        fragmentShader: '',
        vertexShader: '',
        uniforms: {},
        defines: {},
        extensions: {},
        isRawShaderMaterial: false,
        uniformsGroups: {},
        wireframe: false,
        wireframeLinewidth: 1,
        clipping: false,
        lights: false,
        fog: false,
        glslVersion: null,
        defaultAttributeValues: {},
    }

    static readonly InterpolateProperties = [
        ...threeMaterialInterpolateProps,
        'wireframeLinewidth',
    ]

    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isAShaderMaterial = true

    readonly appliedMeshes: Set<any> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(track = false): this {return iMaterialCommons.clone(super.clone).call(this, track)}

    readonly isRawShaderMaterial: boolean

    type: 'ShaderMaterial' | 'RawShaderMaterial' = 'ShaderMaterial'

    constructor({customMaterialExtensions, ...parameters}: ShaderMaterialParameters & IMaterialParameters = {}, isRawShaderMaterial = false) {
        super()
        this.isRawShaderMaterial = isRawShaderMaterial
        if (isRawShaderMaterial) {
            this.type = 'RawShaderMaterial'
        }
        if (customMaterialExtensions) this.registerMaterialExtensions(customMaterialExtensions)
        iMaterialCommons.upgradeMaterial.call(this)
        this.setValues(parameters)
    }

    // region Material Extension

    materialExtensions: MaterialExtension[] = []
    extraUniformsToUpload: Record<string, IUniform> = {}
    registerMaterialExtensions = iMaterialCommons.registerMaterialExtensions
    unregisterMaterialExtensions = iMaterialCommons.unregisterMaterialExtensions

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + iMaterialCommons.customProgramCacheKey.call(this)
    }

    onBeforeCompile(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void { // shader is not Shader but WebglUniforms.getParameters return value type so includes defines
        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)
        super.onBeforeCompile(shader, renderer)
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        super.onBeforeRender(renderer, scene, camera, geometry, object)
        iMaterialCommons.onBeforeRender.call(this, renderer, scene, camera, geometry, object)
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        super.onAfterRender(renderer, scene, camera, geometry, object)
        iMaterialCommons.onAfterRender.call(this, renderer, scene, camera, geometry, object)
    }

    // endregion

    /**
     * Sets the values of this material based on the values of the passed material or an object with material properties
     * The input is expected to be a valid material or a deserialized material parameters object(including the deserialized userdata)
     * @param parameters - material or material parameters object
     */
    setValues(parameters: Material|(ShaderMaterialParameters)): this {
        return iMaterialCommons.setValues(super.setValues).call(this, parameters)
    }

    toJSON(_?: any): any { // todo make abstract?
        throw new Error('Method not supported for this material.')
    }
    fromJSON(_: any, _2?: any): this | null { // todo make abstract?
        throw new Error('Method not supported for this material.')
    }

    /**
     * @deprecated use this directly
     */
    get materialObject() {
        return this
    }
}
