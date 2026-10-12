import {
    _testFinish,
    _testStart,
    DirectionalLight2,
    HemisphereLight2,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PlaneGeometry,
    PopmotionPlugin,
    ProgressivePlugin,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {CanvasRecorderPlugin} from '@threepipe/plugin-canvas-recorder'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        backgroundColor: '#22252b',
        plugins: [LoadingScreenPlugin, ProgressivePlugin],
    })
    const popmotion = viewer.addPluginSync(PopmotionPlugin)
    const recorder = viewer.addPluginSync(CanvasRecorderPlugin)

    // A small animated scene
    viewer.scene.addObject(new HemisphereLight2(0xffffff, 0x444466, 2))
    const light = viewer.scene.addObject(new DirectionalLight2(0xffffff, 3))
    light.position.set(3, 5, 2)
    light.lookAt(0, 0, 0)
    light.castShadow = true
    light.shadowMapSize.setScalar(1024)
    light.shadowFrustum = 6

    const knot = viewer.scene.addObject(new Mesh(
        new TorusKnotGeometry(0.6, 0.2, 200, 32),
        new PhysicalMaterial({color: '#ff7043', roughness: 0.3}),
    ))
    knot.castShadow = true
    const colors = ['#4fc3f7', '#aed581', '#ffd54f']
    const spheres = colors.map(color => {
        const sphere = viewer.scene.addObject(new Mesh(
            new SphereGeometry(0.2, 32, 16),
            new PhysicalMaterial({color, roughness: 0.2}),
        ))
        sphere.castShadow = true
        return sphere
    })
    const ground = viewer.scene.addObject(new Mesh(
        new PlaneGeometry(100, 100).rotateX(-Math.PI / 2).translate(0, -1.2, 0),
        new PhysicalMaterial({color: '#ffffff', roughness: 0.8}),
    ))
    ground.receiveShadow = true

    viewer.scene.mainCamera.position.set(0, 1.5, 5)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    // PopmotionPlugin animations advance by exactly 1/fps per captured frame while recording frame-exact
    const startAnimation = () => popmotion.animate({
        from: 0,
        to: 1,
        duration: 4000,
        repeat: Infinity,
        ease: (t: number) => t,
        onUpdate: (v: number) => {
            const a = v * Math.PI * 2
            knot.rotation.set(a, 2 * a, 0)
            knot.setDirty?.()
            spheres.forEach((sphere, i) => {
                const b = a + i * Math.PI * 2 / 3
                sphere.position.set(Math.cos(b) * 1.8, Math.sin(2 * b) * 0.4, Math.sin(b) * 1.8)
                sphere.setDirty?.()
            })
        },
    })
    let animation = startAnimation()

    const status = document.getElementById('recorder-status')!
    recorder.addEventListener('start', (e) => {
        status.textContent = `recording: ${e.mode} ${e.width}x${e.height} ${e.fps}fps ${e.codec ?? ''}`
    })
    recorder.addEventListener('progress', (e) => {
        status.textContent = `recording: frame ${e.frame}${e.frames ? ' / ' + e.frames : ''}, ${e.time.toFixed(2)}s`
    })
    recorder.addEventListener('stop', (e) => {
        status.textContent = e.cancelled ? 'cancelled' :
            `done: ${e.frames} frames${e.blob ? `, ${(e.blob.size / 1e6).toFixed(2)} MB ${e.blob.type}` : ''}`
    })
    recorder.addEventListener('error', (e) => {
        status.textContent = 'error: ' + ((e.error as Error)?.message ?? e.error)
    })

    const run = (fn: () => Promise<unknown>) => async() => {
        try {
            await fn()
        } catch (e) {
            console.error(e)
        }
    }

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild({
        type: 'folder',
        label: 'Example recordings',
        expanded: true,
        children: [{
            // Frame-exact video with WebCodecs (H.264 MP4, or VP9/AV1 in MP4 when H.264 is not available)
            type: 'button',
            label: 'Record 3s video (frame-exact)',
            value: run(async() => recorder.recordDuration(3, {mode: 'video', fps: 60})),
        }, {
            // Frame-exact PNG frames in a zip file
            type: 'button',
            label: 'Record 1s PNG sequence (zip)',
            value: run(async() => recorder.recordDuration(1, {mode: 'images', fps: 30, imageFormat: 'image/png'})),
        }, {
            // Camera turntable of the static scene, every frame converged with ProgressivePlugin
            type: 'button',
            label: 'Record turntable (converged)',
            value: run(async() => {
                animation.stop()
                try {
                    await recorder.recordTurntable({duration: 4, angle: 360, fps: 30, converge: true, convergeFrames: 16})
                } finally {
                    animation = startAnimation()
                }
            }),
        }, {
            // Real-time MediaRecorder (the fallback mode)
            type: 'button',
            label: 'Record 3s real-time (MediaRecorder)',
            value: run(async() => recorder.recordDuration(3, {mode: 'realtime', fps: 60})),
        }],
    })
    ui.setupPluginUi(CanvasRecorderPlugin, {expanded: true})
    ui.setupPluginUi(ProgressivePlugin)

}

_testStart()
init().finally(_testFinish)
