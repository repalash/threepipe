import {
    _testFinish,
    _testStart,
    AgXToneMapping,
    DirectionalLight2,
    LoadingScreenPlugin,
    ProgressivePlugin,
    ThreeViewer,
    TonemapPlugin,
    UiObjectConfig,
    VignettePlugin,
} from 'threepipe'
import {BloomPlugin} from '@threepipe/webgi-plugins'
import {NRRDLoadPlugin, VolumeObject, VolumeRenderMode, VolumeShading} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    // heavy for the software renderer of the screenshot tests
    renderScale: window.TESTING ? 0.5 : 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, NRRDLoadPlugin, VignettePlugin, BloomPlugin],
})

// Transfer functions over Hounsfield units: [HU, r, g, b] colours and [HU, opacity] points
interface Look {
    label: string
    mode: VolumeRenderMode
    shading: VolumeShading
    colors: number[][]
    opacities: number[][]
    iso?: number
    density?: number
    intensity?: number
}

const looks: Look[] = [
    {
        // a faint glass of skin over red contrast-filled vessels and ivory bone
        label: 'Cinematic', mode: 'composite', shading: 'hybrid',
        colors: [[-1024, 0, 0, 0], [-250, 0.9, 0.55, 0.45], [-30, 0.9, 0.6, 0.5], [120, 0.55, 0.05, 0.04], [260, 0.85, 0.12, 0.08], [420, 0.95, 0.85, 0.7], [2000, 1, 0.97, 0.9]],
        opacities: [[-1024, 0], [-300, 0], [-200, 0.015], [-60, 0.015], [-20, 0], [130, 0], [220, 0.35], [400, 0.7], [2000, 0.9]],
    },
    {
        // unlit and translucent: the vessels and the bone (which share the range around 300 HU) as glowing glass
        label: 'Glass', mode: 'composite', shading: 'none', intensity: 2.2,
        colors: [[-1024, 0, 0, 0], [150, 0.6, 0.05, 0.05], [280, 1, 0.3, 0.15], [420, 1, 0.75, 0.5], [2000, 0.5, 0.55, 0.65]],
        opacities: [[-1024, 0], [140, 0], [220, 0.12], [380, 0.3], [480, 0.02], [2000, 0.02]],
    },
    {
        // the first crossing of -300 HU, between air and skin
        label: 'Skin', mode: 'iso', shading: 'surface', iso: -300,
        colors: [[-1024, 0.82, 0.58, 0.48], [2000, 0.82, 0.58, 0.48]],
        opacities: [[-1024, 1], [2000, 1]],
    },
    {
        label: 'X-ray', mode: 'xray', shading: 'none', density: 0.25,
        colors: [[-1024, 1, 1, 1], [2000, 1, 1, 1]],
        opacities: [[-1024, 0], [-200, 0], [1500, 0.05], [2000, 0.05]],
    },
    {
        label: 'Maximum intensity', mode: 'mip', shading: 'none',
        colors: [[-1024, 0, 0, 0], [0, 0.05, 0.02, 0.15], [200, 0.55, 0.1, 0.45], [450, 1, 0.45, 0.1], [1200, 1, 0.95, 0.75]],
        opacities: [[-1024, 0], [2000, 1]],
    },
]

// the turn is off in the screenshot tests (window.TESTING), which need a still image
const state = {look: looks[0].label, cut: 0, turn: !window.TESTING, shadows: true}
let scan: VolumeObject

const huRange = [-1024, 2000]
const t = (hu: number) => (hu - huRange[0]) / (huRange[1] - huRange[0])

function applyLook() {
    const look = looks.find(l => l.label === state.look) ?? looks[0]
    const m = scan.material
    const tf = m.transferFunction
    tf.colorPoints = look.colors.map(([hu, r, g, b]) => [t(hu), r, g, b])
    tf.opacityPoints = look.opacities.map(([hu, a]) => [t(hu), a])
    tf.setDirty()
    m.range.set(huRange[0], huRange[1])
    m.mode = look.mode
    m.shading = look.shading
    m.density = look.density ?? 1
    m.intensity = look.intensity ?? 1
    if (look.iso !== undefined) m.isoValue = look.iso
    m.shadows = state.shadows
    viewer.setDirty()
}

