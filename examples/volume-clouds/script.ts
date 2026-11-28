import {
    _testFinish,
    _testStart,
    Color,
    DirectionalLight2,
    HemisphereLight,
    LoadingScreenPlugin,
    ProgressivePlugin,
    ThreeViewer,
    UiObjectConfig,
} from 'threepipe'
import {generateVolume, VolumeObject, VolumePlugin} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, VolumePlugin],
})

// Cumulus clouds: a coverage map from fractal noise sets where clouds are and how tall they grow; each is a dome on a
// flat base, with puffs from cellular (Worley) noise on its surface. The same noise scale on every axis, though the
// box is lower than it is wide.
const cloudsGLSL = /* glsl */`
float density(vec3 p) {
    float h = p.y;
    vec3 q = vec3(p.x, h * 112.0 / 256.0, p.z);
    float coverage = smoothstep(0.36, 0.62, volFbm(vec3(p.xz * 2.2, 0.0), 5));
    coverage *= smoothstep(0.5, 0.3, length(p.xz - 0.5)); // a round patch of sky, so the box corners never show
    float base = 0.1;
    float puffs = 1.0 - volWorley(q * 10.0);
    float puffs2 = 1.0 - volWorley(q * 23.0);
    float top = base - 0.12 + 0.9 * sqrt(coverage) + 0.14 * (puffs - 0.5) + 0.06 * (puffs2 - 0.5);
    float inside = min(top - h, (h - base + 0.03 * (puffs2 - 0.5)) * 2.0);
    return smoothstep(0.0, 0.05, inside) * (0.75 + 0.25 * puffs);
}
`

const state = {timeOfDay: 0.62, turn: 35, rotate: false, shadows: true}
let clouds: VolumeObject
let sun: DirectionalLight2
let sky: HemisphereLight

const noon = new Color('#fffaf0')
const dusk = new Color('#ffb070')
const skyNoon = new Color('#5d8fd8')
const skyDusk = new Color('#3b3f6b')

function applyTime() {
    // elevation from the horizon (0) to high noon (1); the sun turns around the deck with Turn
    const e = state.timeOfDay * Math.PI * 0.45 + 0.04
    const a = state.turn * Math.PI / 180
    sun.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(4)
    sun.lookAt(0, 0, 0)
    const t = Math.min(1, state.timeOfDay * 1.6)
    sun.color.copy(dusk).lerp(noon, t)
    sun.intensity = 3 + 3 * t
    sun.setDirty()
    sky.color.copy(skyDusk).lerp(skyNoon, t)
    sky.groundColor.set('#30343c').lerp(new Color('#8a8f98'), t)
    sky.intensity = 1 + 1.6 * t
    viewer.scene.setBackgroundColor(new Color('#1c1d33').lerp(new Color('#7fb0ea'), t))
    clouds.material.shadows = state.shadows
    viewer.setDirty()
}

async function init() {
    sun = new DirectionalLight2('#ffffff', 4)
    sun.castShadow = true // the clouds shadow themselves from this light
    viewer.scene.addObject(sun)
    sky = new HemisphereLight('#5d8fd8', '#8a8f98', 1)
    viewer.scene.addObject(sky)

    const data = generateVolume(viewer.renderManager.webglRenderer, {size: [256, 112, 256], glsl: cloudsGLSL, name: 'clouds', units: 'm'})
    clouds = new VolumeObject(data, {unitScale: 4 / 256}) // a 4 x 1.75 x 4 deck
    viewer.scene.addObject(clouds)
    const m = clouds.material
    m.range.set(0, 255)
    m.transferFunction.colorPoints = [[0, 1, 1, 1], [1, 1, 1, 1]]
    m.transferFunction.opacityPoints = [[0, 0], [0.04, 0], [0.3, 0.15], [1, 0.5]]
    m.transferFunction.setDirty()
    m.density = 2.5
    m.shading = 'hybrid' // lit like a surface where the cloud is dense, scattering in its soft edges
    m.gradientFactor = 20
    m.anisotropy = 0.35 // forward scattering: brighter toward the sun
    m.ambientOcclusion = true
    m.aoRadius = 12
    m.samplingRate = 1.2

    viewer.scene.mainCamera.position.set(-2.7, 1.2, 2.9)
    viewer.scene.mainCamera.target.set(0, -0.35, 0)
    viewer.scene.mainCamera.setDirty()
    applyTime()

    viewer.addEventListener('preFrame', (e: any) => {
        if (!state.rotate) return
        state.turn = (state.turn + (e.deltaTime ?? 16) * 0.006) % 360
        applyTime()
    })

    const actions: UiObjectConfig[] = [
        {type: 'slider', label: 'Time of day', property: [state, 'timeOfDay'], bounds: [0, 1], stepSize: 0.01, onChange: applyTime},
        {type: 'slider', label: 'Sun direction', property: [state, 'turn'], bounds: [0, 360], stepSize: 1, onChange: applyTime},
        {type: 'checkbox', label: 'Sun moves', icon: 'sun', property: [state, 'rotate']},
        {type: 'checkbox', label: 'Self shadows', property: [state, 'shadows'], onChange: applyTime},
    ]
    createExampleCard(viewer, {
        description: 'Cumulus clouds made on the GPU from noise in a quarter of a second, lit by the sun and the sky, shadowing themselves. Move the sun through the day, or let it move.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
