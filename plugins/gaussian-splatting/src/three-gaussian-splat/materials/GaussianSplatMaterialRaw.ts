import {Camera, PerspectiveCamera, ShaderMaterial2, Vector2, WebGLRenderer} from 'threepipe'
import {computeFocalLengths} from './util'
import {gaussianSplatShaders} from '../shaders'

export class GaussianSplatMaterialRaw extends ShaderMaterial2 {
    private _currentCamera?: PerspectiveCamera | Camera
    private _renderer?: WebGLRenderer

    readonly isGaussianSplatMaterialRaw = true

    public set minAlpha(value: number) {
        this.uniforms.minAlpha.value = value
        this.needsUpdate = true
    }

    constructor() {
        super({
            uniforms: {
                viewport: {value: new Vector2()},
                focal: {value: new Vector2()},
                minAlpha: {value: 0.02},
            },
            fragmentShader: `${gaussianSplatShaders.pars_frag}
void main () {
${gaussianSplatShaders.main_frag}
}`,
            vertexShader: `${gaussianSplatShaders.pars_vert}
void main () {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center, 1);
    ${gaussianSplatShaders.main_vert}
}`,
            depthTest: true,
            depthWrite: false,
            transparent: true,
        }, true)

        window.addEventListener('resize', this._refresh)
    }

    private _refresh = (): void => {
        if (!this._currentCamera) return

        const size = new Vector2()
        this._renderer?.getSize(size)
        const width = size.x
        const height = size.y

        const dpr = this._renderer?.getPixelRatio() || 1

        let fov = 75
        let aspect = width / height

        if (this._currentCamera instanceof PerspectiveCamera) {
            fov = this._currentCamera.fov
            aspect = this._currentCamera.aspect
        }

        this.uniforms.focal.value = computeFocalLengths(width, height, fov, aspect, dpr)
        this.uniforms.viewport.value = new Vector2(width * dpr, height * dpr)
    }

    dispose() {
        // todo: add again on added to mesh?
        window.removeEventListener('resize', this._refresh)
        return super.dispose()
    }

    update(camera: PerspectiveCamera | Camera, renderer: WebGLRenderer): void {
        this._renderer = renderer
        this._currentCamera = camera
        this._refresh()
    }
}
