import {
    BoxGeometry,
    BufferGeometry,
    ColorSpace,
    CylinderGeometry,
    Euler,
    HemisphereLight,
    Light,
    Mesh,
    PerspectiveCamera,
    Scene,
    SphereGeometry,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
} from 'three'
import {IDisposable} from 'ts-browser-helpers'
import {
    snapObject,
    snapObjectPixels,
    SnapObjectPixels,
    SnapObjectResources,
    SnapObjectToneMapping,
    snapPixelsToCanvas,
} from './snapObject'
import {IMaterial, ITexture, IWebGLRenderer} from '../../core'
import type {ThreeViewer} from '../../viewer'
import type {TonemapPlugin} from '../../plugins'

/**
 * Shape of a material preview: one of {@link MaterialPreviewGenerator.shapes} (`sphere`, `cube`, `cylinder`),
 * or `mesh` for a given geometry ({@link MaterialPreviewOptions.geometry}).
 */
export type MaterialPreviewShape = 'sphere' | 'cube' | 'cylinder' | 'mesh'

/**
 * Options of {@link MaterialPreviewGenerator.renderPixels} and {@link MaterialPreviewGenerator.renderToCanvas}.
 */
export interface MaterialPreviewOptions {
    /**
     * Default `sphere`. `mesh` renders {@link geometry} alone, framed with a camera fitted to its bounds.
     */
    shape?: MaterialPreviewShape | string
    /**
     * Geometry for the `mesh` shape (like the geometry of the selected mesh). It is not changed.
     */
    geometry?: BufferGeometry
    /**
     * Size of the preview in pixels. Default 256
     */
    size?: number
    /**
     * Environment map. Use the viewer's to match the viewport, see {@link materialPreviewOptionsFromViewer}.
     */
    environment?: ITexture | null
    /**
     * Same as `scene.environmentIntensity`. Default 1
     */
    environmentIntensity?: number
    /**
     * Same as `scene.environmentRotation`. Default no rotation
     */
    environmentRotation?: Euler
    /**
     * Tone mapping, see {@link SnapObjectToneMapping}. Default none
     */
    toneMapping?: SnapObjectToneMapping | null
    /**
     * Output colour space, `SRGBColorSpace` (default) or linear.
     */
    outputColorSpace?: ColorSpace
    /**
     * Add the hemisphere light of the preview scene. Default: only when there is no environment map, or the material
     * is not lit by the scene environment (only `MeshStandardMaterial` and `MeshPhysicalMaterial` are, not Phong, Lambert or Basic),
     * so that a material lit by the environment map looks the same as in the viewport, and the other materials are not black.
     */
    light?: boolean
    /**
     * MSAA samples. Default 4
     */
    samples?: number
}

/**
 * Returns the preview options that make a material preview look like the viewport of the viewer:
 * the scene's environment map, its intensity and rotation, the tone mapping of the {@link TonemapPlugin}
 * (when it is added and enabled) and the output colour space of the {@link ScreenPass}.
 *
 * With `material`, the tone mapping follows the material like in the viewport: it is `null` when the material opts out of
 * tone mapping and the screen pass reads the GBuffer flags (see {@link TonemapPlugin.isMaterialTonemapped}). The output colour space is kept.
 *
 * The lights of the scene and screen pass effects other than tone mapping (vignette, film grain, chromatic aberration, bloom) are not in the previews.
 * @param viewer
 * @param material - the material of the preview
 */
export function materialPreviewOptionsFromViewer(viewer: ThreeViewer, material?: IMaterial): Pick<MaterialPreviewOptions, 'environment' | 'environmentIntensity' | 'environmentRotation' | 'toneMapping' | 'outputColorSpace'> {
    const scene = viewer.scene
    const tonemap = viewer.getPlugin<TonemapPlugin>('Tonemap')
    const tonemapped = !!tonemap && (material ? tonemap.isMaterialTonemapped(material) : !tonemap.isDisabled())
    return {
        environment: scene.environment,
        environmentIntensity: scene.environmentIntensity,
        environmentRotation: scene.environmentRotation,
        toneMapping: tonemap && tonemapped ? {
            toneMapping: tonemap.toneMapping,
            exposure: tonemap.exposure,
            contrast: tonemap.contrast,
            saturation: tonemap.saturation,
        } : null,
        outputColorSpace: viewer.renderManager.screenPass?.outputColorSpace ?? SRGBColorSpace,
    }
}

