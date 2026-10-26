import {
    _testFinish,
    _testStart,
    GBufferPlugin,
    GridHelper,
    LoadingScreenPlugin,
    Matrix4,
    PickingPlugin,
    ThreeViewer,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {SelectionUxPlugin, TransformSnapshot} from './SelectionUxPlugin'
import {SelectionOutlinePlugin} from './SelectionOutlinePlugin'
import {LayersPanelPlugin} from './LayersPanelPlugin'
import {applyInitialPreset, setupHints, setupNotes, setupVariantBar} from './ui'
import {buildScene} from './scene'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'fbx', 'obj', '3dm', 'hdr', 'exr', 'bin', 'png', 'jpg', 'jpeg', 'webp'],
            addOptions: {autoCenter: true, autoScale: true, autoScaleRadius: 2.5},
        },
        plugins: [LoadingScreenPlugin, UndoManagerPlugin, GBufferPlugin],
    })
    viewer.scene.setBackgroundColor('#e3e6eb')

    viewer.addPluginSync(new PickingPlugin(undefined, false))
    const ux = viewer.addPluginSync(SelectionUxPlugin)
    viewer.addPluginSync(SelectionOutlinePlugin)
    const layers = viewer.addPluginSync(new LayersPanelPlugin('light'))
    document.getElementById('layers')!.appendChild(layers.element)
    Object.assign(window, {viewer, ux}) // for poking from the console

    const grid = new GridHelper(40, 40, 0x8f97a3, 0xb7bdc6)
    grid.userData.userSelectable = false
    grid.userData.bboxVisible = false
    viewer.scene.add(grid)

    buildScene(viewer)
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()

    applyInitialPreset(ux)
    const container = viewer.container
    setupVariantBar(container, viewer, ux, {links: [['Open in editor ↗', '../selection-ux-editor/index.html']]})
    setupHints(container, ux)
    setupNotes(document.getElementById('notes')!, ux)
    setupInspector(document.getElementById('inspector')!, viewer, ux)

    try {
        await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    } catch (e) {
        console.warn('Environment map failed to load', e)
    }
}

// region inspector

