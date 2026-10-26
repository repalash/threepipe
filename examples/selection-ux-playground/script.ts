import {
    _testFinish,
    _testStart,
    BoxGeometry,
    CylinderGeometry,
    GridHelper,
    Group2,
    IObject3D,
    LoadingScreenPlugin,
    Matrix4,
    Mesh,
    PhysicalMaterial,
    PickingPlugin,
    SphereGeometry,
    ThreeViewer,
    TorusGeometry,
    TransformControlsPlugin,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {defaultSelectionUxSettings, SelectionUxPlugin, SelectionUxSettings, TransformSnapshot} from './SelectionUxPlugin'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'fbx', 'obj', '3dm', 'hdr', 'exr', 'bin', 'png', 'jpg', 'jpeg', 'webp'],
            addOptions: {autoCenter: true, autoScale: true, autoScaleRadius: 2.5},
        },
        plugins: [LoadingScreenPlugin, UndoManagerPlugin],
    })
    viewer.scene.setBackgroundColor('#eef0f3')

    const picking = viewer.addPluginSync(new PickingPlugin(undefined, false))
    const ux = viewer.addPluginSync(SelectionUxPlugin)
    Object.assign(window, {viewer, ux}) // for poking from the console

    const grid = new GridHelper(40, 40, 0xc4c8cf, 0xdadde2)
    grid.userData.userSelectable = false
    grid.userData.bboxVisible = false
    viewer.scene.add(grid)

    buildScene(viewer)
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()

    setupLayers(viewer, ux)
    setupSettings(viewer, ux, picking)
    setupHints(ux)

    try {
        await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    } catch (e) {
        console.warn('Environment map failed to load', e)
    }
}

// region scene