/**
 * Renders previews of materials on a shape (sphere, cube, cylinder) or a given geometry, with the viewer's renderer
 * in a private scene (layer 7), so the previews share the shaders and textures of the viewport.
 *
 * - {@link renderToCanvas} / {@link renderPixels} render into a small offscreen target with the given tone mapping,
 *   and do not change the canvas. Pass {@link materialPreviewOptionsFromViewer} to match the viewport.
 * - {@link generate} without `options.size` renders to the canvas and reads the whole canvas (the old behaviour).
 *
 * For previews that are requested on every material change (an inspector), see {@link MaterialPreviewQueue}.
 */
export class MaterialPreviewGenerator implements IDisposable {
    private _scene: Scene
    private _channel: number
    private _lights: Light[] = []
    private _resources = new SnapObjectResources()
    private _emptyGeometry = new BufferGeometry()
    private _mesh = new Mesh(this._emptyGeometry)

    /**
     * Camera of the offscreen previews (one camera, since three.js keeps some state per camera).
     */
    readonly camera = new PerspectiveCamera(45, 1, 0.1, 1000)

    /**
     * Camera direction of the `mesh` shape, from the centre of the geometry's bounds.
     * The distance is fitted to the bounds.
     */
    meshCameraDirection = new Vector3(0.6, 0.45, 1.2)

    constructor() {

        const scene = new Scene()

        this._channel = 7
        const hemisphericLight = new HemisphereLight(0xffffff, 0x444444, 1)
        hemisphericLight.position.set(0, 10, 0)
        hemisphericLight.layers.set(this._channel)
        scene.add(hemisphericLight)
        this._lights.push(hemisphericLight)

        this._scene = scene

    }

    dispose() {
        [...this._lights].forEach(light => light.dispose())
        Object.values(this.shapes).forEach(shape => {
            if (shape.geometry) shape.geometry.dispose()
        })
        this._emptyGeometry.dispose()
        this._resources.dispose()
    }

    shapes: Record<string, Mesh> = {
        sphere: new Mesh(new SphereGeometry(1)),
        cube: new Mesh(new BoxGeometry(1, 1, 1)),
        cylinder: new Mesh(new CylinderGeometry(0.5, 0.5, 1)),
    }

    /**
     * Returns a png data url of the material preview.
     *
     * Without `options.size`, it renders to the canvas and reads the whole canvas, without tone mapping (the old behaviour).
     * Call it from `preFrame`, then `viewer.setDirty()`.
     *
     * With `options.size`, it renders offscreen like {@link renderToCanvas} and the canvas is not changed.
     * @param material
     * @param renderer
     * @param environment
     * @param shape
     * @param options - preview options, `size` selects the offscreen render
     */
    // todo: show an overlay when this is happening
    generate(material: IMaterial, renderer: IWebGLRenderer, environment?: ITexture|null, shape = 'sphere', options?: Omit<MaterialPreviewOptions, 'environment' | 'shape'>): string {
        if (options?.size) return this.renderToCanvas(material, renderer, {...options, environment, shape}).toDataURL('image/png')

        const object = this._getObject({shape})
        object.material = material

        this._scene.add(object)
        this._scene.environment = environment ?? null
        this._scene.environmentIntensity = 1
        this._scene.environmentRotation.set(0, 0, 0)
        this._lights.forEach(l => l.visible = true)

        const envIntensity = material.envMapIntensity
        // clamp since we have no tonemapping
        if (typeof envIntensity === 'number') {
            material.envMapIntensity = Math.max(envIntensity, 2)
        }

        let snap: string
        try {
            snap = snapObject(renderer, object, this._scene, this._channel, new Vector3(0, 0, 1.5))
        } finally {
            if (typeof envIntensity === 'number')
                material.envMapIntensity = envIntensity

            this._scene.remove(object)
            object.material = undefined as any
        }

        return snap
    }

