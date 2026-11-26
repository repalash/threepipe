import {
    _testFinish,
    _testStart,
    GBufferPlugin,
    getUrlQueryParam,
    LoadingScreenPlugin,
    PickingPlugin,
    ProgressivePlugin,
    REVISION,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    TonemapPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// The lab of one threepipe build: index.html maps `threepipe` and `@threepipe/plugin-tweakpane` to the version in the
// query (`?lane=r172` for the lane's dist-tag, or `?threepipe=<version>`), so the same page loads any release candidate
// and the released version (`?threepipe=latest`). Load the test files below and compare with the released version
// (`?compare=1&threepipe=<version>`).

const SAMPLES = 'https://samples.threepipe.org/'
const MODELS: [string, string][] = [
    ['Damaged Helmet (glTF)', SAMPLES + 'minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'],
    ['Kira (glb, skinned)', SAMPLES + 'demos/kira.glb'],
    ['Classic watch (glb)', SAMPLES + 'demos/classic-watch.glb'],
    ['Horse (glb, morph targets)', SAMPLES + 'minimal/Horse.glb'],
    ['Spec-gloss vs metal-rough (glb)', SAMPLES + 'tests/SpecGlossVsMetalRough.glb'],
]
const ENVIRONMENTS: [string, string][] = [
    ['Venice sunset', SAMPLES + 'minimal/venice_sunset_1k.hdr'],
    ['Empty warehouse', SAMPLES + 'minimal/empty_warehouse_01_1k.hdr'],
    ['Studio small 03', SAMPLES + 'minimal/studio_small_03_1k.hdr'],
]

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true,
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin, PickingPlugin, GBufferPlugin, ProgressivePlugin, SSAAPlugin, SSAOPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(window.parent === window ? undefined : false)) // collapsed in the compare frames
    ui.setupPlugins(TonemapPlugin, ProgressivePlugin, SSAAPlugin, SSAOPlugin, PickingPlugin)

    const params = new URLSearchParams(location.search)
    const model = getUrlQueryParam('m') ?? MODELS[0][1]
    const env = getUrlQueryParam('env') ?? ENVIRONMENTS[0][1]
    labBar(viewer, params, model, env)

    await viewer.setEnvironmentMap(env, {setBackground: getUrlQueryParam('bg') !== 'false'})
    await viewer.load(model, {autoCenter: true, autoScale: true})

    followCamera(viewer)
}

// Top bar: the loaded versions, the test files and links back to the overview.
function labBar(viewer: ThreeViewer, params: URLSearchParams, model: string, env: string) {
    const bar = document.createElement('div')
    bar.id = 'lab-bar'
    const spec = params.get('threepipe') || 'three-' + params.get('lane')
    bar.innerHTML = `<b>threepipe ${ThreeViewer.VERSION}</b> <span class="muted">(three r${REVISION}, from <code>${spec}</code>)</span>`
    const select = (items: [string, string][], current: string, key: string) => {
        const s = document.createElement('select')
        const known = items.some(([, url]) => url === current)
        for (const [label, url] of known ? items : [...items, ['Custom', current] as [string, string]]) {
            const o = document.createElement('option')
            o.value = url
            o.textContent = label
            o.selected = url === current
            s.appendChild(o)
        }
        s.onchange = () => {
            const q = new URLSearchParams(location.search)
            q.set(key, s.value)
            location.search = q.toString()
        }
        return s
    }
    bar.appendChild(select(MODELS, model, 'm'))
    bar.appendChild(select(ENVIRONMENTS, env, 'env'))
    if (window.parent === window) {
        const links = document.createElement('span')
        const cmp = new URLSearchParams(params)
        cmp.set('compare', '1')
        links.innerHTML = `<a href="?${cmp}">Compare with latest</a> · <a href="?">All lanes</a>`
        bar.appendChild(links)
    }
    document.body.appendChild(bar)
    viewer.addEventListener('dispose', () => bar.remove())
}

// In the compare mode the two labs keep the same view: each posts its camera when it moves, and applies the other's.
function followCamera(viewer: ThreeViewer) {
    if (window.parent === window) return
    const camera = viewer.scene.mainCamera
    let applying = false
    camera.addEventListener('cameraUpdate', () => {
        if (applying) return
        window.parent.postMessage({
            type: 'lane-lab-camera',
            position: camera.position.toArray(),
            target: camera.target.toArray(),
            zoom: camera.zoom,
        }, '*')
    })
    window.addEventListener('message', (e) => {
        if (e.data?.type !== 'lane-lab-camera') return
        applying = true
        const controls = camera.controls as {stopDamping?: () => void} | undefined
        controls?.stopDamping?.() // leftover damping would move the camera away from the other lab's view
        camera.position.fromArray(e.data.position)
        camera.target.fromArray(e.data.target)
        const zoomChanged = camera.zoom !== e.data.zoom
        camera.zoom = e.data.zoom
        camera.setDirty(zoomChanged ? {change: 'zoom'} : undefined)
        applying = false
    })
}

_testStart()
init().finally(_testFinish)
