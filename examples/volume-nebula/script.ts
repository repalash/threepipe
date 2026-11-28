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

// An emission nebula: domain-warped gas with thin bright filaments (ridged noise) in two lobes, a cavity blown out by
// young stars with a bright ionised rim, and dark dust clouds in front. The values carry what each voxel is: dark dust
// below 0.07, then glowing gas from faint to hot. Generated on the GPU in a fraction of a second.
const nebulaGLSL = /* glsl */`
uniform float uSeed;
float density(vec3 p) {
    vec3 c = p - 0.5;
    vec3 q = volWarp(c * 2.5 + uSeed, 2.2);
    float n = volFbm(q * 1.8, 6);
    float r = min(length((c - vec3(-0.08, 0.04, 0.0)) * vec3(1.0, 1.3, 1.1)), length((c - vec3(0.12, -0.06, 0.05)) * vec3(1.2, 1.0, 1.3)) * 1.15);
    float ridge = pow(1.0 - abs(2.0 * volFbm(q * 3.1 + 5.0, 5) - 1.0), 8.0);
    float body = smoothstep(0.42, 0.08, r + 0.45 * (n - 0.5));
    float rc = length(c - vec3(-0.08, 0.04, 0.0));
    float cavity = smoothstep(0.05, 0.14, rc + 0.12 * (n - 0.5));
    float ion = smoothstep(0.34, 0.06, rc);
    float gas = body * cavity * clamp(0.75 * ridge + 0.55 * smoothstep(0.5, 0.8, n), 0.0, 1.0) * (0.55 + 0.45 * ion);
    float rim = exp(-pow((rc - 0.15) * 11.0, 2.0)) * body * smoothstep(0.35, 0.7, n);
    gas = max(gas, 0.75 * rim);
    // dust: dark clouds in the front half, where there is little glowing gas
    float dn = volFbm(q * 2.0 + 31.0, 5);
    float dust = body * smoothstep(0.52, 0.68, dn) * smoothstep(-0.05, 0.15, c.z + 0.1 * (n - 0.5));
    if (gas < 0.06 && dust > 0.02) return 0.015 + 0.055 * dust;
    return 0.07 + 0.6 * gas * smoothstep(0.0, 0.06, gas) - 0.07 * (1.0 - smoothstep(0.0, 0.06, gas));
}`

// Dust absorbs (opacity without colour); gas glows from a deep outer hue to a hot core. Opacity is per voxel.
const opacities = [[0, 0], [0.012, 0], [0.03, 0.05], [0.07, 0.07], [0.09, 0.006], [0.2, 0.012], [0.4, 0.03], [0.6, 0.08]]
const dust = [[0, 0, 0, 0], [0.015, 0.03, 0.015, 0.01], [0.07, 0.05, 0.02, 0.01]]
const palettes: Record<string, number[][]> = {
    'Hydrogen': [...dust, [0.1, 0.45, 0.03, 0.06], [0.2, 0.9, 0.1, 0.12], [0.32, 1, 0.38, 0.12], [0.45, 1, 0.72, 0.35], [0.6, 1, 0.95, 0.8]],
    'Oxygen': [...dust, [0.1, 0.02, 0.18, 0.3], [0.2, 0.05, 0.5, 0.75], [0.32, 0.15, 0.8, 0.95], [0.45, 0.6, 1, 1], [0.6, 1, 1, 1]],
    'Violet': [...dust, [0.1, 0.25, 0.03, 0.4], [0.2, 0.6, 0.1, 0.85], [0.32, 1, 0.35, 0.75], [0.45, 1, 0.75, 0.6], [0.6, 1, 0.95, 0.9]],
}

const state = {palette: 'Hydrogen', density: 3, intensity: 3, rotate: !window.TESTING, seed: 3}
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
        description: 'A 256³ emission nebula made on the GPU in a fraction of a second from noise (generateVolume): glowing gas, hot filaments and dark dust, with bloom. Pick a palette, change the density, or make a new one.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
