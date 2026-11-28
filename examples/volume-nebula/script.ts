import {
    _testFinish,
    _testStart,
    BufferGeometry,
    Float32BufferAttribute,
    LoadingScreenPlugin,
    Points,
    PointsMaterial,
    ProgressivePlugin,
    ThreeViewer,
    UiObjectConfig,
} from 'threepipe'
import {generateVolume, VolumeObject} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin],
})

// An emission nebula: swirling gas (domain-warped fractal noise) in a shell around a bright core, with dark dust
// lanes cut through it. Generated on the GPU in a fraction of a second.
const nebulaGLSL = /* glsl */`
uniform float uSeed;
float density(vec3 p) {
    vec3 c = p - 0.5;
    vec3 q = volWarp(c * 3.0 + uSeed, 1.6);
    float gas = volFbm(q * 1.7, 6);
    float r = length(c * vec3(1.0, 1.35, 1.0));
    // a thick shell with a soft core, fading at the edge of the box
    float shell = smoothstep(0.48, 0.12, r) * (0.35 + 0.65 * smoothstep(0.05, 0.3, r));
    // dark dust lanes: thin bands of low noise
    float dust = smoothstep(0.02, 0.09, abs(volFbm(q * 2.6 + 11.0, 4) - 0.5));
    return pow(gas, 1.6) * shell * (0.25 + 0.75 * dust) * 1.9;
}
`

const palettes: Record<string, {colors: number[][], opacities: number[][]}> = {
    'Pillars': {
        colors: [[0, 0.02, 0.03, 0.12], [0.2, 0.12, 0.05, 0.45], [0.45, 0.85, 0.18, 0.55], [0.7, 1.0, 0.55, 0.22], [1, 1.0, 0.95, 0.8]],
        opacities: [[0, 0], [0.12, 0], [0.35, 0.05], [0.7, 0.16], [1, 0.4]],
    },
    'Teal and gold': {
        colors: [[0, 0.0, 0.05, 0.08], [0.25, 0.0, 0.45, 0.55], [0.55, 0.1, 0.85, 0.75], [0.8, 1.0, 0.75, 0.3], [1, 1.0, 1.0, 0.9]],
        opacities: [[0, 0], [0.12, 0], [0.35, 0.04], [0.7, 0.14], [1, 0.36]],
    },
    'Crimson': {
        colors: [[0, 0.05, 0.0, 0.02], [0.3, 0.55, 0.02, 0.08], [0.6, 1.0, 0.25, 0.1], [0.85, 1.0, 0.7, 0.35], [1, 1.0, 1.0, 1.0]],
        opacities: [[0, 0], [0.12, 0], [0.35, 0.05], [0.7, 0.17], [1, 0.42]],
    },
}

const state = {palette: 'Pillars', density: 2.5, rotate: true, seed: 3}
let nebula: VolumeObject

function applyPalette() {
    const tf = nebula.material.transferFunction
    const p = palettes[state.palette]
    tf.colorPoints = p.colors.map(c => [...c])
    tf.opacityPoints = p.opacities.map(o => [...o])
    tf.setDirty()
}

function makeNebula() {
    const data = generateVolume(viewer.renderManager.webglRenderer, {
        size: [256, 256, 256],
        glsl: nebulaGLSL,
        uniforms: {uSeed: {value: state.seed}},
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
    m.range.set(0, 255)
    m.density = state.density
    m.samplingRate = 1.5
    applyPalette()
}

// a few thousand stars on a far sphere, brighter ones fewer
function makeStars() {
    const n = 6000
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u)
        const r = 40 + Math.random() * 20
        pos.set([s * Math.cos(a) * r, u * r, s * Math.sin(a) * r], i * 3)
        const b = Math.pow(Math.random(), 4) * 0.9 + 0.1
        const warm = Math.random()
        col.set([b, b * (0.85 + 0.15 * warm), b * (0.7 + 0.3 * (1 - warm))], i * 3)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    const stars = new Points(g, new PointsMaterial({size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false}))
    stars.name = 'Stars'
    viewer.scene.addObject(stars)
}

async function init() {
    viewer.scene.setBackgroundColor('#000000')
    makeStars()
    makeNebula()

    viewer.scene.mainCamera.position.set(0.4, 0.3, 3.1)
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
        {type: 'checkbox', label: 'Drift', icon: 'rotate-3d', property: [state, 'rotate'], onChange: () => controls.autoRotate = state.rotate},
        {type: 'button', label: 'New nebula', icon: 'sparkles', value: () => {
            state.seed = Math.floor(Math.random() * 1000)
            makeNebula()
            viewer.setDirty()
        }},
    ]
    createExampleCard(viewer, {
        description: 'A 256³ emission nebula made on the GPU from fractal noise (generateVolume), drawn as glowing gas with dark dust lanes. Pick a palette, change the density, or make a new one.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