function buildScene(viewer: ThreeViewer) {
    const gold = new PhysicalMaterial({color: '#e8c372', metalness: 1, roughness: 0.22})
    const white = new PhysicalMaterial({color: '#dfe3e8', metalness: 1, roughness: 0.18})
    const gem = new PhysicalMaterial({color: '#a9dcff', metalness: 0.2, roughness: 0.04})
    const ruby = new PhysicalMaterial({color: '#d2304f', metalness: 0.2, roughness: 0.05})
    const pearl = new PhysicalMaterial({color: '#f4efe6', metalness: 0, roughness: 0.32})
    const paper = new PhysicalMaterial({color: '#e25c5c', metalness: 0, roughness: 0.6})
    const ribbon = new PhysicalMaterial({color: '#f2c94c', metalness: 0.1, roughness: 0.45})
    const leather = new PhysicalMaterial({color: '#5b4636', metalness: 0, roughness: 0.7})
    const plaster = new PhysicalMaterial({color: '#fafafa', metalness: 0, roughness: 0.8})

    const mesh = (name: string, g: any, m: PhysicalMaterial, p: [number, number, number] = [0, 0, 0], r?: [number, number, number]) => {
        const o = new Mesh(g, m)
        o.name = name
        o.position.set(...p)
        if (r) o.rotation.set(...r)
        return o
    }
    const group = (name: string, p: [number, number, number], ...children: any[]) => {
        const g = new Group2()
        g.name = name
        g.position.set(...p)
        g.add(...children)
        return g
    }

    // Ring > Band, Head > (Gem > Crown, Pavilion), Prongs > Prong 1-4, Gallery
    const prongs = [0, 1, 2, 3].map(i => {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4
        return mesh(`Prong ${i + 1}`, new CylinderGeometry(0.035, 0.05, 0.62, 12), white, [Math.cos(a) * 0.33, 0.12, Math.sin(a) * 0.33], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25])
    })
    const ring = group('Solitaire Ring', [0, 0, 0],
        mesh('Band', new TorusGeometry(1, 0.12, 32, 128), gold, [0, 1.12, 0]),
        group('Head', [0, 2.32, 0],
            group('Gem', [0, 0.2, 0],
                mesh('Crown', new CylinderGeometry(0.26, 0.4, 0.14, 16), gem, [0, 0.07, 0]),
                mesh('Pavilion', new CylinderGeometry(0.4, 0.01, 0.42, 16), gem, [0, -0.21, 0]),
            ),
            group('Prongs', [0, 0, 0], ...prongs),
            mesh('Gallery', new TorusGeometry(0.3, 0.04, 12, 48), white, [0, -0.08, 0], [Math.PI / 2, 0, 0]),
        ),
    )

    const stud = (name: string, x: number) => group(name, [x, 0, 0],
        mesh('Pearl', new SphereGeometry(0.36, 32, 16), pearl, [0, 0.62, 0]),
        mesh('Cup', new SphereGeometry(0.18, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gold, [0, 0.36, 0]),
        mesh('Post', new CylinderGeometry(0.03, 0.03, 0.3, 8), gold, [0, 0.15, 0]),
    )
    const earrings = group('Pearl Earrings', [4, 0, 0.5], stud('Left Stud', -0.6), stud('Right Stud', 0.6))

    const drop = mesh('Drop', new SphereGeometry(0.45, 32, 16), ruby, [0, 0.62, 0])
    drop.scale.set(1, 1.35, 1)
    const pendant = group('Ruby Pendant', [-4, 0, 0.5],
        drop,
        mesh('Bail', new TorusGeometry(0.16, 0.04, 12, 32), gold, [0, 1.36, 0]),
        group('Chain', [0, 0, 0], ...Array.from({length: 6}, (_, i) =>
            mesh(`Link ${i + 1}`, new TorusGeometry(0.12, 0.025, 8, 24), gold, [0, 1.62 + i * 0.2, 0], [0, i % 2 ? Math.PI / 2 : 0, 0]))),
    )

    const gift = group('Gift Box', [0, 0, -4.5],
        mesh('Base', new BoxGeometry(2, 1.2, 2), paper, [0, 0.6, 0]),
        group('Lid', [0, 1.3, 0],
            mesh('Lid Top', new BoxGeometry(2.1, 0.22, 2.1), paper),
            mesh('Bow', new TorusGeometry(0.28, 0.07, 12, 32), ribbon, [0, 0.34, 0]),
        ),
        mesh('Ribbon X', new BoxGeometry(2.04, 1.25, 0.22), ribbon, [0, 0.62, 0]),
        mesh('Ribbon Z', new BoxGeometry(0.22, 1.25, 2.04), ribbon, [0, 0.62, 0]),
    )

    // like an imported glTF: Scene > root > Watch (wrappers are merged into one level)
    const watch = group('Scene', [4.5, 0, -4.5], group('root', [0, 0, 0], group('Watch', [0, 0, 0],
        mesh('Case', new CylinderGeometry(0.9, 0.9, 0.3, 48), white, [0, 0.25, 0]),
        mesh('Dial', new CylinderGeometry(0.8, 0.8, 0.02, 48), plaster, [0, 0.41, 0]),
        mesh('Crown', new CylinderGeometry(0.12, 0.12, 0.2, 16), white, [1.0, 0.25, 0], [0, 0, Math.PI / 2]),
        mesh('Strap', new BoxGeometry(0.9, 0.1, 3.6), leather, [0, 0.05, 0]),
    )))

    const stand = mesh('Display Stand', new CylinderGeometry(1.1, 1.3, 0.5, 48), plaster, [-4.5, 0.25, -4.5])

    for (const o of [ring, earrings, pendant, gift, watch, stand]) viewer.scene.addObject(o)
}

// endregion

// region layers panel

