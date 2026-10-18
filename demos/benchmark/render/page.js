// The benchmark's render page: one plain ThreeViewer (msaa, default tonemap, venice_sunset HDRI, no post),
// the same set-up the side-by-side in issues/open/modelling-tools/16-realism.md was judged in.
// ../render.mjs drives it through `window.bench`; one model and one style per page load.

import {DRACOLoader2, Matrix4, PhysicalMaterial, ThreeViewer} from 'threepipe'

// The decoder three ships, served from this repo, instead of the CDN default.
DRACOLoader2.DRACO_LIBRARY_PATH = new URL('../../../node_modules/three/examples/jsm/libs/draco/', import.meta.url).href

const HDRI = 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas'), msaa: true, renderScale: 1})
const envPending = viewer.setEnvironmentMap(HDRI)
viewer.scene.backgroundColor = null

const glob = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')

const TEXTURE_SLOTS = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap',
    'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap',
    'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap',
    'specularColorMap', 'displacementMap', 'anisotropyMap']

/** A decal: an alpha-blended material whose shape comes from its colour texture (labels, printed markings). */
const isDecal = m => !!m && m.transparent && !!m.map

let root = null
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
     * @param {{matrix?: number[], exclude?: string[], style?: 'full'|'notex'|'clay'}} opts
     */
    async load(url, opts = {}) {
        await envPending
        root = await viewer.load(url, {autoCenter: false, autoScale: false})
        if (!root) throw new Error('nothing loaded from ' + url)
        if (opts.matrix) root.applyMatrix4(new Matrix4().fromArray(opts.matrix))
        const exclude = (opts.exclude ?? []).map(glob)
        const clay = new PhysicalMaterial({color: '#8c8c8c', roughness: 0.55, metalness: 0})
        const style = opts.style ?? 'full'
        const hide = []
        root.traverse(o => {
            if (!o.isMesh) return
            info.meshes++
            if (exclude.some(r => r.test(o.name))) { hide.push(o); return }
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            mats.forEach(m => m && info.materials.add(m.uuid))
            if (style === 'full') return
            if (mats.some(isDecal)) { info.decals++; hide.push(o); return }
            if (style === 'clay') { o.material = clay; return }
            // notex: every texture slot cleared, factors kept
            for (const m of mats) {
                for (const k of TEXTURE_SLOTS) if (m[k]) m[k] = null
                m.needsUpdate = true
                m.setDirty?.()
            }
        })
        for (const o of hide) { o.visible = false; info.hidden++ }
        viewer.scene.setDirty?.({refreshScene: true})
        await frames(3)
        return {meshes: info.meshes, hidden: info.hidden, decals: info.decals, materials: info.materials.size}
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