function applyCut() {
    // a cut through the middle of the head, from the patient's left (texture x runs to the left)
    scan.material.cropMax.x = 0.82 - state.cut * 0.32
    scan.material.setDirty({needsUpdate: false, refreshUi: false}) // a uniform: no shader change
    viewer.setDirty()
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_09_1k.hdr', {setBackground: false})
    viewer.scene.environmentIntensity = 0.2 // a dark fill: the key and the rim light shape the head
    viewer.scene.setBackgroundColor('#0b0c10')
    const tonemap = viewer.getPlugin(TonemapPlugin)!
    tonemap.toneMapping = AgXToneMapping
    tonemap.contrast = 1.15
    viewer.getPlugin(VignettePlugin)!.power = 0.6
    const bloom = viewer.getPlugin(BloomPlugin)!
    bloom.pass!.threshold = 1.1
    bloom.pass!.intensity = 0.25

    // a warm key light from above and the front, which the volume takes its shadows from, and a cool rim light behind
    const key = new DirectionalLight2('#fff1e0', 6)
    key.castShadow = true
    key.position.set(-2.5, 2.5, 2)
    key.lookAt(0, 0, 0)
    viewer.scene.addObject(key)
    const rim = new DirectionalLight2('#9fc3ff', 4)
    rim.position.set(2, 1, -3)
    rim.lookAt(0, 0, 0)
    viewer.scene.addObject(rim)

    // CT angiography of the head and neck (VolView sample data, 256 x 256 x 295 voxels after a 2x downsampling in
    // plane, Hounsfield units), hosted on threepipe cloud
    scan = (await viewer.load<VolumeObject>('https://files.threepipe.org/p/volume-samples/cta-head-neck.nrrd', {autoCenter: true, autoScale: true}))!
    if (!scan) throw new Error('The volume did not load')
    // LPS: voxel x to the patient's left, y to the back, z up. A quarter turn about X puts the head up and the face
    // toward +z.
    scan.rotation.x = -Math.PI / 2
    scan.setDirty({change: 'rotation'})
    const m = scan.material
    // crop off the head holder of the scanner, around the back and the sides of the head
    m.cropMin.set(0.16, 0, 0)
    m.cropMax.set(0.82, 0.88, 1)
    m.ambientOcclusion = true
    m.aoRadius = 12
    m.gradientFactor = 30
    m.roughness = 0.4
    // smooth bone: linear interpolation shows the slices as rings in the shading. (Linear and fewer samples in the
    // screenshot tests, on a software renderer.)
    m.sampling = window.TESTING ? 'linear' : 'cubic'
    m.samplingRate = window.TESTING ? 1 : 2
    // the camera turns all the time: keep the quality up while it moves (the interactive rate is for slow GPUs)
    m.interactiveSamplingRate = 2
    applyLook()

    const camera = viewer.scene.mainCamera
    camera.position.set(1.4, 0.5, 2.5)
    camera.target.set(0, 0.35, 0)
    camera.setDirty()
    const controls = camera.controls as any
    controls.autoRotate = state.turn
    controls.autoRotateSpeed = 0.6

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Look', property: [state, 'look'], children: looks.map(l => ({label: l.label})), onChange: applyLook},
        {type: 'slider', label: 'Cut', property: [state, 'cut'], bounds: [0, 1], stepSize: 0.01, onChange: applyCut},
        {type: 'checkbox', label: 'Turn', icon: 'rotate-3d', property: [state, 'turn'], onChange: () => controls.autoRotate = state.turn},
        {type: 'checkbox', label: 'Shadows', property: [state, 'shadows'], onChange: applyLook},
    ]
    createExampleCard(viewer, {
        description: 'A CT angiography of the head and neck, rendered like a cinematic medical render: a glass of skin over the contrast-filled vessels and the bone, lit by a key and a rim light with shadows and ambient occlusion. Cut through the head, or switch to glass, skin, x-ray or maximum intensity.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