function setupLayers(viewer: ThreeViewer, ux: SelectionUxPlugin) {
    const tree = document.getElementById('layer-tree')!
    const expanded = new Set<IObject3D>()
    const rows = new Map<IObject3D, HTMLElement>()
    let queued = false

    const isContent = (o: IObject3D) => !o.userData.isWidgetRoot && o.assetType !== 'widget' && o.userData.userSelectable !== false && !o.userData.isMultiSelectDummy
    const icon = (o: IObject3D) => o.isLight ? '☀' : o.isCamera ? '◉' : o.geometry ? '◆' : '▦'

    const build = () => {
        queued = false
        const sel = ux.selected
        // reveal the selection
        for (const s of sel) {
            let p = s.parent as IObject3D | null
            while (p && p !== viewer.scene.modelRoot) {
                expanded.add(p)
                p = p.parent as IObject3D | null
            }
        }
        const parentsOfSel = new Set<IObject3D>()
        for (const s of sel) s.traverseAncestors(a => parentsOfSel.add(a as IObject3D))
        tree.innerHTML = ''
        rows.clear()
        const add = (o: IObject3D, depth: number) => {
            const kids = (o.children as IObject3D[]).filter(isContent)
            const row = document.createElement('div')
            row.className = 'row' + (sel.includes(o) ? ' sel' : parentsOfSel.has(o) ? ' parent-of-sel' : '') + (o.visible ? '' : ' hidden-obj')
            row.style.paddingLeft = depth * 12 + 4 + 'px'
            row.innerHTML = `<span class="caret">${kids.length ? expanded.has(o) ? '▼' : '▶' : ''}</span><span class="icon">${icon(o)}</span><span class="name"></span><span class="eye" title="Show/hide (H)">${o.visible ? '👁' : '—'}</span>`
            row.querySelector('.name')!.textContent = o.name || o.type
            row.querySelector('.caret')!.addEventListener('click', e => {
                e.stopPropagation()
                if (expanded.has(o)) expanded.delete(o)
                else expanded.add(o)
                build()
            })
            row.querySelector('.eye')!.addEventListener('click', e => {
                e.stopPropagation()
                o.visible = !o.visible
                o.setDirty?.()
                viewer.setDirty()
                build()
            })
            row.addEventListener('click', e => {
                const cur = ux.selected
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    const i = cur.indexOf(o)
                    const next = [...cur]
                    if (i >= 0) next.splice(i, 1)
                    else next.unshift(o)
                    ux.select(next)
                } else ux.select([o])
            })
            row.addEventListener('dblclick', () => {
                viewer.fitToView(o, 1.25, 800, 'easeOut')
            })
            row.addEventListener('pointerenter', () => {
                ux.externalHover = o
            })
            row.addEventListener('pointerleave', () => {
                if (ux.externalHover === o) ux.externalHover = null
            })
            rows.set(o, row)
            tree.appendChild(row)
            if (expanded.has(o)) for (const k of kids) add(k, depth + 1)
        }
        for (const o of (viewer.scene.modelRoot.children as IObject3D[]).filter(isContent)) add(o, 0)
        rows.get(sel[0])?.scrollIntoView({block: 'nearest'})
    }
    const queue = () => {
        if (queued) return
        queued = true
        requestAnimationFrame(build)
    }
    ux.addEventListener('uxUpdate', e => {
        if (e.reason === 'drag' || e.reason === 'transform') return
        if (e.reason === 'hover') {
            for (const [o, r] of rows) r.style.boxShadow = o === ux.hovered ? 'inset 0 0 0 1px var(--accent)' : ''
            return
        }
        queue()
    })
    viewer.scene.addEventListener('sceneUpdate', queue)
    queue()
}

// endregion

// region settings panel

interface Opt<K extends keyof SelectionUxSettings> {key: K, label: string, options: [SelectionUxSettings[K], string][]}

