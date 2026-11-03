import {
    ACESFilmicToneMapping,
    AgXToneMapping,
    CineonToneMapping,
    Color,
    ColorSpace,
    CustomToneMapping,
    HalfFloatType,
    LinearToneMapping,
    NearestFilter,
    NeutralToneMapping,
    NoBlending,
    Object3D,
    PerspectiveCamera,
    ReinhardToneMapping,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    TextureDataType,
    ToneMapping,
    UnsignedByteType,
    Vector3,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {glsl, IDisposable} from 'ts-browser-helpers'
import {Box3B} from '../math/Box3B'
import {IWebGLRenderer} from '../../core'
import {getTextureDataType} from './texture'
import TonemapShader from '../../plugins/postprocessing/shaders/TonemapPlugin.pars.glsl'

/**
 * Tone mapping applied by {@link snapObjectPixels} (and {@link snapObject} with `size`) to the offscreen render.
 * The values are the ones of {@link TonemapPlugin}, so a snapshot can match the viewport.
 */
export interface SnapObjectToneMapping {
    /**
     * A three.js tone mapping constant, like {@link TonemapPlugin.toneMapping}.
     * `NoToneMapping` applies only the output colour space.
     */
    toneMapping: ToneMapping
    /** Exposure, as {@link TonemapPlugin.exposure}. Default 1 */
    exposure?: number
    /** Contrast, as {@link TonemapPlugin.contrast}. Default 1 */
    contrast?: number
    /** Saturation, as {@link TonemapPlugin.saturation}. Default 1 */
    saturation?: number
}

/**
 * Options of {@link snapObject}, {@link snapObjectPixels} and {@link snapObjectToCanvas}.
 */
export interface SnapObjectOptions {
    /**
     * Scene to render, the object must be in it. Without it, the object is rendered alone.
     */
    root?: Scene
    /**
     * Layer (channel) to render. The object and its children are added to it for the snapshot, the camera renders only it.
     * 0 or less renders all the layers. Default 7
     */
    channel?: number
    /**
     * Camera position from the centre of the object's bounds, in units of the largest side of the bounds.
     * Default `(0, 0, 1.5)`
     */
    camOffset?: Vector3
    /**
     * Camera to use. Pass the same camera when snapping repeatedly: three.js keeps some state per camera (like the transmission target).
     * Default: a new `PerspectiveCamera(45, 1, 0.1, 1000)`
     */
    camera?: PerspectiveCamera
    /**
     * Size in pixels (a number for a square).
     *
     * When set, {@link snapObject} renders into a small offscreen target of this size and reads back only that target,
     * with {@link toneMapping} and {@link outputColorSpace} applied. The canvas is not changed, so there is no need to call `viewer.setDirty()` after it.
     *
     * When not set, {@link snapObject} renders to the canvas and reads the whole canvas (the old behaviour, see {@link snapObject}).
     * {@link snapObjectPixels} and {@link snapObjectToCanvas} always render offscreen, default 256.
     */
    size?: number | {width: number, height: number}
    /**
     * Tone mapping of the offscreen render, see {@link SnapObjectToneMapping}.
     * Use {@link materialPreviewOptionsFromViewer} to get the values of the viewer. Default: none
     */
    toneMapping?: SnapObjectToneMapping | null
    /**
     * Colour space of the offscreen output: `SRGBColorSpace` (default, as the viewer's {@link ScreenPass.outputColorSpace}) or linear (any other value).
     */
    outputColorSpace?: ColorSpace
    /**
     * MSAA samples of the offscreen render (WebGL 2). Default 4
     */
    samples?: number
    /**
     * Render targets and material to reuse between offscreen snapshots. Without it, they are created and disposed in each call.
     * The caller disposes it.
     */
    resources?: SnapObjectResources
    /**
     * Image type of the data url of {@link snapObject} with `size`. Default `image/png`
     */
    mimeType?: string
}

/**
 * Pixels of an offscreen snapshot, RGBA 8 bit, rows from top to bottom (like `ImageData`), not premultiplied.
 */
export interface SnapObjectPixels {
    data: Uint8Array
    width: number
    height: number
}

// names of the functions in three.js tonemapping_pars_fragment (same as getToneMappingFunction in three.js WebGLProgram)
const toneMappingFunctions: Partial<Record<ToneMapping, string>> = {
    [LinearToneMapping]: 'LinearToneMapping',
    [ReinhardToneMapping]: 'ReinhardToneMapping',
    [CineonToneMapping]: 'OptimizedCineonToneMapping',
    [ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
    [AgXToneMapping]: 'AgXToneMapping',
    [NeutralToneMapping]: 'NeutralToneMapping',
    [CustomToneMapping]: 'CustomToneMapping', // Uncharted2 when TonemapPlugin is loaded
}

/**
 * Render targets and the tone mapping material used by the offscreen snapshots ({@link snapObjectPixels}).
 * Keep one and pass it in {@link SnapObjectOptions.resources} to snap repeatedly without allocating, then dispose it.
 */
export class SnapObjectResources implements IDisposable {
    /**
     * Linear HDR target (half float) the object is rendered into.
     */
    hdrTarget?: WebGLRenderTarget
    /**
     * 8 bit target with the tone mapped result, the one that is read back.
     */
    ldrTarget?: WebGLRenderTarget

    /**
     * Copies the HDR target to the LDR target: un-premultiplies, tone maps with the same functions as {@link TonemapPlugin}
     * (three.js tone mapping, then contrast and saturation), converts to the output colour space, and flips the rows.
     */
    readonly material = new ShaderMaterial({
        uniforms: {
            tDiffuse: {value: null},
            toneMappingExposure: {value: 1},
            toneMappingContrast: {value: 1},
            toneMappingSaturation: {value: 1},
        },
        vertexShader: CopyShader.vertexShader,
        fragmentShader: glsl`
            #include <tonemapping_pars_fragment>
            uniform sampler2D tDiffuse;
            uniform float toneMappingContrast;
            uniform float toneMappingSaturation;
            varying vec2 vUv;
            #ifdef SNAP_TONE_MAPPING
            #define TONE_MAPPING
            vec3 toneMapping( vec3 color ) { return SNAP_TONE_MAPPING( color ); }
            #endif
            ${TonemapShader}
            void main() {
                // flip, so that readPixels returns the rows from top to bottom
                vec4 color = texture2D( tDiffuse, vec2( vUv.x, 1.0 - vUv.y ) );
                // the target is cleared to transparent black: anti-aliased edges and transparent materials are blended with it
                if ( color.a > 0.0 ) color.rgb /= color.a;
                color = ToneMapping( color );
                #ifdef SNAP_SRGB_OUTPUT
                color = sRGBTransferOETF( color );
                #endif
                gl_FragColor = color;
            }
        `,
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
    })

    private _quad?: FullScreenQuad

    /**
     * Creates or resizes the targets.
     * @param width
     * @param height
     * @param samples - MSAA samples of the HDR target
     * @param type - texture type of the HDR target, half float by default. See {@link getTextureDataType}
     */
    prepare(width: number, height: number, samples = 4, type: TextureDataType = HalfFloatType): {hdr: WebGLRenderTarget, ldr: WebGLRenderTarget} {
        if (this.hdrTarget && (this.hdrTarget.samples !== samples || this.hdrTarget.texture.type !== type)) {
            this.hdrTarget.dispose()
            this.hdrTarget = undefined
        }
        if (!this.hdrTarget) this.hdrTarget = new WebGLRenderTarget(width, height, {
            type, samples, depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
        })
        if (!this.ldrTarget) this.ldrTarget = new WebGLRenderTarget(width, height, {
            type: UnsignedByteType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
        })
        this.hdrTarget.setSize(width, height)
        this.ldrTarget.setSize(width, height)
        this.hdrTarget.texture.name = 'SnapObject.hdr'
        this.ldrTarget.texture.name = 'SnapObject.ldr'
        return {hdr: this.hdrTarget, ldr: this.ldrTarget}
    }

    /**
     * Sets the tone mapping and output colour space of {@link material}.
     */
    setOutput(toneMapping?: SnapObjectToneMapping | null, outputColorSpace: ColorSpace = SRGBColorSpace) {
        const material = this.material
        const fn = toneMapping ? toneMappingFunctions[toneMapping.toneMapping] : undefined
        const srgb = outputColorSpace === SRGBColorSpace ? '1' : undefined
        if (material.defines.SNAP_TONE_MAPPING !== fn || material.defines.SNAP_SRGB_OUTPUT !== srgb) {
            if (fn) material.defines.SNAP_TONE_MAPPING = fn
            else delete material.defines.SNAP_TONE_MAPPING
            if (srgb) material.defines.SNAP_SRGB_OUTPUT = srgb
            else delete material.defines.SNAP_SRGB_OUTPUT
            material.needsUpdate = true
        }
        material.uniforms.toneMappingExposure.value = toneMapping?.exposure ?? 1
        material.uniforms.toneMappingContrast.value = toneMapping?.contrast ?? 1
        material.uniforms.toneMappingSaturation.value = toneMapping?.saturation ?? 1
    }

    /**
     * Renders the HDR target into the LDR target with {@link material}.
     */
    resolve(renderer: WebGLRenderer) {
        if (!this.hdrTarget || !this.ldrTarget) throw new Error('SnapObjectResources: call prepare first')
        if (!this._quad) this._quad = new FullScreenQuad(this.material)
        this.material.uniforms.tDiffuse.value = this.hdrTarget.texture
        renderer.setRenderTarget(this.ldrTarget)
        this._quad.render(renderer)
        this.material.uniforms.tDiffuse.value = null
    }

    dispose() {
        this.hdrTarget?.dispose()
        this.ldrTarget?.dispose()
        this.hdrTarget = undefined
        this.ldrTarget = undefined
        this._quad?.dispose()
        this._quad = undefined
        this.material.dispose()
    }
}

/**
 * Width and height in pixels of {@link SnapObjectOptions.size}.
 * @param size
 */
function snapSize(size: SnapObjectOptions['size'] = 256) {
    const width = Math.max(1, Math.floor(typeof size === 'number' ? size : size.width))
    const height = Math.max(1, Math.floor(typeof size === 'number' ? size : size.height))
    return {width, height}
}

/**
 * Frames the object with the camera, puts it in the channel, calls render and puts everything back.
 * With `aspect`, also sets the camera aspect and fits the near and far planes to the object.
 */
function withSnapCamera<T>(object: Object3D, options: SnapObjectOptions, aspect: number | undefined, render: (root: Object3D, camera: PerspectiveCamera) => T): T {
    const {
        root,
        channel = 7,
        camOffset = new Vector3(0, 0, 1.5),
        camera = new PerspectiveCamera(45, 1, 0.1, 1000),
    } = options

    const oldVisible = object.visible
    object.visible = true

    const bbox = new Box3B().expandByObject(object, true, true)
    const center = bbox.getCenter(new Vector3())
    const bboxSize = bbox.getSize(new Vector3())
    const maxSize = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)
    camera.position.copy(center).add(camOffset.clone().multiplyScalar(maxSize))
    camera.lookAt(center)
    if (aspect !== undefined) {
        const distance = camOffset.length() * maxSize
        const radius = bboxSize.length() / 2
        camera.aspect = aspect
        camera.near = Math.max(distance - radius, distance * 0.01, 1e-6) * 0.9
        camera.far = (distance + radius) * 1.1 + 1e-6
        camera.updateProjectionMatrix()
    }

    object.traverseVisible(obj => {
        obj.layers.enable(channel)
    })
    if (channel > 0)
        camera.layers.set(channel)
    else
        camera.layers.enableAll()

    try {
        return render(root ?? object, camera)
    } finally {
        // before restoring visible, so that the same objects are visited as above
        object.traverseVisible(obj => {
            obj.layers.disable(channel)
        })
        object.visible = oldVisible
        camera.layers.enableAll()
    }
}

/**
 * Renders the object into a small offscreen target and returns its pixels. The canvas and the main render are not changed:
 * the render target, clear colour and `autoClear` of the renderer are put back, and no `viewer.setDirty()` is needed.
 *
 * The object is rendered into a linear half float target (8 bit when the device cannot render to half float; with MSAA, transparent background), then tone mapped with
 * {@link SnapObjectOptions.toneMapping}, converted to {@link SnapObjectOptions.outputColorSpace} and read back.
 * Screen space effects of the viewer (SSAO, SSR and similar material extensions) are off in this render, since they read the buffers of the main view.
 *
 * Call it from `preFrame` or `postFrame` of the viewer (not during a render), with the object in `options.root`. For usage see {@link MaterialPreviewGenerator}.
 * @param renderer - the viewer's renderer (`viewer.renderManager.renderer`)
 * @param object - object to frame and render
 * @param options - see {@link SnapObjectOptions}. `size` defaults to 256
 */
export function snapObjectPixels(renderer: IWebGLRenderer | WebGLRenderer, object: Object3D, options: SnapObjectOptions = {}): SnapObjectPixels {
    const {width, height} = snapSize(options.size)
    const resources = options.resources ?? new SnapObjectResources()
    try {
        return withSnapCamera(object, options, width / height, (root, camera) => {
            // half float when the device can render to it, like the other HDR targets
            const {hdr, ldr} = resources.prepare(width, height, options.samples ?? 4, getTextureDataType(renderer))
            resources.setOutput(options.toneMapping, options.outputColorSpace)

            const lastTarget = renderer.getRenderTarget()
            const lastFace = renderer.getActiveCubeFace()
            const lastMip = renderer.getActiveMipmapLevel()
            const clearColor = renderer.getClearColor(new Color())
            const clearAlpha = renderer.getClearAlpha()
            const autoClear = renderer.autoClear
            try {
                renderer.autoClear = false
                renderer.setClearColor(0x000000, 0)
                renderer.setRenderTarget(hdr)
                renderer.clear()
                const render = () => renderer.render(root, camera)
                if (typeof (renderer as IWebGLRenderer).renderWithModes === 'function') {
                    (renderer as IWebGLRenderer).renderWithModes({
                        backgroundRender: false,
                        screenSpaceRendering: false,
                        shadowMapRender: false,
                    }, render)
                } else render()

                resources.resolve(renderer)

                const data = new Uint8Array(width * height * 4)
                renderer.readRenderTargetPixels(ldr, 0, 0, width, height, data)
                return {data, width, height}
            } finally {
                renderer.setRenderTarget(lastTarget, lastFace, lastMip)
                renderer.setClearColor(clearColor, clearAlpha)
                renderer.autoClear = autoClear
            }
        })
    } finally {
        if (!options.resources) resources.dispose()
    }
}

/**
 * Renders the object offscreen with {@link snapObjectPixels} and draws the pixels into a canvas (a new one, or `canvas`).
 * This is the cheapest output for a panel: no image encoding. Use `canvas.toDataURL()` when a data url is needed.
 * @param renderer - the viewer's renderer
 * @param object - object to frame and render
 * @param options - see {@link SnapObjectOptions}. `size` defaults to 256
 * @param canvas - canvas to draw into, it is resized to the snapshot size
 */
export function snapObjectToCanvas(renderer: IWebGLRenderer | WebGLRenderer, object: Object3D, options: SnapObjectOptions = {}, canvas?: HTMLCanvasElement): HTMLCanvasElement {
    return snapPixelsToCanvas(snapObjectPixels(renderer, object, options), canvas)
}

/**
 * Draws {@link SnapObjectPixels} into a canvas (a new one, or `canvas`, resized to the pixels).
 */
export function snapPixelsToCanvas(pixels: SnapObjectPixels, canvas?: HTMLCanvasElement): HTMLCanvasElement {
    canvas = canvas ?? document.createElement('canvas')
    if (canvas.width !== pixels.width) canvas.width = pixels.width
    if (canvas.height !== pixels.height) canvas.height = pixels.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('snapPixelsToCanvas: unable to get 2d context')
    const data = new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength)
    ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height), 0, 0)
    return canvas
}

