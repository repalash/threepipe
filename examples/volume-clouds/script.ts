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
    plugins: [LoadingScreenPlugin, ProgressivePlugin],
})

// A deck of cumulus clouds: a coverage map from fractal noise, billowy shapes from cellular (Worley) noise, flat
// bottoms and rounded tops.
const cloudsGLSL = /* glsl */`
float density(vec3 p) {
    float h = p.y;
    // coverage over the deck, in patches
    float cover = smoothstep(0.42, 0.62, volFbm(vec3(p.x * 3.0, 0.0, p.z * 3.0), 5));
    // height profile: flat bottom, top that rises with the coverage
    float top = 0.25 + 0.7 * cover;
    float profile = smoothstep(0.05, 0.14, h) * smoothstep(top, top - 0.25, h);
    // billows: cellular noise at two scales eats the edges
    vec3 q = p * vec3(9.0, 7.0, 9.0);
    float billow = 1.0 - (0.65 * volWorley(q) + 0.35 * volWorley(q * 2.3));
    float d = cover * profile * smoothstep(0.25, 0.75, billow + 0.25 * volFbm(p * 20.0, 3));
    // fade at the sides of the box
    float edge = smoothstep(0.0, 0.08, min(min(p.x, 1.0 - p.x), min(p.z, 1.0 - p.z)));
    return d * edge * 1.6;
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
    sun.intensity = 2.5 + 2.5 * t
    sun.setDirty()
    sky.color.copy(skyDusk).lerp(skyNoon, t)
    sky.groundColor.set('#30343c').lerp(new Color('#8a8f98'), t)
    sky.intensity = 0.6 + 0.8 * t
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
    m.transferFunction.opacityPoints = [[0, 0], [0.08, 0], [0.3, 0.35], [1, 0.9]]
    m.transferFunction.setDirty()
    m.density = 1.4
    m.shading = 'volume'
    m.anisotropy = 0.55 // forward scattering: bright edges toward the sun
    m.ambientOcclusion = true
    m.aoRadius = 12
    m.samplingRate = 1.2
    viewer.getPlugin(VolumePlugin)!.kernelBudget = 2 ** 28

    viewer.scene.mainCamera.position.set(-3.4, 0.9, 3.6)
    viewer.scene.mainCamera.target.set(0, 0.05, 0)
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
        description: 'A deck of clouds made on the GPU from noise, lit by the sun and the sky: forward scattering gives the bright silver edges, and the clouds shadow themselves. Move the sun, or let it move.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