const presets: {name: string, desc: string, s: Partial<SelectionUxSettings>}[] = [
    {name: 'A · Figma 2D', desc: 'Screen box, corner scale, rotate outside corners', s: {visual: 'figma2d', rotate: 'corners', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false}},
    {name: 'B · 3D box', desc: 'Line box, corner dots, face stretch, turn ring', s: {visual: 'box3d', rotate: 'ring', scalePivot: 'opposite', stretchHandles: true, xray: true}},
    {name: 'C · Brackets', desc: 'Minimal corner brackets, rotate knob', s: {visual: 'brackets', rotate: 'knob', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false, xray: false}},
    {name: 'D · Hybrid', desc: '3D box + 2D handles and side stretch', s: {visual: 'hybrid', rotate: 'corners', rotateAxis: 'view', scalePivot: 'base', stretchHandles: true, xray: true}},
    {name: 'Current', desc: 'Existing PickingPlugin box and clicks', s: {visual: 'legacy'}},
]

const options: Opt<any>[] = [
    {key: 'visual', label: 'Look', options: [['figma2d', '2D'], ['box3d', '3D box'], ['brackets', 'Brackets'], ['hybrid', 'Hybrid'], ['legacy', 'Current']]},
    {key: 'boxSpace', label: 'Box aligns to', options: [['local', 'Object'], ['world', 'World']]},
    {key: 'emptyDrag', label: 'Drag on empty', options: [['orbit', 'Orbit'], ['marquee', 'Box select']]},
    {key: 'dragMove', label: 'Drag object', options: [['any', 'Moves it'], ['selected', 'If selected'], ['off', 'Orbits']]},
    {key: 'movePlane', label: 'Move on', options: [['auto', 'Auto'], ['ground', 'Floor'], ['view', 'Screen']]},
    {key: 'scalePivot', label: 'Scale from', options: [['base', 'Base'], ['center', 'Center'], ['opposite', 'Corner']]},
    {key: 'rotate', label: 'Rotate with', options: [['corners', 'Corners'], ['knob', 'Knob'], ['ring', 'Ring'], ['off', 'Off']]},
    {key: 'rotateAxis', label: 'Rotate axis', options: [['up', 'Turntable'], ['view', 'Screen']]},
    {key: 'marquee', label: 'Box select', options: [['touch', 'Touch'], ['contain', 'Inside']]},
    {key: 'unit', label: 'Units', options: [['mm', 'mm'], ['cm', 'cm'], ['m', 'm']]},
    {key: 'accent', label: 'Color', options: [['#0d99ff', 'Blue'], ['#7b61ff', 'Violet'], ['#14ae5c', 'Green'], ['#ff7a1a', 'Orange']]},
]
const toggles: [keyof SelectionUxSettings, string][] = [
    ['stretchHandles', 'Side / face stretch handles'],
    ['smartGuides', 'Smart guides + snapping'],
    ['hover', 'Hover highlight'],
    ['showName', 'Name + breadcrumb'],
    ['showDims', 'Size label'],
    ['xray', 'Show hidden box edges'],
]

