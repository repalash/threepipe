import {
    serialize,
    uiButton,
    uiFolderContainer,
    uiNumber,
    uiSlider,
    uiToggle,
    uiVector,
    Vector2,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'threepipe'
import {WebGLPathTracer} from 'three-gpu-pathtracer'

@uiFolderContainer('Path Tracer')
export class WebGLPathTracer2 extends WebGLPathTracer {
    constructor(renderer: WebGLRenderer) {
        super(renderer)
        this.rasterizeScene = false
        this.renderToCanvas = false
        // this.tiles.set(1, 1)
    }

    @uiNumber(undefined, {readOnly: true})
    readonly declare samples: number
    // @uiImage(undefined, {readOnly: true})
    readonly declare target: WebGLRenderTarget
    @uiVector(undefined)
    readonly declare tiles: Vector2

    @uiToggle()
    @serialize()
    declare multipleImportanceSampling: boolean
    @uiSlider(undefined, [1, 100], 1)
    @serialize()
    declare bounces: number
    @uiSlider(undefined, [1, 100], 1)
    @serialize()
    declare transmissiveBounces: number
    @uiNumber()
    @serialize()
    declare filterGlossyFactor: number

    @uiNumber()
    declare renderDelay: number
    @uiNumber()
    declare minSamples: number
    @uiNumber()
    declare fadeDuration: number
    @uiToggle()
    declare enablePathTracing: boolean
    @uiToggle()
    declare pausePathTracing: boolean
    @uiToggle()
    declare dynamicLowRes: boolean
    @uiNumber()
    declare lowResScale: number
    @uiNumber()
    declare renderScale: number
    @uiToggle()
    declare synchronizeRenderSize: boolean
    // @uiToggle()
    //     rasterizeScene: boolean
    // @uiToggle()
    //     renderToCanvas: boolean
    @uiVector()
    @serialize()
    declare textureSize: Vector2

    @uiSlider('Emissive Multiplier', [0, 1000], 0.1)
    @serialize()
        emissiveMultiplier = 1

    @uiButton()
    updateCamera() {
        super.updateCamera()
    }

    protected _materials: any[] = []
    @uiButton()
    updateMaterials() {
        this._materials.forEach((material: any) => {
            material.userData.__emissiveIntensity = material.emissiveIntensity
            material.emissiveIntensity *= this.emissiveMultiplier
            if (material.attenuationDistance < 0.00001) {
                material.attenuationDistance = 10000
                material.userData.__attenuationDistance = material.attenuationDistance
            }
        })
        super.updateMaterials()
        // this.ptMaterial.materials.updateFrom(this.sceneInfo.materials, this.sceneInfo.textures)
        //
        this._materials.forEach((material: any) => {
            if (material.userData.__emissiveIntensity !== undefined) {
                material.emissiveIntensity = material.userData.__emissiveIntensity
                delete material.userData.__emissiveIntensity
            }
            if (material.userData.__attenuationDistance !== undefined) {
                material.attenuationDistance = material.userData.__attenuationDistance
                delete material.userData.__attenuationDistance
            }
        })
    }

    @uiButton()
    updateLights() {
        super.updateLights()
    }

    @uiButton()
    updateEnvironment() {
        super.updateEnvironment()
    }

    // @uiButton()
    // renderSample() {super.renderSample()}
    @uiButton()
    reset() {
        super.reset()
    }

    // @uiButton()
    // dispose() {super.dispose()}

}
