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
import {generateVolume, VolumeObject, VolumePlugin} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    // tricubic sampling, shadows and SSAO are slow on the software renderer of the screenshot tests
    renderScale: window.TESTING ? 0.5 : 'auto',
    // the isosurface goes into the G-buffer, so SSAO darkens its creases like a mesh
    plugins: [LoadingScreenPlugin, ProgressivePlugin, VolumePlugin, GBufferPlugin, SSAOPlugin],
})

// The Mandelbulb: points c whose orbit under z -> z^power + c (in spherical coordinates) stays bounded. Inside is 1;
// outside, the distance estimate of the escaped orbit gives 0.5 on the surface, falling off outside. The estimate is
// only valid for orbits that escaped, so a point still bounded after the last iteration counts as inside.
const mandelbulbGLSL = /* glsl */`
uniform float uPower;
float density(vec3 p) {
    vec3 c = (p - 0.5) * 2.6;
    vec3 z = c;
    float dr = 1.0;
    for (int i = 0; i < 8; i++) {
        float r = length(z);
        if (r > 2.0) {
            float dist = 0.5 * log(r) * r / dr;
            return 0.5 * exp(-dist * 30.0);
        }
        float theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0)) * uPower;
        float phi = atan(z.y, z.x) * uPower;
        dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
        z = pow(r, uPower) * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + c;
    }
    return 1.0;
}
`

const state = {power: 8, look: 'surface' as 'surface' | 'ice', rotate: !window.TESTING, lightAngle: 50}
let bulb: VolumeObject
let key: DirectionalLight2
let powerTimer: ReturnType<typeof setTimeout> | undefined

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
    const tf = m.transferFunction
    m.range.set(0, 1)
    if (state.look === 'surface') {
        // the first crossing of 0.5: the surface, shaded and shadowed like a mesh, in the G-buffer for SSAO
        m.mode = 'iso'
        m.isoValue = 0.5
        m.shading = 'surface'
        m.shadows = true
        tf.colorPoints = [[0, 0.55, 0.36, 0.2], [1, 0.55, 0.36, 0.2]]
    } else {
        // only a thin shell at the surface is opaque, so the layers behind show through it
        m.mode = 'composite'
        m.shading = 'surface'
        m.shadows = false
        tf.colorPoints = [[0, 0.1, 0.5, 1], [0.45, 0.2, 0.7, 1], [0.5, 0.9, 0.95, 1], [1, 1, 1, 1]]
        tf.opacityPoints = [[0, 0], [0.38, 0], [0.48, 0.25], [0.55, 0.25], [0.7, 0], [1, 0]]
    }
    tf.setDirty()
    const a = state.lightAngle * Math.PI / 180
    key.position.set(Math.cos(a) * 3, 2.5, Math.sin(a) * 3)
    key.lookAt(0, 0, 0)
    key.setDirty()
    viewer.setDirty()
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_06_1k.hdr', {setBackground: false})
    viewer.scene.setBackgroundColor('#0d0e12')
    viewer.scene.envMapIntensity = 0.35
    key = new DirectionalLight2('#fff4e6', 3)
    key.castShadow = true // the bulb shadows itself from this light
    viewer.scene.addObject(key)

    makeBulb()
    const m = bulb.material
    m.sampling = 'cubic' // smooth surface and normals from 256³ voxels
    m.roughness = 0.3
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
            // a new volume takes about a quarter of a second: make it once the slider rests
            clearTimeout(powerTimer)
            powerTimer = setTimeout(() => {
                makeBulb()
                viewer.setDirty()
            }, 150)
        }},
        {type: 'dropdown', label: 'Look', property: [state, 'look'], children: [['surface', 'Surface'], ['ice', 'Ice']].map(([value, label]) => ({label, value})), onChange: applyLook},
        {type: 'slider', label: 'Light angle', property: [state, 'lightAngle'], bounds: [0, 360], stepSize: 1, onChange: applyLook},
        {type: 'checkbox', label: 'Turn', icon: 'rotate-3d', property: [state, 'rotate'], onChange: () => controls.autoRotate = state.rotate},
    ]
    createExampleCard(viewer, {
        description: 'The Mandelbulb fractal computed on the GPU into a 256³ volume in a quarter of a second: an isosurface with tricubic smoothing, scene lighting, self shadows, ambient occlusion and SSAO, or a shell of ice. Change the power to morph it.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
