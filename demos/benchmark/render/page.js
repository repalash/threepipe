// The benchmark's render page: one plain ThreeViewer (msaa, default tonemap, venice_sunset HDRI, no post),
// the same set-up the side-by-side in issues/open/modelling-tools/16-realism.md was judged in.
// ../render.mjs drives it through `window.bench`; one model and one style per page load.

import {BufferAttribute, Color, DRACOLoader2, Matrix4, PhysicalMaterial, SRGBColorSpace, ThreeViewer, UnlitMaterial} from 'threepipe'

// The decoder three ships, served from this repo, instead of the CDN default.
DRACOLoader2.DRACO_LIBRARY_PATH = new URL('../../../node_modules/three/examples/jsm/libs/draco/', import.meta.url).href

const HDRI = 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas'), msaa: true, renderScale: 1})
const envPending = viewer.setEnvironmentMap(HDRI)
/** The page and render background; `mask` renders white on black instead. */
const BACKGROUND = '#e9e9e9'
viewer.scene.backgroundColor = new Color(BACKGROUND)

const glob = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')

const TEXTURE_SLOTS = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap',
    'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap',
    'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap',
    'specularColorMap', 'displacementMap', 'anisotropyMap']

/** A decal: an alpha-blended material whose shape comes from its colour texture (labels, printed markings). */
const isDecal = m => !!m && m.transparent && !!m.map

let root = null

/** Mean sRGB colour and alpha of an image, 0..1, over a 64x64 resample. */
function meanColor(image) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')
    ctx.drawImage(image, 0, 0, 64, 64)
    const d = ctx.getImageData(0, 0, 64, 64).data
    let r = 0, g = 0, b = 0, a = 0
    for (let i = 0; i < d.length; i += 4) { const w = d[i + 3] / 255; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w }
    const n = d.length / 4
    return a > 0 ? [r / a / 255, g / a / 255, b / a / 255, a / n] : [0, 0, 0, 0]
}
const info = {meshes: 0, hidden: 0, decals: 0, materials: new Set()}

async function frames(n) {
    for (let i = 0; i < n; i++) {
        viewer.setDirty()
        await new Promise(r => viewer.doOnce('postFrame', r))
    }
}

window.bench = {
    /**
     * @param {string} url GLB url
     * @param {{matrix?: number[], exclude?: string[], style?: 'full'|'notex'|'clay'|'mask'|'heat', heat?: string}} opts
     *   `heat`: url of `{meshes: [{verts, rgb (base64 sRGB bytes)}]}`, one entry per non-excluded mesh in traversal order
     */
    async load(url, opts = {}) {
        await envPending
        // Model only: no viewer config (background, exposure, plugins) and no lights from the file, so both
        // models are lit by the same HDRI and nothing else.
        root = await viewer.load(url, {autoCenter: false, autoScale: false, importConfig: false})
        if (!root) throw new Error('nothing loaded from ' + url)
        const lights = []
        root.traverse(o => { if (o.isLight) lights.push(o) })
        for (const l of lights) l.parent?.remove(l)
        info.lightsRemoved = lights.length
        if (opts.matrix) root.applyMatrix4(new Matrix4().fromArray(opts.matrix))
        const exclude = (opts.exclude ?? []).map(glob)
        const clay = new PhysicalMaterial({color: '#8c8c8c', roughness: 0.55, metalness: 0})
        const style = opts.style ?? 'full'
        const mask = new UnlitMaterial({color: '#ffffff'})
        if (style === 'mask') {
            viewer.scene.backgroundColor = new Color('#000000')
        }
        const heat = style === 'heat' ? await (await fetch(opts.heat)).json() : null
        const heatErrors = []
        let meshIndex = 0
        const hide = [], done = new Set()
        root.traverse(o => {
            if (!o.isMesh) return
            info.meshes++
            if (exclude.some(r => r.test(o.name))) { hide.push(o); return }
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            mats.forEach(m => m && info.materials.add(m.uuid))
            if (mats.some(isDecal)) info.decals++
            if (style === 'full') return
            if (style === 'clay') { o.material = clay; return }
            if (style === 'mask') { o.material = mask; return }
            if (style === 'heat') {
                const h = heat.meshes[meshIndex++]
                const n = o.geometry.attributes.position.count
                if (!h || h.verts !== n) { heatErrors.push(`${o.name}: ${n} vertices, heat has ${h?.verts}`); o.material = clay; return }
                const bytes = Uint8Array.from(atob(h.rgb), c => c.charCodeAt(0))
                const col = new Float32Array(n * 3), c = new Color()
                for (let i = 0; i < n; i++) {
                    c.setRGB(bytes[3 * i] / 255, bytes[3 * i + 1] / 255, bytes[3 * i + 2] / 255, SRGBColorSpace)
                    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b
                }
                o.geometry.setAttribute('color', new BufferAttribute(col, 3))
                o.material = new PhysicalMaterial({color: '#ffffff', vertexColors: true, roughness: 0.7, metalness: 0})
                return
            }
            // notex: each colour texture folded into its material as the texture's mean colour and alpha (so a
            // label that is mostly transparent fades out, a screen keeps its average tone); every other map dropped.
            for (const m of mats) {
                if (!m || done.has(m)) continue
                done.add(m)
                if (m.map?.image) {
                    const [r, g, b, a] = meanColor(m.map.image)
                    m.color.multiply(new Color().setRGB(r, g, b, SRGBColorSpace))
                    if (m.transparent) m.opacity *= a
                }
                for (const k of TEXTURE_SLOTS) if (m[k]) m[k] = null
                m.needsUpdate = true
                m.setDirty?.()
            }
        })
        for (const o of hide) { o.visible = false; info.hidden++ }
        viewer.scene.setDirty?.({refreshScene: true})
        await frames(3)
        if (heat && meshIndex !== heat.meshes.length) heatErrors.push(`page has ${meshIndex} meshes, heat has ${heat.meshes.length}`)
        return {meshes: info.meshes, hidden: info.hidden, decals: info.decals, materials: info.materials.size, lightsRemoved: info.lightsRemoved, heatErrors}
    },

    /** @param {{position: number[], target: number[], fov?: number, up?: number[]}} view */
    async view(view) {
        const cam = viewer.scene.mainCamera
        if (view.up) cam.up.set(...view.up)
        cam.position.set(...view.position)
        cam.target.set(...view.target)
        if (view.fov) cam.fov = view.fov
        cam.setDirty()
        await frames(view.frames ?? 12)
        return true
    },

    renderer() {
        const gl = viewer.renderManager.webglRenderer.getContext()
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    },
}
window.benchReady = true
