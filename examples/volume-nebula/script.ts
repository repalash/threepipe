import {
    _testFinish,
    _testStart,
    AdditiveBlending,
    BufferGeometry,
    Float32BufferAttribute,
    LoadingScreenPlugin,
    Points,
    PointsMaterial,
    ProgressivePlugin,
    ACESFilmicToneMapping,
    TonemapPlugin,
    ThreeViewer,
    UiObjectConfig,
} from 'threepipe'
import {BloomPlugin} from '@threepipe/webgi-plugins'
import {generateVolume, VolumeObject, VolumePlugin} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    // heavy for the software renderer of the screenshot tests
    renderScale: window.TESTING ? 0.5 : 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, VolumePlugin, BloomPlugin],
})

// An emission nebula: thin bright filaments (ridged noise at two scales) through domain-warped gas, in two lobes,
// with a cavity blown out by young stars and hot gas around them. Generated on the GPU in a fraction of a second.
const nebulaGLSL = /* glsl */`
uniform float uSeed;
float density(vec3 p) {
    vec3 c = p - 0.5;
    vec3 q = volWarp(c * 2.5 + uSeed, 2.2);
    float n = volFbm(q * 1.8, 6);
    // two lobes, so the outline is not a ball
    float r = min(length((c - vec3(-0.08, 0.04, 0.0)) * vec3(1.0, 1.3, 1.1)), length((c - vec3(0.12, -0.06, 0.05)) * vec3(1.2, 1.0, 1.3)) * 1.15);
    float ridge = pow(1.0 - abs(2.0 * volFbm(q * 3.1 + 5.0, 5) - 1.0), 10.0);
    float ridge2 = pow(1.0 - abs(2.0 * volFbm(q * 6.3 + 9.0, 4) - 1.0), 14.0);
    float body = smoothstep(0.42, 0.08, r + 0.45 * (n - 0.5));
    float rc = length(c - vec3(-0.08, 0.04, 0.0));
    float cavity = smoothstep(0.06, 0.16, rc + 0.15 * (n - 0.5));
    float glow = exp(-rc * rc * 120.0); // hot gas around the young stars
    float gas = 0.9 * ridge + 0.5 * ridge2 + 0.35 * smoothstep(0.55, 0.85, n);
    return clamp(body * cavity * gas + 0.6 * glow * n, 0.0, 1.0);
}
`

// Faint values are a dim haze, bright ones the hot filaments; one hue per palette keeps the colours deep. Opacity is
// per voxel.
const opacities = [[0, 0], [0.05, 0], [0.15, 0.012], [0.35, 0.03], [0.6, 0.08], [1, 0.3]]
const palettes: Record<string, number[][]> = {
    'Hydrogen': [[0, 0, 0, 0], [0.12, 0.3, 0.02, 0.06], [0.3, 0.9, 0.1, 0.12], [0.55, 1, 0.42, 0.12], [0.8, 1, 0.78, 0.4], [1, 1, 0.97, 0.85]],
    'Oxygen': [[0, 0, 0, 0], [0.12, 0.01, 0.12, 0.18], [0.3, 0.02, 0.5, 0.7], [0.55, 0.2, 0.85, 0.95], [0.8, 0.7, 1, 1], [1, 1, 1, 1]],
    'Violet': [[0, 0, 0, 0], [0.12, 0.15, 0.02, 0.25], [0.3, 0.5, 0.1, 0.85], [0.55, 0.95, 0.35, 0.9], [0.8, 1, 0.75, 0.95], [1, 1, 1, 1]],
}

const state = {palette: 'Hydrogen', density: 3, intensity: 1.5, rotate: !window.TESTING, seed: 3}
let nebula: VolumeObject

function applyPalette() {
    const tf = nebula.material.transferFunction
    tf.colorPoints = palettes[state.palette].map(c => [...c])
    tf.opacityPoints = opacities.map(o => [...o])
    tf.setDirty()
}

