// The thumbnail and video of a model, one setup for all (scripts/sample-assets/render-catalog.mjs). Set before the model
// loads: no ground and a transparent background, so a model that has its own ground or background keeps it.
import {
    Box3,
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
    PopmotionPlugin,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    TonemapPlugin,
    Vector3,
} from 'threepipe'
import {AdvancedGroundPlugin, AnisotropyPlugin, BloomPlugin, DepthOfFieldPlugin, SSContactShadowsPlugin, SSGIPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin} from '@threepipe/webgi-plugins'

const query = new URLSearchParams(location.search)
const url = query.get('m')!
const size = parseInt(query.get('size') ?? '512')
const videoSeconds = parseFloat(query.get('video') ?? '3') // 0: no video
const ENVIRONMENT = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr' // CC0, Poly Haven
const INSIDE_ARC = 8 // degrees
const FIT = 1.5 // distance to the model, as in render3d-cli
const VIDEO_BACKGROUND = 0x77777c // H.264 has no alpha: a video of a model with no background of its own gets this

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

async function render() {
    const canvas = document.getElementById('mcanvas') as HTMLCanvasElement
    canvas.style.width = canvas.style.height = size + 'px'
    const viewer = new ThreeViewer({
        canvas, msaa: false, rgbm: true, renderScale: 1,
        plugins: [GLTFMeshOptDecodePlugin, KTX2LoadPlugin, ProgressivePlugin, PopmotionPlugin, GBufferPlugin, SSAOPlugin, SSAAPlugin, VelocityBufferPlugin, TemporalAAPlugin,
            SSReflectionPlugin, SSGIPlugin, SSContactShadowsPlugin, DepthOfFieldPlugin, BloomPlugin, ChromaticAberrationPlugin, VignettePlugin, FilmicGrainPlugin,
            AnisotropyPlugin, ClearcoatTintPlugin, CustomBumpMapPlugin, NoiseBumpMaterialPlugin, ParallaxMappingPlugin, FragmentClippingExtensionPlugin],
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
    await viewer.setEnvironmentMap(ENVIRONMENT)

    // a view in the file's coordinates: the camera the file was saved with, the model's camera, or from inside a room
    const view = query.get('view') ? JSON.parse(query.get('view')!) as View : undefined
    // a saved file loads as it was saved; anything else is centered and scaled, or fitted below
    const model = await viewer.load<any>(url, view?.saved ? {} : {autoCenter: true, autoScale: true, autoScaleRadius: 1})
    if (!model) throw new Error('nothing loaded')

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
        camera.position.set(1, 0.45, 1.5)
        camera.target.set(0, 0, 0)
        camera.setDirty()
        await viewer.fitToView(undefined, FIT, 0.1)
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
    const thumb = await viewer.getScreenshotBlob({mimeType: 'image/webp', quality: 85})
    if (!thumb) throw new Error('no screenshot')

    let video: Blob | undefined
    const animated = animation.animationDuration > 0
    if (videoSeconds > 0) {
        if (viewer.scene.backgroundColor === null && !viewer.scene.background) viewer.scene.backgroundColor = VIDEO_BACKGROUND as any
        recorder.videoFrameRate = 24
        recorder.convergeMode = true
        progressive.maxFrameCount = 8
        // the clips to play and how long they are, from the catalog; without them, all
        const clips = query.get('play') ? JSON.parse(query.get('play')!) as string[] : undefined
        const clipSeconds = parseFloat(query.get('playSeconds') ?? '') || animation.animationDuration / 1000
        const seconds = animated ? Math.min(8, Math.max(videoSeconds, clipSeconds)) : videoSeconds
        // a full turn, or a small one inside a room, where a full turn would go through the walls
        video = await recorder.recordCamera360(seconds, false, view?.inside ? INSIDE_ARC : 360, undefined, animated ? () => void (clips ? animation.playClips(clips) : animation.playAnimation()) : undefined)
    }
    return {thumb: await toDataUrl(thumb), video: video && await toDataUrl(video), hasView: !!view, animated}
}

(window as any).__render = render().catch(e => ({error: String(e?.stack ?? e)}))
