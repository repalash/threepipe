import {
    _testFinish,
    _testStart,
    Color,
    ContactShadowGroundPlugin,
    GBufferPlugin,
    GeometryGeneratorPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
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
import {NotesPlugin} from './NotesPlugin'
import {applyModeFromUrl, setupHints, setupModeMenu, setupSidePanel, modeContext} from './ui'
import {buildExtras, buildScene, demoAnnotations, splashSamples} from './scene'
import {AnnotationsPlugin} from './AnnotationsPlugin'
import {EditorToolbarPlugin} from './EditorToolbarPlugin'
import {showReport, showReportIfNew} from './report'
import {showSplash} from './splash'
import {PerfPanelPlugin} from './PerfPanelPlugin'
import {PenToolPlugin} from './PenToolPlugin'
import {CameraPathPlugin} from './CameraPathPlugin'
import {EditorCameraPlugin} from './EditorCameraPlugin'
import {TimelineBarPlugin} from './TimelineBarPlugin'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'fbx', 'obj', '3dm', 'hdr', 'exr', 'bin', 'png', 'jpg', 'jpeg', 'webp'],
            addOptions: {autoCenter: true, autoScale: true, autoScaleRadius: 2.5},
        },
        plugins: [LoadingScreenPlugin, UndoManagerPlugin, GBufferPlugin, ContactShadowGroundPlugin, GeometryGeneratorPlugin, Object3DGeneratorPlugin, new Object3DWidgetsPlugin(false)],
    })
    viewer.scene.setBackgroundColor('#e3e6eb')

    viewer.addPluginSync(new PickingPlugin(undefined, false))
    // persistKey: settings and mode are saved in this browser
    const ux = viewer.addPluginSync(new SelectionUxPlugin({persistKey: 'selection-ux-settings'}))
    viewer.addPluginSync(SelectionOutlinePlugin)
    // the editor's own camera (free, no damping, never saved); the scene's default camera is the start view
    viewer.addPluginSync(new EditorCameraPlugin())
    // notes on surfaces with a camera view each, saved in the .glb (toolbar: Annotate N, Tour in View mode)
    viewer.addPluginSync(new AnnotationsPlugin({editable: true}))
    // FPS, frame and render times, draw calls; warns about a capped frame rate (Chrome Energy Saver), battery, software GL
    viewer.addPluginSync(new PerfPanelPlugin({position: 'bottom-right'}))
    // P: draw a path point by point, like Figma's pen
    viewer.addPluginSync(new PenToolPlugin())
    // camera along a path, the timeline bar with Record (adds VideoRecorderPlugin)
    viewer.addPluginSync(new CameraPathPlugin())
    viewer.addPluginSync(new TimelineBarPlugin())
    const layers = viewer.addPluginSync(new LayersPanelPlugin('light'))
    Object.assign(window, {viewer, ux}) // for poking from the console

    buildScene(viewer)
    buildExtras(viewer)
    demoAnnotations(viewer)
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()

    applyModeFromUrl(ux)
    const container = viewer.container
    const toolbar = viewer.addPluginSync(new EditorToolbarPlugin({
        grid: true,
        expandHides: () => [document.querySelector<HTMLElement>('.sux-side')!, document.getElementById('inspector')!],
        viewHides: () => [document.querySelector<HTMLElement>('.sux-side')!, document.getElementById('inspector')!],
        extra: [[REPORT_ICON, 'Open a file or sample…', () => openSplash()], [REPORT_ICON, 'Report: what changed and what to try', () => showReport()]],
    }))
    container.appendChild(toolbar.element)
    setupModeMenu(container, viewer, ux, {buttonHost: toolbar.slot, links: [['Open in the editor ↗', '../selection-ux-editor/index.html']]})
    setupHints(container, ux)
    const notes = viewer.addPluginSync(new NotesPlugin({pageKey: 'selection-ux-playground-notes', syncUrl: '/api/notes', contextProvider: modeContext(ux)}))
    setupSidePanel(container, layers, notes, 'sux-side-pos-playground')
    setupInspector(document.getElementById('inspector')!, viewer, ux)
    // the welcome screen: drop a file or pick a sample (skip with ?nosplash); the report of this round after it
    const openSplash = () => showSplash(viewer, {title: 'Welcome to the threepipe Editor', samples: splashSamples(viewer), onClose: showReportIfNew})
    if (new URLSearchParams(location.search).has('nosplash')) showReportIfNew()
    else openSplash()

    try {
        await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    } catch (e) {
        console.warn('Environment map failed to load', e)
    }
}

