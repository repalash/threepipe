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
import {NRRDLoadPlugin, VolumeData, VolumeObject, VolumeRenderMode, VolumeShading} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, ProgressivePlugin, GBufferPlugin, NRRDLoadPlugin],
})

const state = {
    data: 'stent' as 'stent' | 'cloud',
    mode: 'composite' as VolumeRenderMode,
    shading: 'hybrid' as VolumeShading,
    shadows: true,
    ambientOcclusion: true,
    cubic: false,
    lightAngle: 40,
    lightHeight: 50,
}

const volumes: Partial<Record<'stent' | 'cloud', VolumeObject>> = {}
let light: DirectionalLight2

// A soft cloud: value noise in octaves inside a ball, 128³ bytes
function makeCloud(): VolumeData {
    const n = 128
    const g = 17
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const lattice = new Float32Array(g * g * g).map(rnd)
    const noise = (x: number, y: number, z: number) => {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
        const xf = x - xi, yf = y - yi, zf = z - zi
        const s = (t: number) => t * t * (3 - 2 * t)
        const at = (i: number, j: number, k: number) => lattice[((k % g + g) % g * g + (j % g + g) % g) * g + (i % g + g) % g]
        const lx = (j: number, k: number) => at(xi, j, k) + (at(xi + 1, j, k) - at(xi, j, k)) * s(xf)
        const ly = (k: number) => lx(yi, k) + (lx(yi + 1, k) - lx(yi, k)) * s(yf)
        return ly(zi) + (ly(zi + 1) - ly(zi)) * s(zf)
    }
    const data = new Uint8Array(n ** 3)
    let i = 0
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = x / n, py = y / n, pz = z / n
        let v = 0
        for (let o = 0, f = 4, a = 0.55; o < 4; o++, f *= 2, a *= 0.5) v += a * noise(px * f, py * f, pz * f)
        const r = Math.hypot(px - 0.5, (py - 0.5) * 1.4, pz - 0.5) / 0.45
        data[i++] = Math.round(255 * Math.max(0, Math.min(1, (v - 0.45) * 2.5 + (1 - r) * 0.9 - 0.3)))
    }
    return new VolumeData({data, size: [n, n, n], spacing: [1, 1, 1], name: 'cloud', units: 'cm', valueRange: [0, 255]})
}

function apply() {
    for (const [name, v] of Object.entries(volumes)) {
        if (!v) continue
        v.visible = name === state.data
        const m = v.material
        m.mode = state.mode
        m.shading = state.shading
        m.shadows = state.shadows
        m.ambientOcclusion = state.ambientOcclusion
        m.sampling = state.cubic ? 'cubic' : 'linear'
    }
    // the light turns around the vertical axis (angle) and rises (height); it points at the centre
    const a = state.lightAngle * Math.PI / 180, h = state.lightHeight * Math.PI / 180
    light.position.set(Math.cos(h) * Math.sin(a), Math.sin(h), Math.cos(h) * Math.cos(a)).multiplyScalar(3)
    light.lookAt(0, 0, 0)
    light.setDirty()
    viewer.setDirty()
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    viewer.scene.setBackgroundColor('#15171c')

    light = new DirectionalLight2('#ffffff', 3)
    light.castShadow = true // the volumes take their shadows from the first light that casts them
    viewer.scene.addObject(light)

    // A scan of a stent (128 x 128 x 256 voxels, float values from 0 to 1), from the three.js examples
    const stent = await viewer.load<VolumeObject>('https://threejs.org/examples/models/nrrd/stent.nrrd', {autoCenter: true, autoScale: true})
    if (!stent) throw new Error('The volume did not load')
    stent.material.setPreset('colormap:grayscale')
    stent.material.range.set(0.1, 1)
    stent.material.density = 3
    stent.material.isoValue = 0.35
    volumes.stent = stent

    const cloud = new VolumeObject(makeCloud())
    cloud.scale.setScalar(0.8 / cloud.geometry.boundingBox!.max.x) // about 1.6 units across
    cloud.material.setPreset('colormap:grayscale')
    cloud.material.range.set(20, 255)
    cloud.material.density = 0.6
    cloud.material.isoValue = 110
    cloud.material.anisotropy = 0.3 // a little forward scattering, as in clouds
    viewer.scene.addObject(cloud)
    volumes.cloud = cloud

    viewer.scene.mainCamera.position.set(2.0, 0.9, 2.6)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()
    apply()

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Data', property: [state, 'data'], children: [['stent', 'Stent scan'], ['cloud', 'Cloud (procedural)']].map(([value, label]) => ({label, value})), onChange: apply},
        {type: 'dropdown', label: 'Mode', property: [state, 'mode'], children: ['composite', 'iso', 'xray'].map(label => ({label})), onChange: apply},
        {type: 'dropdown', label: 'Shading', property: [state, 'shading'], children: ['none', 'surface', 'volume', 'hybrid'].map(label => ({label})), onChange: apply},
        {type: 'checkbox', label: 'Shadows', property: [state, 'shadows'], onChange: apply},
        {type: 'checkbox', label: 'Ambient occlusion', property: [state, 'ambientOcclusion'], onChange: apply},
        {type: 'checkbox', label: 'Tricubic sampling', property: [state, 'cubic'], onChange: apply},
        {type: 'slider', label: 'Light angle', property: [state, 'lightAngle'], bounds: [-180, 180], stepSize: 1, onChange: apply},
        {type: 'slider', label: 'Light height', property: [state, 'lightHeight'], bounds: [5, 90], stepSize: 1, onChange: apply},
    ]
    createExampleCard(viewer, {
        description: 'Volumes lit by the lights and the environment of the scene: surface shading where the gradient is strong, scattering where it is weak (hybrid), shadows of the volume on itself and ambient occlusion. Turn the light and change the shading. Iso mode writes its depth and goes into the G-buffer.',
        actions,
    })
}

_testStart()
init().finally(_testFinish)
