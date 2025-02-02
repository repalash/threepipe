import {
    Camera,
    IMaterial,
    MaterialExtension,
    PerspectiveCamera,
    Shader,
    shaderReplaceString,
    Vector2,
    WebGLRenderer,
} from 'threepipe'
import {computeFocalLengths} from './util'
import {gaussianSplatShaders} from '../shaders'

export class GaussianSplatMaterialExtension implements MaterialExtension {
    readonly isGaussianSplatMaterialExtension = true
    extraUniforms = {
        viewport: {value: new Vector2()},
        focal: {value: new Vector2()},
        minAlpha: {value: 0.02},
    }
    parsFragmentSnippet = gaussianSplatShaders.pars_frag
    parsVertexSnippet = gaussianSplatShaders.pars_vert
    shaderExtender = (shader: Shader, material: IMaterial) => {
        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <begin_vertex>',
            'vec3 transformed = vec3( center );')
        if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
            // todo: get correct normal by rendering to depth and then sampling the normal
            shader.vertexShader = shaderReplaceString(shader.vertexShader,
                '#include <beginnormal_vertex>',
                '\nobjectNormal = vec3(1,0,0);\n', {append: true})
        }
        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <project_vertex>',
            gaussianSplatShaders.main_vert, {append: true})

        if (!material.isGBufferMaterial && !material.userData.isGBufferMaterial) {
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#include <map_fragment>',
                shaderReplaceString(
                    gaussianSplatShaders.main_frag,
                    /gl_FragColor\s*=/, // because of minification
                    'diffuseColor*='
                ), {prepend: true})
        }
        // eslint-disable-next-line no-constant-condition
        if (0)
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#include <opaque_fragment>',
                '\ngl_FragColor=diffuseColor;',
                // '\ngl_FragColor=vec4(reflectedLight.directDiffuse, 1.);',
                // '\ngl_FragColor=vec4(geometryNormal, 1.);',
                {append: true})
        return shader
    }
    isCompatible = (material: IMaterial) =>
        !!material.isPhysicalMaterial ||
        !!material.isUnlitMaterial ||
        !!material.isGBufferMaterial ||
        !!material.userData.isGBufferMaterial

    setDirty?: () => void

    private _currentCamera?: PerspectiveCamera | Camera
    private _renderer?: WebGLRenderer

    public set minAlpha(value: number) {
        this.extraUniforms.minAlpha.value = value
        this.setDirty && this.setDirty()
    }


    constructor() {
        window.addEventListener('resize', this._refresh)
    }

    dispose() {
        // todo: add again on added to mesh?
        window.removeEventListener('resize', this._refresh)
    }

    update(camera: PerspectiveCamera | Camera, renderer: WebGLRenderer): void {
        if (this._currentCamera === camera && this._renderer === renderer) return
        this._renderer = renderer
        this._currentCamera = camera
        this._refresh()
    }

    private _refresh = (): void => {
        if (!this._currentCamera) return
        const size = new Vector2()
        this._renderer?.getSize(size)
        const dpr = this._renderer?.getPixelRatio() || 1
        let fov = 75
        let aspect = size.x / size.y

        if (this._currentCamera instanceof PerspectiveCamera) {
            fov = this._currentCamera.fov
            aspect = this._currentCamera.aspect
        }

        this.extraUniforms.focal.value = computeFocalLengths(size.x, size.y, fov, aspect, dpr)
        this.extraUniforms.viewport.value = new Vector2(size.x * dpr, size.y * dpr)
    }
}