/**
 * Returns a snapshot of the object as a png data url, with a transparent background.
 * Does a simple render, does not run the full pipeline.
 *
 * With `options.size`, the object is rendered into a small offscreen target with the given tone mapping and output colour space,
 * and only that target is read back (see {@link snapObjectPixels}). The canvas is not changed. This is much faster than the canvas path on large canvases,
 * and with the viewer's tone mapping ({@link materialPreviewOptionsFromViewer}) the colours match the viewport.
 *
 * Without `size` (and with the positional arguments), the object is rendered to the canvas and the whole canvas is read (`toDataURL`),
 * without tone mapping and in the renderer's output colour space. Call it from `preFrame` and then `viewer.setDirty()`, so that the next frame draws over it.
 *
 * Object must be in root, for usage see {@link MaterialPreviewGenerator}.
 * @param renderer
 * @param object
 * @param options - see {@link SnapObjectOptions}
 */
export function snapObject(renderer: IWebGLRenderer, object: Object3D, options?: SnapObjectOptions): string
/**
 * Renders to the canvas and reads the whole canvas, see {@link snapObject}.
 * @param renderer
 * @param object
 * @param root
 * @param channel
 * @param camOffset
 * @param camera
 */
export function snapObject(renderer: IWebGLRenderer, object: Object3D, root?: Scene, channel?: number, camOffset?: Vector3, camera?: PerspectiveCamera): string
export function snapObject(
    renderer: IWebGLRenderer,
    object: Object3D,
    rootOrOptions?: Scene | SnapObjectOptions,
    channel?: number,
    camOffset?: Vector3,
    camera?: PerspectiveCamera
): string {
    const options: SnapObjectOptions = rootOrOptions && !(rootOrOptions as Scene).isObject3D ?
        rootOrOptions as SnapObjectOptions :
        {root: rootOrOptions as Scene | undefined, channel, camOffset, camera}

    if (options.size) return snapObjectToCanvas(renderer, object, options).toDataURL(options.mimeType ?? 'image/png')

    return withSnapCamera(object, options, undefined, (root, cam) => {
        renderer.setRenderTarget(null)

        // clear to transparent, so that the snapshot has only the object and does not depend on the clear color left by the last pass
        const clearColor = renderer.getClearColor(new Color())
        const clearAlpha = renderer.getClearAlpha()
        renderer.setClearColor(0x000000, 0)
        let snap: string
        try {
            renderer.clear()
            if (typeof renderer.renderWithModes === 'function') {
                renderer.renderWithModes({
                    backgroundRender: false,
                }, ()=>{
                    renderer.render(root, cam)
                })
            } else {
                renderer.render(root, cam)
            }

            // todo use webp when possible.
            snap = renderer.domElement.toDataURL('image/png')

            renderer.clear()
        } finally {
            renderer.setClearColor(clearColor, clearAlpha)
        }
        return snap
    })
}