const REPORT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 1.5h5.5L12.5 4.5v10H4z"/><path d="M6 7.5h4.5M6 10h4.5M6 12.5h3"/></svg>'

// region inspector

function setupInspector(root: HTMLElement, viewer: ThreeViewer, ux: SelectionUxPlugin) {
    const fields: {[k: string]: HTMLInputElement} = {}
    root.innerHTML = '<h3><span id="insp-title">Design</span><small id="insp-sub"></small></h3>'
    // object → geometry, like Figma's vector edit
    const geoBtn = document.createElement('button')
    geoBtn.className = 'insp-geo'
    root.appendChild(geoBtn)
    geoBtn.onclick = () => {
        if (ux.geometryEdit) ux.exitGeometryEdit()
        else if (ux.selected[0]) ux.enterGeometryEdit(ux.selected[0])
    }
    const body = document.createElement('div')
    root.appendChild(body)
    const empty = document.createElement('div')
    empty.className = 'insp-empty'
    empty.textContent = 'Select something to see its position, rotation and size. Drag a field label to scrub.'
    root.appendChild(empty)
    // with nothing selected, the scene's own settings (saved in the .glb), like Figma's page settings; the toolbar's
    // Overlays and Shading are view settings for editing, never saved
    const sceneEl = document.createElement('div')
    sceneEl.className = 'insp-scene'
    sceneEl.innerHTML = '<div class="sub">Background <small>saved in the .glb</small></div>' +
        '<div class="insp-row"><input type="color" aria-label="Background colour"><label><input type="checkbox"> Transparent</label></div>'
    root.appendChild(sceneEl)
    const bgColor = sceneEl.querySelector<HTMLInputElement>('input[type=color]')!
    const bgClear = sceneEl.querySelector<HTMLInputElement>('input[type=checkbox]')!
    let lastColor = '#ffffff'
    const setBackground = (color: string | null) => {
        const sc = viewer.scene
        const before = {background: sc.background, color: sc.backgroundColor?.clone() ?? null}
        const after = {background: color === null ? null : sc.background, color: color === null ? null : new Color(color)}
        const set = (v: typeof before) => () => {
            sc.background = v.background
            sc.backgroundColor = v.color?.clone() ?? null
            sc.setDirty()
            refreshScene()
        }
        set(after)()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: set(before), redo: set(after)})
    }
    bgColor.addEventListener('change', () => setBackground(bgColor.value))
    bgClear.addEventListener('change', () => setBackground(bgClear.checked ? null : lastColor))
    const refreshScene = () => {
        const c = viewer.scene.backgroundColor
        if (c) lastColor = '#' + c.getHexString()
        bgColor.value = lastColor
        bgColor.disabled = !c
        bgClear.checked = !c && !viewer.scene.background
    }
    viewer.scene.addEventListener('backgroundChanged', refreshScene)
    refreshScene()

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
            input.addEventListener('focus', () => {
                input.dataset.prev = input.value
            })
            input.addEventListener('change', () => {
                // math like in Figma: "10/4", and +5, *2, /2 change the value it had
                const v = evalField(input.value, parseFloat(input.dataset.prev ?? '') || 0)
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
        sceneEl.style.display = sel.length ? 'none' : ''
        document.getElementById('insp-title')!.textContent = sel.length > 1 ? `${sel.length} selected` : sel.length ? ux.displayName(sel[0]) : 'Scene'
        const one = sel.length === 1 ? sel[0] : undefined
        document.getElementById('insp-sub')!.textContent = one ? one.isLight ? 'Light' : one.isCamera ? 'Camera' : one.geometry ? one.geometry.userData?.generationParams ? 'Generated ' + one.geometry.userData.generationParams.type : 'Mesh' : 'Group' : ''
        geoBtn.style.display = one?.geometry || ux.geometryEdit ? '' : 'none'
        geoBtn.textContent = ux.geometryEdit ? 'Done editing geometry  Esc' : 'Edit geometry  ⏎'
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

/** A number field's text: a number, simple math ("10/4", "2*(1+3)"), or +n *n /n applied to the previous value */
function evalField(text: string, prev: number) {
    let t = text.trim().replace(/,/g, '.')
    if (/^[+*/]/.test(t)) t = prev + t
    if (!/^[-+*/().\d\s.eE]+$/.test(t)) return NaN
    try {
        // only digits and operators get here
        return Number(new Function(`return (${t})`)())
    } catch (e) {
        return NaN
    }
}
