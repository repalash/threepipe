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
} from 'threepipe'
import {generateVolume, VolumeObject, VolumePlugin} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    // heavy for the software renderer of the screenshot tests
    renderScale: window.TESTING ? 0.5 : 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, VolumePlugin],
})

// Cumulus clouds as a distance field: clusters of puffs (spheres joined smoothly) rising from a flat base, with
// billows (cellular noise) pushing their surface out at two scales. The same scale on every axis, though the box is
// lower than it is wide.
const cloudsGLSL = /* glsl */`
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
float cloudSdf(vec3 q) {
    float d = 1e3;
    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
        vec3 cell = vec3(float(i), 0.0, float(j));
        vec3 h = volHash3(cell * 7.31 + 3.7);
        if (h.z < 0.25) continue;
        vec2 c = 0.2 + 0.6 * (vec2(float(i), float(j)) + 0.2 + 0.6 * h.xy) / 3.0;
        float s = 0.035 + 0.04 * h.z;
        for (int k = 0; k < 5; k++) {
            vec3 r = volHash3(cell * 3.1 + float(k) * 11.7);
            float rad = s * (0.55 + 0.6 * r.z) * (k == 0 ? 1.35 : 1.0);
            vec3 pc = vec3(c.x + (r.x - 0.5) * s * 3.0, 0.1 + rad * (k == 0 ? 1.0 : 0.7), c.y + (r.y - 0.5) * s * 3.0);
            d = smin(d, length(q - pc) - rad, 0.05);
        }
    }
    return max(d, 0.1 - q.y); // flat base
}
float density(vec3 p) {
    vec3 q = vec3(p.x, p.y * 112.0 / 256.0, p.z);
    float d = cloudSdf(q);
    if (d > 0.08) return 0.0;
    float b1 = 1.0 - volWorley(q * 22.0);
    float b2 = 1.0 - volWorley(q * 50.0);
    d -= 0.035 * b1 + 0.015 * b2 - 0.02;
    return smoothstep(0.012, -0.01, d) * (0.85 + 0.15 * b2);
}
`

// sky HDRIs from Poly Haven (CC0), hosted on threepipe cloud; the sun takes the colour of the light in each
const skies: Record<string, {url: string, sun: string, intensity: number}> = {
    'Day': {url: 'qwantani_puresky', sun: '#fff1de', intensity: 16},
    'Sunset': {url: 'belfast_sunset_puresky', sun: '#ffb27a', intensity: 14},
    'Dawn': {url: 'kloppenheim_06_puresky', sun: '#ffc9a0', intensity: 12},
}

const state = {sky: 'Day', turn: 70, height: 25, shadows: true, rotate: !window.TESTING}
let clouds: VolumeObject
let sun: DirectionalLight2

function applySun() {
    const a = state.turn * Math.PI / 180, e = state.height * Math.PI / 180
    sun.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(4)
    sun.lookAt(0, 0, 0)
    sun.setDirty()
    clouds.material.shadows = state.shadows
    viewer.setDirty()
}

async function applySky() {
    const sky = skies[state.sky]
    await viewer.setEnvironmentMap(`https://files.threepipe.org/p/volume-samples/sky/${sky.url}_2k.hdr`, {setBackground: true})
    sun.color.set(sky.sun)
    sun.intensity = sky.intensity
    applySun()
}

async function init() {
    viewer.getPlugin(TonemapPlugin)!.toneMapping = AgXToneMapping
    // the sky lights the clouds a little: the sun does most, as outside
    viewer.scene.environmentIntensity = 0.18

    sun = new DirectionalLight2('#ffffff', 16)
    sun.castShadow = true // the clouds shadow themselves from this light
    viewer.scene.addObject(sun)

    const data = generateVolume(viewer.renderManager.webglRenderer, {size: [256, 112, 256], glsl: cloudsGLSL, name: 'clouds', units: 'm'})
    clouds = new VolumeObject(data, {unitScale: 4 / 256}) // a 4 x 1.75 x 4 box
    viewer.scene.addObject(clouds)
    const m = clouds.material
    m.range.set(0, 255)
    m.transferFunction.colorPoints = [[0, 1, 1, 1], [1, 1, 1, 1]]
    m.transferFunction.opacityPoints = [[0, 0], [0.04, 0], [0.3, 0.2], [1, 0.6]]
    m.transferFunction.setDirty()
    m.density = 2.5
    m.shading = 'volume'
    m.anisotropy = 0.55 // forward scattering: bright edges toward the sun
    m.multipleScattering = 0.35 // light scattered many times inside: soft, bright clouds
    m.ambientOcclusion = true
    m.aoRadius = 12
    m.lightingResolution = 1
    m.samplingRate = 1.5
    m.interactiveSamplingRate = 1

    await applySky()

    const camera = viewer.scene.mainCamera
    camera.position.set(-2.7, 0.6, 2.9)
    camera.target.set(0, -0.1, 0)
    camera.setDirty()
    const controls = camera.controls as any
    controls.autoRotate = state.rotate
    controls.autoRotateSpeed = 0.4

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Sky', property: [state, 'sky'], children: Object.keys(skies).map(label => ({label})), onChange: applySky},
        {type: 'slider', label: 'Sun direction', property: [state, 'turn'], bounds: [-180, 180], stepSize: 1, onChange: applySun},
        {type: 'slider', label: 'Sun height', property: [state, 'height'], bounds: [3, 85], stepSize: 1, onChange: applySun},
        {type: 'checkbox', label: 'Self shadows', property: [state, 'shadows'], onChange: applySun},
        {type: 'checkbox', label: 'Turn', icon: 'rotate-3d', property: [state, 'rotate'], onChange: () => controls.autoRotate = state.rotate},
    ]
    createExampleCard(viewer, {
        description: 'Cumulus clouds made on the GPU from a distance field and cellular noise, in front of an HDR sky: forward and multiple scattering, self shadows from the sun. Change the sky, or move the sun.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