function setupInspector(root: HTMLElement, viewer: ThreeViewer, ux: SelectionUxPlugin) {
    const fields: {[k: string]: HTMLInputElement} = {}
    root.innerHTML = '<h3><span id="insp-title">Design</span><small id="insp-sub"></small></h3>'
    const body = document.createElement('div')
    root.appendChild(body)
    const empty = document.createElement('div')
    empty.className = 'insp-empty'
    empty.textContent = 'Select something to see its position, rotation and size. Drag a field label to scrub.'
    root.appendChild(empty)

    const group = (title: string, keys: string[], labels: string[]) => {
        const t = document.createElement('div')
        t.className = 'sub'
        t.textContent = title
        body.appendChild(t)
        const g = document.createElement('div')
        g.className = 'grid3'
        keys.forEach((k, i) => {
            const n = document.createElement('div')
            n.className = 'num'
            n.innerHTML = `<span>${labels[i]}</span><input>`
            const input = n.querySelector('input')!
            fields[k] = input
            const lab = n.querySelector('span')!
            // scrub: drag the label left/right
            lab.addEventListener('pointerdown', e => {
                e.preventDefault()
                lab.setPointerCapture(e.pointerId)
                const start = e.clientX
                const v0 = parseFloat(input.value) || 0
                const snaps = ux.snapshot(ux.selected)
                const step = k.startsWith('r') ? 1 : Math.max(0.01, Math.abs(v0) * 0.01 || 0.01)
                const move = (ev: PointerEvent) => {
                    const v = v0 + (ev.clientX - start) * step * (ev.shiftKey ? 10 : 1)
                    applyField(k, v, snaps)
                }
                const up = () => {
                    lab.removeEventListener('pointermove', move)
                    lab.removeEventListener('pointerup', up)
                    ux.recordTransform(snaps, 'inspector')
                }
                lab.addEventListener('pointermove', move)
                lab.addEventListener('pointerup', up)
            })
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur()
                if (e.key === 'Escape') {
                    refresh(true)
                    input.blur()
                }
            })
            input.addEventListener('change', () => {
                const v = parseFloat(input.value)
                if (!isFinite(v)) return refresh(true)
                const snaps = ux.snapshot(ux.selected)
                applyField(k, v, snaps)
                ux.recordTransform(snaps, 'inspector')
            })
            g.appendChild(n)
        })
        body.appendChild(g)
    }
    group('Position', ['px', 'py', 'pz'], ['X', 'Y', 'Z'])
    group('Rotation °', ['rx', 'ry', 'rz'], ['X', 'Y', 'Z'])
    group('Size (uniform)', ['sx', 'sy', 'sz'], ['W', 'H', 'D'])

    const applyField = (k: string, v: number, snaps: TransformSnapshot[]) => {
        const sel = snaps.map(s => s.obj)
        if (!sel.length) return
        const axis = 'xyz'.indexOf(k[1])
        if (k.startsWith('p')) { // move the selection so its box base sits at the value
            const d = new Vector3().setComponent(axis, v - baseFromSnaps(ux, snaps).getComponent(axis))
            ux.transformSnaps(snaps, new Matrix4().makeTranslation(d.x, d.y, d.z))
        } else if (k.startsWith('r')) {
            if (sel.length !== 1) return
            const s = snaps[0]
            const e = s.obj.rotation.clone()
            s.obj.quaternion.copy(s.quaternion)
            e.setFromQuaternion(s.quaternion)
            ;(e as any)['xyz'[axis]] = v * Math.PI / 180
            s.obj.quaternion.setFromEuler(e)
            s.obj.updateMatrixWorld(true)
            s.obj.setDirty?.({change: 'transform', frameFade: false})
            viewer.setDirty()
        } else if (k.startsWith('s')) {
            const base = baseFromSnaps(ux, snaps)
            const size0 = sizeFromSnaps(ux, snaps)
            const f = Math.max(0.001, v / (size0.getComponent(axis) || 1))
            const m = new Matrix4().makeTranslation(base.x, base.y, base.z).multiply(new Matrix4().makeScale(f, f, f)).multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z))
            ux.transformSnaps(snaps, m)
        }
        refresh(false)
    }

    const fmt = (v: number) => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(Math.abs(v) >= 100 ? 1 : 3)).toString()
    let queued = false
    const refresh = (force: boolean) => {
        const sel = ux.selected
        body.style.display = sel.length ? '' : 'none'
        empty.style.display = sel.length ? 'none' : ''
        document.getElementById('insp-title')!.textContent = sel.length > 1 ? `${sel.length} selected` : sel.length ? ux.displayName(sel[0]) : 'Design'
        document.getElementById('insp-sub')!.textContent = sel.length === 1 ? sel[0].geometry ? 'Mesh' : 'Group' : ''
        if (!sel.length) return
        const info = ux.boxInfo(sel, 'world')
        const local = ux.boxInfo(sel)
        const r = sel.length === 1 ? sel[0].rotation : null
        const vals: {[k: string]: number | null} = {
            px: info.base.x, py: info.base.y, pz: info.base.z,
            rx: r ? r.x * 180 / Math.PI : null, ry: r ? r.y * 180 / Math.PI : null, rz: r ? r.z * 180 / Math.PI : null,
            sx: local.size.x, sy: local.size.y, sz: local.size.z,
        }
        for (const [k, v] of Object.entries(vals)) {
            const f = fields[k]
            if (document.activeElement === f && !force) continue
            f.value = v === null ? 'Mixed' : fmt(v)
            f.disabled = v === null
        }
    }
    ux.addEventListener('uxUpdate', e => {
        if (e.reason === 'hover' || queued) return
        queued = true
        requestAnimationFrame(() => {
            queued = false
            refresh(false)
        })
    })
    refresh(true)
}

function baseFromSnaps(ux: SelectionUxPlugin, snaps: TransformSnapshot[]) {
    return withSnaps(snaps, () => ux.boxInfo(snaps.map(s => s.obj), 'world').base)
}

function sizeFromSnaps(ux: SelectionUxPlugin, snaps: TransformSnapshot[]) {
    return withSnaps(snaps, () => ux.boxInfo(snaps.map(s => s.obj)).size)
}

/** Evaluate with the objects temporarily back at their snapshot transforms */
function withSnaps<T>(snaps: TransformSnapshot[], fn: () => T): T {
    const cur = snaps.map(s => ({p: s.obj.position.clone(), q: s.obj.quaternion.clone(), s: s.obj.scale.clone()}))
    snaps.forEach(s => {
        s.obj.position.copy(s.position)
        s.obj.quaternion.copy(s.quaternion)
        s.obj.scale.copy(s.scale)
        s.obj.updateMatrixWorld(true)
    })
    const res = fn()
    snaps.forEach((s, i) => {
        s.obj.position.copy(cur[i].p)
        s.obj.quaternion.copy(cur[i].q)
        s.obj.scale.copy(cur[i].s)
        s.obj.updateMatrixWorld(true)
    })
    return res
}

// endregion

_testStart()
init().finally(_testFinish)
