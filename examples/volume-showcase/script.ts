import {
    _testFinish,
    _testStart,
    DirectionalLight2,
    GBufferPlugin,
    LoadingScreenPlugin,
    ProgressivePlugin,
    ThreeViewer,
    UiObjectConfig,
} from 'threepipe'
import {NRRDLoadPlugin, VolumeObject, VolumeRenderMode, VolumeShading} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, GBufferPlugin, NRRDLoadPlugin],
})

// The scan stores Hounsfield units + 1024 (air is 0, water 1024), so the CT presets, made in Hounsfield units, are
// moved up by 1024.
const hu = 1024

interface Look {
    label: string
    mode: VolumeRenderMode
    preset: string
    shading: VolumeShading
    density?: number
    iso?: number
}

const looks: Look[] = [
    {label: 'Bones', mode: 'composite', preset: 'CT-Bone', shading: 'hybrid', density: 2},
    {label: 'Vessels and organs', mode: 'composite', preset: 'CT-AAA', shading: 'hybrid', density: 1.5},
    {label: 'Muscle', mode: 'composite', preset: 'CT-Muscle', shading: 'hybrid', density: 1.2},
    {label: 'Skin', mode: 'iso', preset: 'CT-Soft-Tissue', shading: 'surface', iso: hu - 350},
    {label: 'X-ray', mode: 'xray', preset: 'CT-X-ray', shading: 'none'},
    {label: 'Maximum intensity', mode: 'mip', preset: 'colormap:inferno', shading: 'none'},
]

const state = {look: 'Bones', cut: 0, sweep: true, turn: true, shadows: true}
let scan: VolumeObject
let light: DirectionalLight2

function applyLook() {
    const look = looks.find(l => l.label === state.look) ?? looks[0]
    const m = scan.material
    m.mode = look.mode
    m.setPreset(look.preset)
    if (look.preset.startsWith('CT-')) m.range.set(m.range.x + hu, m.range.y + hu)
    else m.range.set(hu - 100, hu + 600) // the colour map over soft tissue to bone
    m.shading = look.shading
    m.density = look.density ?? 1
    if (look.iso !== undefined) m.isoValue = look.iso
    m.shadows = state.shadows
    viewer.setDirty()
}

function applyCut() {
    // the crop box is in texture coordinates; texture y runs from the back of the patient to the front
    scan.material.cropMax.y = 1 - state.cut * 0.6
    scan.material.setDirty()
    viewer.setDirty()
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_09_1k.hdr', {setBackground: false})
    viewer.scene.setBackgroundColor('#101216')

    light = new DirectionalLight2('#fff6ea', 3)
    light.castShadow = true // the volume takes its shadows from this light
    light.position.set(2, 3, 2.5)
    light.lookAt(0, 0, 0)
    viewer.scene.addObject(light)

    // An abdominal CT scan (256 x 256 x 113 voxels, 16 bit) from the three.js examples
    scan = (await viewer.load<VolumeObject>('https://threejs.org/examples/models/nrrd/I.nrrd', {autoCenter: true, autoScale: true}))!
    if (!scan) throw new Error('The volume did not load')
    // The file is in LPS space: voxel x to the patient's left, y to the front, z down. A quarter turn about X puts
    // the head up and the face toward +z.
    scan.rotation.x = Math.PI / 2
    scan.setDirty({change: 'rotation'})
    const m = scan.material
    m.ambientOcclusion = true
    m.aoRadius = 6
    m.samplingRate = 1.5
    m.roughness = 0.45
    applyLook()

    viewer.scene.mainCamera.position.set(1.6, 0.5, 2.4)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    // the camera turns, not the volume, so the light stays where it is relative to the scan and its shadows are kept
    const controls = viewer.scene.mainCamera.controls as any
    controls.autoRotate = state.turn
    controls.autoRotateSpeed = 0.8

    let time = 0
    viewer.addEventListener('preFrame', (e: any) => {
        const dt = e.deltaTime ?? 16
        if (state.sweep) {
            time += dt * 0.0004
            state.cut = 0.5 - 0.5 * Math.cos(time)
            applyCut()
        }
    })

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Look', property: [state, 'look'], children: looks.map(l => ({label: l.label})), onChange: applyLook},
        {type: 'slider', label: 'Cut away', property: [state, 'cut'], bounds: [0, 1], stepSize: 0.01, onChange: () => {
            state.sweep = false
            applyCut()
        }},
        {type: 'checkbox', label: 'Sweep the cut', property: [state, 'sweep']},
        {type: 'checkbox', label: 'Turn', icon: 'rotate-3d', property: [state, 'turn'], onChange: () => controls.autoRotate = state.turn},
        {type: 'checkbox', label: 'Shadows', property: [state, 'shadows'], onChange: applyLook},
    ]
    createExampleCard(viewer, {
        description: 'A CT scan of the abdomen with the CT presets from VolView: bones, vessels, muscle, skin as an isosurface, x-ray and maximum intensity. Lit by the scene, with self shadows and ambient occlusion. A crop sweeps through the front of the body.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