    /**
     * Renders the material preview into a small offscreen target and returns its pixels (see {@link snapObjectPixels}).
     * The canvas and the main render are not changed, no `viewer.setDirty()` is needed.
     * Call it from `preFrame` or `postFrame` of the viewer.
     * @param material
     * @param renderer - the viewer's renderer (`viewer.renderManager.renderer`)
     * @param options - see {@link MaterialPreviewOptions}
     */
    renderPixels(material: IMaterial, renderer: IWebGLRenderer | WebGLRenderer, options: MaterialPreviewOptions = {}): SnapObjectPixels {
        const object = this._getObject(options)
        const isMesh = object === this._mesh
        object.material = material

        this._scene.add(object)
        this._scene.environment = options.environment ?? null
        this._scene.environmentIntensity = options.environmentIntensity ?? 1
        if (options.environmentRotation) this._scene.environmentRotation.copy(options.environmentRotation)
        else this._scene.environmentRotation.set(0, 0, 0)
        // three.js lights only standard materials with scene.environment
        const light = options.light ?? !(options.environment && (material as {isMeshStandardMaterial?: boolean}).isMeshStandardMaterial)
        this._lights.forEach(l => l.visible = light)

        try {
            return snapObjectPixels(renderer, object, {
                root: this._scene,
                channel: this._channel,
                camOffset: isMesh ? this._meshCamOffset(object) : new Vector3(0, 0, 1.5),
                camera: this.camera,
                size: options.size ?? 256,
                toneMapping: options.toneMapping,
                outputColorSpace: options.outputColorSpace,
                samples: options.samples,
                resources: this._resources,
            })
        } finally {
            this._scene.remove(object)
            this._scene.environment = null
            object.material = undefined as any
            if (isMesh) object.geometry = this._emptyGeometry // do not keep a reference to the given geometry
        }
    }

    /**
     * Renders the material preview offscreen ({@link renderPixels}) and draws it into a canvas (a new one, or `canvas`).
     * @param material
     * @param renderer - the viewer's renderer (`viewer.renderManager.renderer`)
     * @param options - see {@link MaterialPreviewOptions}
     * @param canvas - canvas to draw into, it is resized to the preview size
     */
    renderToCanvas(material: IMaterial, renderer: IWebGLRenderer | WebGLRenderer, options: MaterialPreviewOptions = {}, canvas?: HTMLCanvasElement): HTMLCanvasElement {
        return snapPixelsToCanvas(this.renderPixels(material, renderer, options), canvas)
    }

    private _getObject({shape = 'sphere', geometry}: Pick<MaterialPreviewOptions, 'shape' | 'geometry'>): Mesh {
        if (shape === 'mesh') {
            if (geometry) {
                this._mesh.geometry = geometry
                return this._mesh
            }
            console.warn('MaterialPreviewGenerator: the mesh shape needs a geometry, using a sphere')
        }
        const object = this.shapes[shape] || this.shapes.sphere
        if (!object.geometry.attributes.tangent) object.geometry.computeTangents() // for anisotropy
        return object
    }

    // the camera distance that fits the bounding sphere of the geometry, in units of the largest side of its bounds (see snapObject camOffset)
    private _meshCamOffset(object: Mesh) {
        const geometry = object.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingSphere) geometry.computeBoundingSphere()
        const size = geometry.boundingBox?.getSize(new Vector3()) ?? new Vector3(1, 1, 1)
        const maxSize = Math.max(size.x, size.y, size.z) || 1
        // the camera looks at the centre of the bounds, which can be off the centre of the bounding sphere
        const offCenter = geometry.boundingBox && geometry.boundingSphere ? geometry.boundingBox.getCenter(new Vector3()).distanceTo(geometry.boundingSphere.center) : 0
        const radius = (geometry.boundingSphere?.radius ?? size.length() / 2) + offCenter
        const halfFov = this.camera.fov / 2 * Math.PI / 180
        const distance = radius / Math.sin(halfFov) * 1.05
        return this.meshCameraDirection.clone().normalize().multiplyScalar(distance / maxSize)
    }

}
