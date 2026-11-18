import {
    _testFinish, _testStart,
    CameraView,
    CameraViewPlugin,
    CanvasRecorderPlugin,
    DirectoryFrameSink,
    FileTransferPlugin,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PopmotionPlugin,
    ProgressivePlugin,
    ThreeViewer,
    TorusKnotGeometry,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, ProgressivePlugin, PopmotionPlugin, FileTransferPlugin, CameraViewPlugin],
    })

    // Records the canvas to MP4 (ffmpeg.js), WebM/MP4 (MediaRecorder, mimeType 'auto') or an image sequence.
    // In converge mode, a frame is captured after the ProgressivePlugin converges and the animations step 1/videoFrameRate per frame.
    const recorder = viewer.addPluginSync(CanvasRecorderPlugin)
    const popmotion = viewer.getPlugin(PopmotionPlugin)!

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const mesh = viewer.scene.addObject(new Mesh(
        new TorusKnotGeometry(0.6, 0.2, 128, 32),
        new PhysicalMaterial({color: 0x4488ff, roughness: 0.2, metalness: 0.5}),
    ))

    const cameraViews = viewer.getPlugin(CameraViewPlugin)!
    cameraViews.addView(new CameraView('front', new Vector3(0, 0, 5), new Vector3(0, 0, 0)))
    cameraViews.addView(new CameraView('top', new Vector3(0, 5, 0.01), new Vector3(0, 0, 0)))

    // rotates the mesh once in `duration` ms
    const spin = async(duration: number) => popmotion.animateAsync({
        from: 0,
        to: Math.PI * 2,
        duration,
        onUpdate: (v) => {
            mesh.rotation.y = v
            mesh.setDirty?.()
        },
    })

    createSimpleButtons({
        ['Record turntable (MP4, converge mode)']: async(btn) => {
            btn.disabled = true
            recorder.mimeType = 'video/mp4'
            recorder.convergeMode = true
            await recorder.download360Recording(2) // 2 seconds, prompts for the file name
            btn.disabled = false
        },
        ['Record animation (MP4, converge mode)']: async(btn) => {
            btn.disabled = true
            recorder.mimeType = 'video/mp4'
            recorder.convergeMode = true
            const blob = await recorder.record(async() => spin(2000))
            if (blob) await viewer.exportBlob(blob, 'animation.mp4')
            btn.disabled = false
        },
        ['Record animation (auto video, real time)']: async(btn) => {
            btn.disabled = true
            recorder.mimeType = 'auto' // MediaRecorder, the browser picks the format
            recorder.convergeMode = false
            const blob = await recorder.record(async() => spin(2000))
            if (blob) await viewer.exportBlob(blob, 'animation.' + (blob.type.split(';')[0].split('/').pop() || 'webm'))
            btn.disabled = false
        },
        ['Record camera views (MP4, converge mode)']: async(btn) => {
            btn.disabled = true
            recorder.mimeType = 'video/mp4'
            recorder.convergeMode = true
            await cameraViews.recordAllViews() // prompts for the file name
            btn.disabled = false
        },
        // a folder the user picks: only in Chromium, on a page that isn't sandboxed. Elsewhere (Safari, Firefox, this
        // preview's sandboxed page) the recording fails, and the plugin's toast says why (recorder.toastErrors)
        ['Record PNG frames to a folder']: async(btn) => {
            btn.disabled = true
            const sink = recorder.frameSink
            recorder.mimeType = 'image/png'
            recorder.convergeMode = true
            recorder.frameSink = new DirectoryFrameSink()
            try {
                await recorder.record(async() => spin(1000))
            } catch (e) {
                console.warn('Canvas recorder example: no recording', e)
            } finally {
                recorder.frameSink = sink
                btn.disabled = false
            }
        },
    })

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    ui.setupPluginUi(CanvasRecorderPlugin, {expanded: true})
    ui.setupPluginUi(CameraViewPlugin)

    // An app can change any plugin's toast in one place, by wrapping the viewer's dialog (after the UI plugin, which
    // sets its own). Here a recorder error keeps its message and gets a Report button (ts-browser-helpers 0.24).
    const dialog = ThreeViewer.Dialog
    ThreeViewer.Dialog = {...dialog, toast: (message, options) => dialog.toast?.(message, options?.source !== CanvasRecorderPlugin.PluginType ? options : {
        ...options,
        action: {label: 'Report', onClick: () => void dialog.alert('Report: an app would open its feedback form here, with the error: ' + String((options.error as Error | undefined)?.message ?? options.error))},
    })}

}

_testStart()
init().finally(_testFinish)