function setupSettings(viewer: ThreeViewer, ux: SelectionUxPlugin, picking: PickingPlugin) {
    const root = document.getElementById('settings')!
    const st = ux.settings
    const fromUrl = new URLSearchParams(location.search).get('preset')
    const presetIndex = fromUrl ? Math.max(0, Math.min(presets.length - 1, +fromUrl)) : 0
    Object.assign(st, presets[presetIndex].s)
    ux.applySettings()

    const inspector = document.createElement('div')
    inspector.className = 'section'
    root.appendChild(inspector)
    setupInspector(inspector, viewer, ux)

    const sec = document.createElement('div')
    sec.className = 'section'
    root.appendChild(sec)

    const render = () => {
        sec.innerHTML = '<h3>Selection UX <small>try the variants</small></h3>'
        const pr = document.createElement('div')
        pr.className = 'presets'
        presets.forEach(p => {
            const b = document.createElement('button')
            const on = Object.entries(p.s).every(([k, v]) => (st as any)[k] === v)
            b.className = on ? 'on' : ''
            b.innerHTML = `<b>${p.name}</b><span>${p.desc}</span>`
            b.onclick = () => {
                Object.assign(st, defaultSelectionUxSettings, {emptyDrag: st.emptyDrag, dragMove: st.dragMove, unit: st.unit, accent: st.accent}, p.s)
                ux.applySettings()
                render()
            }
            pr.appendChild(b)
        })
        sec.appendChild(pr)
        for (const o of options) {
            const f = document.createElement('div')
            f.className = 'field'
            f.innerHTML = `<label>${o.label}</label>`
            const seg = document.createElement('div')
            seg.className = 'seg'
            for (const [v, l] of o.options) {
                const b = document.createElement('button')
                b.textContent = l
                b.className = (st as any)[o.key] === v ? 'on' : ''
                b.onclick = () => {
                    (st as any)[o.key] = v
                    ux.applySettings()
                    render()
                }
                seg.appendChild(b)
            }
            f.appendChild(seg)
            sec.appendChild(f)
        }
        for (const [k, l] of toggles) {
            const f = document.createElement('div')
            f.className = 'field'
            f.innerHTML = `<label class="toggle"><input type="checkbox" ${(st as any)[k] ? 'checked' : ''}> ${l}</label>`
            f.querySelector('input')!.onchange = (e) => {
                (st as any)[k] = (e.target as HTMLInputElement).checked
                ux.applySettings()
                render()
            }
            sec.appendChild(f)
        }
        const gizmo = document.createElement('div')
        gizmo.className = 'field'
        gizmo.innerHTML = `<label class="toggle"><input type="checkbox" ${viewer.getPlugin(TransformControlsPlugin) ? 'checked' : ''}> Also show the current 3D gizmo</label>`
        gizmo.querySelector('input')!.onchange = (e) => {
            const on = (e.target as HTMLInputElement).checked
            const existing = viewer.getPlugin(TransformControlsPlugin)
            if (on && !existing) {
                viewer.addPluginSync(TransformControlsPlugin)
                const sel = ux.selected
                ux.select([], false)
                ux.select(sel, false)
            } else if (!on && existing) viewer.removePluginSync(existing)
        }
        sec.appendChild(gizmo)

        const btns = document.createElement('div')
        btns.className = 'btns'
        const add = (label: string, fn: () => void) => {
            const b = document.createElement('button')
            b.textContent = label
            b.onclick = fn
            btns.appendChild(b)
        }
        add('Shortcuts  ?', () => toggleHelp(true))
        add('Load helmet glTF', async() => {
            const m = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true, autoScaleRadius: 1.4})
            if (m) {
                m.position.add(new Vector3(-4.5, 1.6, 4.5))
                m.setDirty?.({change: 'transform'})
                ux.select([m])
            }
        })
        add('Undo', () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.undo())
        add('Redo', () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.redo())
        sec.appendChild(btns)
        const note = document.createElement('div')
        note.className = 'insp-empty'
        note.innerHTML = 'Drop a .glb / .gltf / .3dm on the canvas to try your own model. Link to a preset: <code>?preset=0..4</code>'
        sec.appendChild(note)
    }
    render()
    picking.enabled = true
}

// endregion

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

// region hints, toast, shortcuts

