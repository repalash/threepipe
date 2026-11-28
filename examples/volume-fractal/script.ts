import {
    _testFinish,
    _testStart,
    DirectionalLight2,
    GBufferPlugin,
    LoadingScreenPlugin,
    ProgressivePlugin,
    SSAOPlugin,
    ThreeViewer,
    UiObjectConfig,
} from 'threepipe'
import {generateVolume, VolumeObject, VolumeRenderMode} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    // the isosurface goes into the G-buffer, so SSAO darkens its creases like a mesh
    plugins: [LoadingScreenPlugin, ProgressivePlugin, GBufferPlugin, SSAOPlugin],
})

// The Mandelbulb: how fast the point escapes under z -> z^power + c in spherical coordinates, as a smooth value
// (1 inside, falling off outside), so the isosurface is the fractal's surface.
const mandelbulbGLSL = /* glsl */`
uniform float uPower;
float density(vec3 p) {
    vec3 c = (p - 0.5) * 2.6;
    vec3 z = c;
    float r = 0.0;
    float dr = 1.0;
    for (int i = 0; i < 12; i++) {
        r = length(z);
        if (r > 2.0) break;
        float theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0)) * uPower;
        float phi = atan(z.y, z.x) * uPower;
        dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
        float zr = pow(r, uPower);
        z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + c;
    }
    // distance estimate, turned into a value that is 0.5 on the surface
    float dist = 0.5 * log(max(r, 1e-6)) * r / dr;
    return clamp(0.5 - dist * 6.0, 0.0, 1.0);
}
`

const state = {power: 8, mode: 'iso' as VolumeRenderMode, rotate: true, lightAngle: 50}
let bulb: VolumeObject
let key: DirectionalLight2

function makeBulb() {
    const data = generateVolume(viewer.renderManager.webglRenderer, {
        size: [256, 256, 256],
        glsl: mandelbulbGLSL,
        uniforms: {uPower: {value: state.power}},
        precision: 'float',
        name: 'mandelbulb',
        units: 'm',
    })
    if (!bulb) {
        bulb = new VolumeObject(data, {unitScale: 2 / 256})
        bulb.rotation.x = -Math.PI / 2 // the bulb's axis up
        viewer.scene.addObject(bulb)
    } else {
        const old = bulb.data
        bulb.addField(data) // replaces the field of the same name
        old?.dispose() // frees its texture and what the material built for it
    }
}

function applyLook() {
    const m = bulb.material
    m.mode = state.mode
    m.range.set(0, 1)
    if (state.mode === 'iso') {
        m.isoValue = 0.5
        m.transferFunction.colorPoints = [[0, 0.95, 0.72, 0.42], [1, 0.95, 0.72, 0.42]]
    } else {
        // glowing shells of the escape value
        m.transferFunction.colorPoints = [[0, 0.05, 0.1, 0.4], [0.35, 0.1, 0.6, 1], [0.5, 1, 0.8, 0.4], [0.62, 1, 1, 1]]
        m.transferFunction.opacityPoints = [[0, 0], [0.3, 0], [0.45, 0.1], [0.5, 0.6], [0.55, 1]]
    }
    m.transferFunction.setDirty()
    const a = state.lightAngle * Math.PI / 180
    key.position.set(Math.cos(a) * 3, 2.5, Math.sin(a) * 3)
    key.lookAt(0, 0, 0)
    key.setDirty()
    viewer.setDirty()
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_06_1k.hdr', {setBackground: false})
    viewer.scene.setBackgroundColor('#0d0e12')
    key = new DirectionalLight2('#fff4e6', 3.5)
    key.castShadow = true // the bulb shadows itself from this light
    viewer.scene.addObject(key)

    makeBulb()
    const m = bulb.material
    m.sampling = 'cubic' // smooth surface and normals from 256³ voxels
    m.shading = 'surface'
    m.roughness = 0.35
    m.specular = 1.4
    m.shadows = true
    m.ambientOcclusion = true
    m.aoRadius = 6
    m.samplingRate = 1.5
    m.lightingResolution = 0.5
    applyLook()

    viewer.scene.mainCamera.position.set(1.8, 1.0, 2.2)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    // the camera turns, not the volume, so the light stays where it is relative to the bulb and its shadows are kept
    const controls = viewer.scene.mainCamera.controls as any
    controls.autoRotate = state.rotate
    controls.autoRotateSpeed = 1

    const actions: UiObjectConfig[] = [
        {type: 'slider', label: 'Power', property: [state, 'power'], bounds: [2, 12], stepSize: 0.5, onChange: () => {
            makeBulb()
            viewer.setDirty()
        }},
        {type: 'dropdown', label: 'Look', property: [state, 'mode'], children: [['iso', 'Surface'], ['composite', 'Glow']].map(([value, label]) => ({label, value})), onChange: applyLook},
        {type: 'slider', label: 'Light angle', property: [state, 'lightAngle'], bounds: [0, 360], stepSize: 1, onChange: applyLook},
        {type: 'checkbox', label: 'Turn', icon: 'rotate-3d', property: [state, 'rotate'], onChange: () => controls.autoRotate = state.rotate},
    ]
    createExampleCard(viewer, {
        description: 'The Mandelbulb fractal computed on the GPU into a 256³ volume, shown as an isosurface with tricubic smoothing, scene lighting, self shadows, ambient occlusion and SSAO from the G-buffer. Change the power to morph it.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