function makeNebula() {
    const data = generateVolume(viewer.renderManager.webglRenderer, {
        size: [256, 256, 256],
        glsl: nebulaGLSL,
        uniforms: {uSeed: {value: state.seed}},
        precision: 'float',
        name: 'nebula',
        units: 'ly',
    })
    if (!nebula) {
        nebula = new VolumeObject(data, {unitScale: 1 / 128}) // 2 units across
        viewer.scene.addObject(nebula)
    } else {
        const old = nebula.data
        nebula.addField(data) // replaces the field of the same name
        old?.dispose() // frees its texture and what the material built for it
    }
    const m = nebula.material
    m.range.set(0, 1)
    m.density = state.density
    m.samplingRate = 1.5
    m.interactiveSamplingRate = 1
    m.intensity = state.intensity // emitted light above 1: the bright filaments bloom
    applyPalette()
}

// stars: a few thousand on a far sphere (brighter ones fewer), and a few bright young ones inside the nebula
function makeStars(n: number, radius: [number, number], size: number, brightness: (i: number) => number) {
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u)
        const r = radius[0] + Math.random() * (radius[1] - radius[0])
        pos.set([s * Math.cos(a) * r, u * r, s * Math.sin(a) * r], i * 3)
        const b = brightness(i)
        const warm = Math.random()
        col.set([b, b * (0.85 + 0.15 * warm), b * (0.7 + 0.3 * (1 - warm))], i * 3)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    // added on top, so a faint star never darkens the gas in front of it
    const stars = new Points(g, new PointsMaterial({size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending}))
    stars.name = 'Stars'
    viewer.scene.addObject(stars)
}

async function init() {
    viewer.scene.setBackgroundColor('#000000')
    const tonemap = viewer.getPlugin(TonemapPlugin)!
    tonemap.toneMapping = ACESFilmicToneMapping // keeps the colours deeper than AgX
    tonemap.saturation = 1.15
    tonemap.contrast = 1.1
    const bloom = viewer.getPlugin(BloomPlugin)!
    bloom.pass!.threshold = 0.9
    bloom.pass!.intensity = 0.7
    bloom.pass!.radius = 0.75
    makeStars(6000, [40, 60], 1.6, () => Math.pow(Math.random(), 4) * 0.9 + 0.1)
    makeStars(40, [0, 0.35], 3, () => 0.8 + Math.random() * 0.2)
    makeNebula()

    viewer.scene.mainCamera.position.set(0.3, 0.25, 2.2)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    // slow drift around the nebula
    const controls = viewer.scene.mainCamera.controls as any
    controls.autoRotate = state.rotate
    controls.autoRotateSpeed = 0.4

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Palette', property: [state, 'palette'], children: Object.keys(palettes).map(label => ({label})), onChange: () => {
            applyPalette()
            viewer.setDirty()
        }},
        {type: 'slider', label: 'Density', property: [state, 'density'], bounds: [0.3, 8], stepSize: 0.1, onChange: () => {
            nebula.material.density = state.density
            viewer.setDirty()
        }},
        {type: 'slider', label: 'Glow', property: [state, 'intensity'], bounds: [0.5, 6], stepSize: 0.1, onChange: () => {
            nebula.material.intensity = state.intensity
            viewer.setDirty()
        }},
        {type: 'checkbox', label: 'Drift', icon: 'rotate-3d', property: [state, 'rotate'], onChange: () => controls.autoRotate = state.rotate},
        {type: 'button', label: 'New nebula', icon: 'sparkles', value: () => {
            state.seed = Math.floor(Math.random() * 1000)
            makeNebula()
            viewer.setDirty()
        }},
    ]
    createExampleCard(viewer, {
        description: 'A 256³ emission nebula made on the GPU in a fraction of a second from noise (generateVolume): hot filaments glowing above white, with bloom. Pick a palette, change the density, or make a new one.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