const shortcuts: [string, string][] = [
    ['Select', 'Click'],
    ['Add / remove from selection', 'Shift + Click'],
    ['Select inside a group', 'Double-click'],
    ['Select the deepest part', '⌘/Ctrl + Click'],
    ['Box select', 'Shift + Drag empty (or Drag, in Box select mode)'],
    ['Select parent', 'Esc  or  Shift + Enter'],
    ['Select children', 'Enter'],
    ['Next / previous sibling', 'Tab / Shift + Tab'],
    ['Select all at this level', '⌘/Ctrl + A'],
    ['Move', 'Drag the object'],
    ['Move on one axis', 'Shift while dragging'],
    ['Duplicate while moving', 'Alt + Drag'],
    ['Turn off snapping', 'Hold ⌘/Ctrl while dragging'],
    ['Scale from center', 'Alt + Drag a corner'],
    ['Scale in 5% steps', 'Shift + Drag a corner'],
    ['Rotate in 15° steps', 'Shift while rotating'],
    ['Cancel a drag', 'Esc'],
    ['Nudge', 'Arrow keys (Shift = ×10)'],
    ['Nudge up / down', 'Alt + ↑ / ↓'],
    ['Group / Ungroup', '⌘/Ctrl + G / ⌘/Ctrl + Shift + G'],
    ['Duplicate', '⌘/Ctrl + D'],
    ['Copy / Paste', '⌘/Ctrl + C / V'],
    ['Delete', 'Delete'],
    ['Hide / show all', 'H / Shift + H'],
    ['Zoom to selection', 'F  or  Shift + 2'],
    ['Zoom to fit all', 'Shift + 1'],
    ['Orbit (any mode)', 'Space + Drag, or Right-drag in Box select mode'],
    ['Undo / Redo', '⌘/Ctrl + Z / ⌘/Ctrl + Shift + Z'],
    ['This sheet', '?'],
]

function toggleHelp(show?: boolean) {
    const h = document.getElementById('help')!
    const on = show ?? !h.classList.contains('show')
    h.classList.toggle('show', on)
}

function setupHints(ux: SelectionUxPlugin) {
    const card = document.getElementById('help-card')!
    card.innerHTML = '<h4>Shortcuts</h4>' + shortcuts.map(([a, b]) => `<div><span>${a}</span><span>${b.split('  ').map(x => `<kbd>${x}</kbd>`).join(' ')}</span></div>`).join('')
    document.getElementById('help')!.addEventListener('click', () => toggleHelp(false))
    window.addEventListener('keydown', e => {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return
        if (e.key === '?') toggleHelp()
        else if (e.key === 'Escape') toggleHelp(false)
    })

    const hint = document.getElementById('hint')!
    const k = (s: string) => `<kbd>${s}</kbd>`
    const update = () => {
        const st = ux.settings
        if (st.visual === 'legacy') {
            hint.innerHTML = 'Current behaviour: click to select, Shift/Ctrl+click to add'
            return
        }
        const sel = ux.selected
        const orbit = st.emptyDrag === 'orbit' ? `Drag empty space to orbit · ${k('Shift')}+drag to box-select` : `Drag empty space to box-select · ${k('Space')}+drag or right-drag to orbit`
        if (!sel.length) hint.innerHTML = `Click an object to select · ${orbit} · ${k('?')} shortcuts`
        else {
            const L = ux.levels(sel[0])
            const i = L.findIndex(l => l.includes(sel[0]))
            const hasKids = L[i] && L[i][L[i].length - 1].children.length > 0 && !sel[0].geometry
            const parts = [
                st.dragMove === 'off' ? '' : 'Drag to move',
                'Corners scale',
                st.rotate === 'corners' ? 'Just outside a corner rotates' : st.rotate === 'knob' ? 'Knob rotates' : st.rotate === 'ring' ? 'Ring turns it' : '',
                hasKids ? 'Double-click to go inside' : '',
                i > 0 ? `${k('Esc')} selects parent` : `${k('Esc')} deselects`,
            ].filter(Boolean)
            hint.innerHTML = parts.join(' · ')
        }
    }
    ux.addEventListener('uxUpdate', e => {
        if (e.reason !== 'drag' && e.reason !== 'hover' && e.reason !== 'transform') update()
    })
    update()

    const toast = document.getElementById('toast')!
    let timer = 0
    ux.addEventListener('toast', e => {
        toast.textContent = e.message
        toast.classList.add('show')
        clearTimeout(timer)
        timer = window.setTimeout(() => toast.classList.remove('show'), 1800)
    })
}

// endregion

_testStart()
init().finally(_testFinish)
