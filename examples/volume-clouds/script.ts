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

// Cumulus clouds as a distance field: a field of towers, each a cluster of puffs (spheres joined smoothly) rising
// from a flat base, with billows (cellular noise) pushing their surface out at two scales. The same scale on every
// axis, though the box is lower than it is wide.
const cloudsGLSL = /* glsl */`
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
float cloudSdf(vec3 q) {
    float d = 1e3;
    for (int j = 0; j < 5; j++) for (int i = 0; i < 5; i++) {
        vec3 cell = vec3(float(i), 0.0, float(j));
        vec3 h = volHash3(cell * 7.31 + 3.7);
        if (h.z < 0.3) continue;
        vec2 c = 0.08 + 0.84 * (vec2(float(i), float(j)) + 0.2 + 0.6 * h.xy) / 5.0;
        if (length(c - 0.5) > 0.46) continue; // a round field, so the box corners never show
        float s = 0.018 + 0.03 * h.z * h.z;
        for (int k = 0; k < 6; k++) {
            vec3 r = volHash3(cell * 3.1 + float(k) * 11.7);
            float rad = s * (0.5 + 0.6 * r.z) * (k == 0 ? 1.4 : 1.0);
            vec3 pc = vec3(c.x + (r.x - 0.5) * s * 3.2, 0.03 + rad * (k == 0 ? 1.0 : 0.65), c.y + (r.y - 0.5) * s * 3.2);
            d = smin(d, length(q - pc) - rad, 0.025);
        }
    }
    return max(d, 0.03 - q.y); // flat base
}
float density(vec3 p) {
    vec3 q = vec3(p.x, p.y * 0.25, p.z);
    float d = cloudSdf(q);
    if (d > 0.05) return 0.0;
    float b1 = 1.0 - volWorley(q * 34.0);
    float b2 = 1.0 - volWorley(q * 80.0);
    d -= 0.022 * b1 + 0.009 * b2 - 0.012;
    return smoothstep(0.008, -0.006, d) * (0.85 + 0.15 * b2);
}
`

// sky HDRIs from Poly Haven (CC0), hosted on threepipe cloud; the sun takes the colour of the light in each
const skies: Record<string, {url: string, sun: string, intensity: number}> = {
    'Day': {url: 'qwantani_puresky', sun: '#fff1de', intensity: 20},
    'Sunset': {url: 'belfast_sunset_puresky', sun: '#ffb27a', intensity: 14},
    'Dawn': {url: 'kloppenheim_06_puresky', sun: '#ffc9a0', intensity: 12},
}

const state = {sky: 'Day', turn: 40, height: 35, shadows: true, rotate: !window.TESTING}
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

    const data = generateVolume(viewer.renderManager.webglRenderer, {size: [384, 96, 384], glsl: cloudsGLSL, name: 'clouds', units: 'm'})
    clouds = new VolumeObject(data, {unitScale: 8 / 384}) // an 8 x 2 x 8 box
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
    m.aoRadius = 16
    m.lightingResolution = window.TESTING ? 0.5 : 1 // full resolution: the half one shows steps on the cloud tops
    m.samplingRate = 1.5
    m.interactiveSamplingRate = 1

    await applySky()

    const camera = viewer.scene.mainCamera
    // low, near the cloud base, looking along the field
    camera.position.set(-1.2, -0.9, 7.5)
    camera.target.set(0.3, -0.35, 0)
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
