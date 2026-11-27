// The thumbnail and video of a model, one setup for all (scripts/sample-assets/render-catalog.mjs). Set before the model
// loads: no ground and a transparent background, so a model that has its own ground or background keeps it.
import {
    Box3,
    Mesh,
    Object3D,
    PhysicalMaterial,
    SphereGeometry,
    CanvasRecorderPlugin,
    ChromaticAberrationPlugin,
    ClearcoatTintPlugin,
    CustomBumpMapPlugin,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    NoiseBumpMaterialPlugin,
    ParallaxMappingPlugin,
    VignettePlugin,
    GBufferPlugin,
    GLTFAnimationPlugin,
    GLTFMeshOptDecodePlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    PLYLoadPlugin,
    Rhino3dmLoadPlugin,
    STLLoadPlugin,
    USDZLoadPlugin,
    PopmotionPlugin,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    TonemapPlugin,
    Vector3,
} from 'threepipe'
import {extraImportPlugins} from '@threepipe/plugins-extra-importers'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'
import {B3DMLoadPlugin, CMPTLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, TilesRendererPlugin} from '@threepipe/plugin-3d-tiles-renderer'
import {AdvancedGroundPlugin, AnisotropyPlugin, BloomPlugin, DepthOfFieldPlugin, SSContactShadowsPlugin, SSGIPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin} from '@threepipe/webgi-plugins'

const query = new URLSearchParams(location.search)
const url = query.get('m')!
const size = parseInt(query.get('size') ?? '512')
const videoSeconds = parseFloat(query.get('video') ?? '3') // 0: no video
// the extension to load it as, when the URL's own doesn't pick the loader (metadata.files[].load_as in the catalog)
const loadAs = query.get('format') ?? undefined
// model, hdri (chrome and matte balls in front of it) or material (a sphere with it, under the studio HDRI)
const kind = query.get('kind') ?? 'model'
// where the camera looks from before it fits the view: a three-quarter view of a model, eye level for an HDRI
const DIRECTIONS: Record<string, number[]> = {model: [1, 0.45, 1.5], hdri: [0, 0.12, 1], material: [0, 0.35, 1]}
const ENVIRONMENT = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr' // CC0, Poly Haven
const INSIDE_ARC = 8 // degrees
const FIT = 1.5 // distance to the model, as in render3d-cli
// renders with more pixels than the files have: scripts/sample-assets/render-catalog.mjs shrinks them
const STILL_SCALE = parseFloat(query.get('stillScale') ?? '4')
const VIDEO_SCALE = parseFloat(query.get('videoScale') ?? '2')

interface View {position: number[], target: number[], yfov: number, aspect?: number, inside?: boolean, saved?: boolean}

const toDataUrl = async(blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
})

const frames = async(viewer: ThreeViewer, count: number) => new Promise<void>(resolve => {
    let done = 0
    const onFrame = () => {
        if (++done < count) return
        viewer.removeEventListener('postFrame', onFrame)
        resolve()
    }
    viewer.addEventListener('postFrame', onFrame)
})

/**
 * The counts of what loaded, for formats the catalog can't read itself (glTF is counted from the file). Not for a
 * tileset: what is loaded depends on the view.
 */
function measure(root: any) {
    let triangles = 0, vertices = 0, points = 0, meshes = 0
    const materials = new Set<any>(), textures = new Set<any>(), clips = new Set<any>()
    root.traverse((o: any) => {
        for (const clip of o.animations ?? []) clips.add(clip)
        const geometry = o.geometry
        if (!geometry) return
        const count = geometry.attributes?.position?.count ?? 0
        const instances = o.isInstancedMesh ? o.count : 1
        if (o.isPoints) points += count * instances
        else if (o.isMesh) {
            meshes++
            triangles += Math.floor((geometry.index ? geometry.index.count : count) / 3) * instances
        }
        vertices += count * instances
        for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
            materials.add(material)
            for (const value of Object.values(material)) if ((value as any)?.isTexture) textures.add(value)
        }
    })
    return {triangles, vertices, points, meshes, materials: materials.size, textures: textures.size,
        animations: [...clips].map((clip: any) => ({name: clip.name, seconds: Math.round(clip.duration * 100) / 100}))}
}

/** What an HDRI or a material is shown on: two balls (chrome, matte) or one sphere with the material. */
function previewObjects(viewer: ThreeViewer, material?: any) {
    const group = new Object3D()
    group.name = kind + ' preview'
    const sphere = (radius: number, m: any) => new Mesh(new SphereGeometry(radius, 128, 64), m)
    if (kind === 'hdri') {
        const chrome = sphere(0.5, new PhysicalMaterial({color: 0xffffff, metalness: 1, roughness: 0}))
        const matte = sphere(0.5, new PhysicalMaterial({color: 0xcccccc, metalness: 0, roughness: 1}))
        chrome.position.x = -0.55
        matte.position.x = 0.55
        group.add(chrome, matte)
    } else {
        if (!material?.isMaterial) throw new Error('no material loaded')
        group.add(sphere(1, material))
    }
    viewer.scene.addObject(group)
    return group
}

async function render() {
    const canvas = document.getElementById('mcanvas') as HTMLCanvasElement
    canvas.style.width = canvas.style.height = size + 'px'
    const viewer = new ThreeViewer({
        // half-float: RGBM uses the alpha channel, and glass is lost on a transparent background
        canvas, msaa: false, rgbm: false, renderScale: STILL_SCALE,
        plugins: [GLTFMeshOptDecodePlugin, KTX2LoadPlugin, ProgressivePlugin, PopmotionPlugin, GBufferPlugin, SSAOPlugin, SSAAPlugin, VelocityBufferPlugin, TemporalAAPlugin,
            SSReflectionPlugin, SSGIPlugin, SSContactShadowsPlugin, DepthOfFieldPlugin, BloomPlugin, ChromaticAberrationPlugin, VignettePlugin, FilmicGrainPlugin,
            AnisotropyPlugin, ClearcoatTintPlugin, CustomBumpMapPlugin, NoiseBumpMaterialPlugin, ParallaxMappingPlugin, FragmentClippingExtensionPlugin,
            // every format the viewer opens, as in examples/model-viewer
            KTXLoadPlugin, PLYLoadPlugin, STLLoadPlugin, USDZLoadPlugin, Rhino3dmLoadPlugin, BlendLoadPlugin, GaussianSplattingPlugin, ...extraImportPlugins,
            B3DMLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, CMPTLoadPlugin, TilesRendererPlugin],
    })
    viewer.renderManager.stableNoise = true
    // off unless a file's settings turn them on: they change how a model looks, or need settings made for it
    for (const plugin of [SSGIPlugin, SSContactShadowsPlugin, DepthOfFieldPlugin, ChromaticAberrationPlugin, VignettePlugin, FilmicGrainPlugin]) viewer.getPlugin(plugin as any)!.enabled = false
    const ssr = viewer.getPlugin(SSReflectionPlugin)! as any
    if (ssr.pass) Object.assign(ssr.pass, {stepCount: 32, intensity: 1, tolerance: 1, power: 1.1})
    const bloom = viewer.getPlugin(BloomPlugin)! as any
    if (bloom.pass) Object.assign(bloom.pass, {intensity: 0.05, threshold: 2})
    const animation = viewer.addPluginSync(GLTFAnimationPlugin)
    const recorder = viewer.addPluginSync(CanvasRecorderPlugin)
    const tonemap = viewer.getPlugin(TonemapPlugin)
    if (tonemap) Object.assign(tonemap, {tonemapBackground: false, contrast: 1.05})
    viewer.scene.backgroundColor = null as any
    const ground = viewer.addPluginSync(AdvancedGroundPlugin)
    ground.visible = false
    ground.autoBakeShadows = false
    if (kind === 'hdri') {
        // the HDRI lights the balls and is the background, tone mapped like them
        if (!await viewer.setEnvironmentMap(url, {fileExtension: loadAs, setBackground: true})) throw new Error('the HDRI did not load')
        if (tonemap) tonemap.tonemapBackground = true
    } else await viewer.setEnvironmentMap(ENVIRONMENT)

    // a view in the file's coordinates: the camera the file was saved with, the model's camera, or from inside a room
    const view = query.get('view') ? JSON.parse(query.get('view')!) as View : undefined
    // a saved file loads as it was saved; anything else is centered and scaled, or fitted below
    const loaded = kind === 'model' ? await viewer.load<any>(url, {...view?.saved ? {} : {autoCenter: true, autoScale: true, autoScaleRadius: 1}, fileExtension: loadAs}) :
        previewObjects(viewer, kind === 'material' ? await viewer.load<any>(url, {fileExtension: loadAs}) : undefined)
    // a zip gives what was in it, a list
    const model = Array.isArray(loaded) ? loaded.length === 1 ? loaded[0] : viewer.scene.modelRoot : loaded
    if (!model || Array.isArray(loaded) && !loaded.length) throw new Error('nothing loaded')
    // a 3D tileset streams the tiles the camera sees: wait for them after the camera is set
    const tiles = model.tilesRenderer as undefined | {loadProgress: number, addEventListener: (type: string, listener: () => void) => void, removeEventListener: (type: string, listener: () => void) => void}

    const camera = viewer.scene.mainCamera
    camera.controlsMode = '' // nobody orbits here; controls keep their own state and limits (minDistance) and move the camera
    camera.userData.autoLookAtTarget = true
    if (view?.saved) {
        // the file's settings have set the camera on load
    } else if (view) {
        viewer.scene.updateMatrixWorld(true) // the transform of autoCenter and autoScale
        const box = new Box3().setFromObject(model, true)
        const radius = box.getSize(new Vector3()).length() / 2 || 1
        // the frame is square: the same width of view as the camera (glTF gives the height of the view and maybe an
        // aspect ratio; without one these scenes are wide renders)
        const aspect = view.aspect && view.aspect !== 1 ? view.aspect : 16 / 9
        camera.fov = 2 * Math.atan(Math.tan(view.yfov / 2) * aspect) * 180 / Math.PI
        // inside a room: the automatic near plane cuts away what is close
        camera.autoNearFar = false
        camera.minNearPlane = camera.near = radius * 0.001
        camera.maxFarPlane = camera.far = radius * 50
        camera.position.fromArray(view.position).applyMatrix4(model.matrixWorld)
        camera.target.fromArray(view.target).applyMatrix4(model.matrixWorld)
        camera.setDirty()
    } else {
        camera.position.fromArray(DIRECTIONS[kind] ?? DIRECTIONS.model)
        camera.target.set(0, 0, 0)
        camera.setDirty()
        await viewer.fitToView(undefined, FIT, 0.1)
    }

    if (tiles) {
        await frames(viewer, 2) // the tiles renderer picks the tiles of this view on render
        await new Promise<void>(resolve => {
            const timeout = setTimeout(done, 60_000)
            function done() {
                clearTimeout(timeout)
                tiles!.removeEventListener('tiles-load-end', check)
                resolve()
            }
            function check() {
                if (tiles!.loadProgress >= 1) done()
            }
            tiles.addEventListener('tiles-load-end', check)
            check()
        })
    }

    if (ground.visible) { // the model turned it on
        const baked = new Promise<void>(resolve => {
            if (!ground.shadowBaker || !ground.bakedShadows) return resolve()
            ground.shadowBaker.addEventListener('shadowBaked' as any, () => resolve())
        })
        ground.bakeShadows()
        await Promise.race([baked, new Promise(resolve => setTimeout(resolve, 10_000))])
    }

    const progressive = viewer.getPlugin(ProgressivePlugin)!
    progressive.maxFrameCount = 64
    await frames(viewer, 72) // the samples converge, textures are uploaded
    const still = await viewer.getScreenshotBlob({mimeType: 'image/png'})
    if (!still) throw new Error('no screenshot')
    const hasBackground = !!(viewer.scene.background || viewer.scene.backgroundColor)

    // the frames go to the script that opened this page, which encodes them; with no script there is no video
    const sendFrame = (window as any).__frame as undefined | ((name: string, data: string) => Promise<void>)
    let frameCount = 0
    const animated = animation.animationDuration > 0
    if (videoSeconds > 0 && sendFrame) {
        viewer.renderManager.renderScale = VIDEO_SCALE
        recorder.mimeType = 'image/png'
        recorder.endPaddingMs = 0 // the video loops
        recorder.frameSink = async({blob, name}) => {
            frameCount++
            await sendFrame(name, await toDataUrl(blob))
        }
        recorder.videoFrameRate = 24
        recorder.convergeMode = true
        progressive.maxFrameCount = 8
        // the clips to play and how long they are, from the catalog; without them, all
        const clips = query.get('play') ? JSON.parse(query.get('play')!) as string[] : undefined
        const clipSeconds = parseFloat(query.get('playSeconds') ?? '') || animation.animationDuration / 1000
        const seconds = animated ? Math.min(8, Math.max(videoSeconds, clipSeconds)) : videoSeconds
        // a full turn, or a small one inside a room, where a full turn would go through the walls
        await recorder.recordCamera360(seconds, false, view?.inside ? INSIDE_ARC : 360, undefined, animated ? () => void (clips ? animation.playClips(clips) : animation.playAnimation()) : undefined)
    }
    const gl = viewer.renderManager.webglRenderer.getContext()
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    return {still: await toDataUrl(still), frames: frameCount, hasBackground, hasView: !!view, animated, renderer, stats: tiles || kind !== 'model' ? undefined : measure(viewer.scene.modelRoot)}
}

(window as any).__render = render().catch(e => ({error: String(e?.stack ?? e)}))
