import {
    _testFinish,
    _testStart,
    Box3,
    Color,
    DropzonePlugin,
    IMaterial,
    IObject3D,
    ITexture,
    LoadingScreenPlugin,
    PickingPlugin,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'
import {BlendFile, BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'
import {
    BlenderDemoFile,
    blenderCameraView,
    blenderDemoFiles,
    creditLine,
    demoFileFromQuery,
    fitFov,
    sceneCameraName,
} from '../examples-utils/blender-demo-files.js'

// What's inside a .blend: the file's own preview, its collections and objects as in Blender's Outliner, each
// object's modifier stack and what the importer did with it, and the materials and images. The rows and the 3D view
// select together.

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    dropzone: {
        allowedExtensions: ['blend'],
        addOptions: {disposeSceneObjects: true, autoCenter: false, autoScale: false},
    },
    plugins: [LoadingScreenPlugin, ProgressivePlugin, SSAAPlugin, SSAOPlugin],
})
const blendLoader = viewer.addPluginSync(BlendLoadPlugin)
const dropzone = viewer.getPlugin(DropzonePlugin)!
const picking = viewer.addPluginSync(PickingPlugin)
picking.hoverEnabled = true
picking.widgetEnabled = false // the outline shows the selection
const outline = viewer.addPluginSync(SelectionOutlinePlugin)
outline.color.set('#ffa033') // Blender's active object outline
outline.hoverColor.set('#ffd08a')
outline.antialias = true

// ── Blender's DNA, the parts this page reads ───────────────────────────────────────────────────────────────────────

// Object.type (DNA_object_types.h)
const OBJECT_TYPES: Record<number, string> = {
    0: 'Empty', 1: 'Mesh', 2: 'Curve', 3: 'Surface', 4: 'Text', 5: 'Metaball', 10: 'Light', 11: 'Camera',
    12: 'Speaker', 13: 'Light probe', 22: 'Lattice', 25: 'Armature', 26: 'Grease Pencil', 27: 'Curves',
    28: 'Point cloud', 29: 'Volume', 30: 'Grease Pencil',
}
// ModifierData.type (DNA_modifier_types.h), the common ones
const MODIFIER_TYPES: Record<number, string> = {
    1: 'Subdivision', 2: 'Lattice', 3: 'Curve', 4: 'Build', 5: 'Mirror', 6: 'Decimate', 7: 'Wave', 8: 'Armature',
    9: 'Hook', 11: 'Boolean', 12: 'Array', 13: 'Edge Split', 14: 'Displace', 16: 'Smooth', 19: 'Particles',
    22: 'Cloth', 23: 'Collision', 24: 'Bevel', 25: 'Shrinkwrap', 27: 'Mask', 28: 'Simple Deform', 29: 'Multires',
    33: 'Solidify', 34: 'Screw', 40: 'Dynamic Paint', 41: 'Remesh', 42: 'Skin', 44: 'Triangulate',
    48: 'Wireframe', 49: 'Data Transfer', 50: 'Normal Edit', 54: 'Weighted Normal', 55: 'Weld', 57: 'Geometry Nodes',
}
// what BlendLoadPlugin builds (src/loader/mesh.ts); "Smooth by Angle" node groups are read as Auto Smooth
const SUPPORTED_MODIFIERS = new Set([1, 5, 12, 33])
const SMOOTH_BY_ANGLE = /smooth by angle|auto ?smooth/i
const MODE_VIEWPORT = 1, MODE_RENDER = 2

const listOf = (list: any, next = (x: any) => x.next): any[] => {
    const out: any[] = []
    for (let x = list?.first; x && out.length < 100000; x = next(x)) out.push(x)
    return out
}
const modifiersOf = (o: any) => listOf(o.modifiers, m => m.modifier?.next)

/** "2.80", "3.5", "4.2" from the file's header version ("280", "305", "0402") */
function blenderVersion(blend: BlendFile): string {
    const v = String(blend.template?.version ?? '')
    if (!/^\d{3,4}$/.test(v)) return '?'
    const major = v.length === 4 ? parseInt(v.slice(0, 2)) : parseInt(v[0])
    const minor = parseInt(v.slice(v.length === 4 ? 2 : 1))
    return major < 3 ? `${major}.${String(minor).padStart(2, '0')}` : `${major}.${minor}`
}

function activeScene(blend: BlendFile): any {
    const scenes = blend.objects.Scene ?? []
    const current = blend.objects.FileGlobal?.[0]?.curscene
    return scenes.includes(current) ? current : scenes[0]
}

type ChipKind = 'ok' | 'off' | 'no' | 'dim'
interface Chip {text: string, kind: ChipKind, title: string}

function modifierChips(o: any, mode: 'viewport' | 'render'): Chip[] {
    return modifiersOf(o).map((m) => {
        const type = m.modifier?.type as number
        const typeName = MODIFIER_TYPES[type] ?? `Modifier ${type}`
        const name = String(m.modifier?.name ?? '') || typeName
        const enabled = typeof m.modifier?.mode !== 'number' || !!(m.modifier.mode & (mode === 'render' ? MODE_RENDER : MODE_VIEWPORT))
        const smooth = type === 57 && SMOOTH_BY_ANGLE.test(m.node_group?.aname ?? '')
        let text = smooth ? 'Smooth by Angle' : typeName
        if (type === 1) text += ' ' + ((mode === 'render' ? m.renderLevels ?? m.levels : m.levels ?? m.renderLevels) ?? '')
        if (type === 12 && m.count) text += ` ×${m.count}`
        const label = name !== typeName ? `"${name}", ` : ''
        if (!enabled) return {text, kind: 'off', title: `${label}off in the ${mode}: skipped, as in Blender`}
        if (SUPPORTED_MODIFIERS.has(type) || smooth) return {text, kind: 'ok', title: `${label}applied by the importer`}
        return {text, kind: 'no', title: `${label}not supported by the importer: the mesh is as it was before it`}
    })
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────────

const state = {
    file: demoFileFromQuery('race-spaceship') as BlenderDemoFile | undefined,
    loading: false,
    tab: 'objects' as 'objects' | 'materials' | 'images',
    blenderLights: false,
}
let parsed: BlendFile | undefined
let root: IObject3D | undefined
const onBlendLoad = (blend: BlendFile) => parsed = blend
dropzone.importOptions = {...dropzone.importOptions, onBlendLoad} as typeof dropzone.importOptions

// the importer's notes, for the missing images
const notes: string[] = []
const warn = console.warn
console.warn = (...args: any[]) => {
    const text = args.map(String).join(' ')
    if (/^BlendLoad(er|Plugin)/.test(text)) notes.push(text)
    warn.apply(console, args)
}

const ICONS: Record<string, string> = {
    collection: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    Mesh: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    Camera: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    Light: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    Empty: '<path d="M12 2v20"/><path d="M2 12h20"/><path d="m4.9 4.9 14.2 14.2"/>',
    other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
}
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.other}</svg>`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (className) e.className = className
    if (text !== undefined) e.textContent = text
    return e
}

// The panel on the right: Outliner, Materials, Images
const panel = el('section', 'bi-panel')
panel.setAttribute('aria-label', 'Contents of the .blend')
const tabs = el('div', 'bi-tabs')
tabs.setAttribute('role', 'tablist')
const list = el('div', 'bi-list')
const details = el('div', 'bi-details')
panel.append(tabs, list, details)
viewer.container.appendChild(panel)

// The file's summary in the card: the preview saved in the .blend, and its counts
const summary = el('div', 'bi-summary')
const credit = el('div')

const rowOf = new Map<IObject3D, HTMLElement>()
const collapsed = new Set<string>()

function objectRow(o: any, depth: number, childrenOf: Map<any, any[]>, parentKey: string): HTMLElement[] {
    const type = OBJECT_TYPES[o.type] ?? 'Object'
    const obj = root?.getObjectByName(o.aname) as IObject3D | undefined
    const kids = childrenOf.get(o) ?? []
    const key = parentKey + '/' + o.aname
    const row = el('div', 'bi-row')
    row.style.setProperty('--depth', String(depth))
    row.setAttribute('role', 'treeitem')
    const twist = el('button', 'bi-twist')
    twist.type = 'button'
    if (kids.length) {
        twist.innerHTML = icon('chevron')
        twist.setAttribute('aria-label', collapsed.has(key) ? 'Expand' : 'Collapse')
        twist.classList.toggle('open', !collapsed.has(key))
        twist.addEventListener('click', (e) => {
            e.stopPropagation()
            if (collapsed.has(key)) collapsed.delete(key)
            else collapsed.add(key)
            render()
        })
    } else twist.disabled = true
    const ic = el('span', 'bi-icon bi-icon-' + type.toLowerCase().replace(/\s/g, '-'))
    ic.innerHTML = icon(type)
    const name = el('span', 'bi-name', o.aname)
    row.append(twist, ic, name)
    const chips = o.type === 1 ? modifierChips(o, blendLoader.evaluationMode) : []
    if (chips.length) {
        const wrap = el('span', 'bi-chips')
        for (const c of chips) {
            const chip = el('span', 'bi-chip bi-chip-' + c.kind, c.text)
            chip.title = c.title
            wrap.appendChild(chip)
        }
        row.appendChild(wrap)
    }
    if (obj) {
        rowOf.set(obj, row)
        row.tabIndex = 0
        row.addEventListener('click', () => select(obj, true))
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                select(obj, true)
            }
        })
        if (!obj.visible) row.classList.add('bi-hidden')
        if (o.type === 1 && !(obj as any).geometry?.attributes?.position?.count && !obj.children.length) {
            row.classList.add('bi-hidden')
            row.title = 'Empty mesh: no vertices in the file'
        }
    } else {
        row.classList.add('bi-missing')
        row.title = `${type}: not imported`
    }
    const rows: HTMLElement[] = [row]
    if (!collapsed.has(key)) for (const k of kids) rows.push(...objectRow(k, depth + 1, childrenOf, key))
    return rows
}

function renderObjects() {
    if (!parsed) return
    const scene = activeScene(parsed)
    const rows: HTMLElement[] = []
    const byName = (a: any, b: any) => String(a.aname).localeCompare(String(b.aname), undefined, {numeric: true})
    const tree = (objects: any[], depth: number, key: string) => {
        // sorted by name, and children under their parent when both are here, as Blender's Outliner shows them
        objects = [...objects].sort(byName)
        const here = new Set(objects)
        const childrenOf = new Map<any, any[]>()
        for (const o of objects) if (o.parent && here.has(o.parent)) childrenOf.set(o.parent, [...childrenOf.get(o.parent) ?? [], o])
        for (const o of objects) if (!o.parent || !here.has(o.parent)) rows.push(...objectRow(o, depth, childrenOf, key))
    }
    const collection = (c: any, depth: number, key: string) => {
        const k = key + '/' + c.aname
        const objects = listOf(c.gobject).map(co => co.ob).filter(Boolean)
        const children = listOf(c.children).map(cc => cc.collection).filter(Boolean)
        const row = el('div', 'bi-row bi-collection')
        row.style.setProperty('--depth', String(depth))
        const twist = el('button', 'bi-twist')
        twist.type = 'button'
        twist.innerHTML = icon('chevron')
        twist.classList.toggle('open', !collapsed.has(k))
        twist.setAttribute('aria-label', collapsed.has(k) ? 'Expand' : 'Collapse')
        const toggle = () => {
            if (collapsed.has(k)) collapsed.delete(k)
            else collapsed.add(k)
            render()
        }
        twist.addEventListener('click', toggle)
        row.addEventListener('click', toggle)
        const ic = el('span', 'bi-icon bi-icon-collection')
        ic.innerHTML = icon('collection')
        row.append(twist, ic, el('span', 'bi-name', c.aname), el('span', 'bi-count', String(objects.length + children.length)))
        rows.push(row)
        if (collapsed.has(k)) return
        for (const ch of children) collection(ch, depth + 1, k)
        tree(objects, depth + 1, k)
    }
    if (scene?.master_collection) { // Blender 2.80+: collections
        const master = scene.master_collection
        for (const ch of listOf(master.children).map(cc => cc.collection).filter(Boolean)) collection(ch, 0, '')
        tree(listOf(master.gobject).map(co => co.ob).filter(Boolean), 0, '')
    } else { // older files: the scene's objects (its bases)
        const bases = listOf(scene?.base).map(b => b.object).filter(Boolean)
        tree(bases.length ? bases : parsed.objects.Object ?? [], 0, '')
    }
    list.replaceChildren(...rows)
    list.setAttribute('role', 'tree')
}

const MAPS: [keyof any, string][] = [['map', 'Color'], ['normalMap', 'Normal'], ['bumpMap', 'Bump'], ['roughnessMap', 'Roughness'],
    ['metalnessMap', 'Metallic'], ['emissiveMap', 'Emission'], ['alphaMap', 'Alpha'], ['transmissionMap', 'Transmission'], ['aoMap', 'AO']]

function thumbnail(texture: ITexture | undefined, size = 28): HTMLElement | undefined {
    const image = texture?.image as any
    if (!image || !(image.width > 0)) return undefined
    const canvas = el('canvas', 'bi-thumb')
    canvas.width = canvas.height = size * 2
    try {
        if (image.data && !image.getContext) return undefined // a DataTexture (TGA): no quick preview
        canvas.getContext('2d')!.drawImage(image, 0, 0, size * 2, size * 2)
    } catch {
        return undefined
    }
    return canvas
}

function sceneMaterials(): Map<IMaterial, IObject3D[]> {
    const users = new Map<IMaterial, IObject3D[]>()
    root?.traverse((o: any) => {
        if (!o.isMesh) return
        for (const m of [o.material].flat()) if (m) users.set(m, [...users.get(m) ?? [], o])
    })
    return users
}

function renderMaterials() {
    const rows: HTMLElement[] = []
    for (const [m, users] of sceneMaterials()) {
        const mat = m as any
        const row = el('div', 'bi-row bi-row-tall')
        row.tabIndex = 0
        const swatch = thumbnail(mat.map) ?? el('span', 'bi-swatch')
        if (swatch.classList.contains('bi-swatch')) swatch.style.background = '#' + ((mat.color as Color | undefined)?.getHexString() ?? 'cccccc')
        const text = el('div', 'bi-text')
        text.append(el('span', 'bi-name', m.name || 'Material'))
        const maps = MAPS.filter(([k]) => mat[k]).map(([, label]) => label)
        const extra = [mat.transmission > 0 && 'Glass', mat.emissiveIntensity > 0 && mat.emissive?.getHex() && !mat.emissiveMap && 'Emissive'].filter(Boolean)
        text.append(el('span', 'bi-sub', [...maps.length ? [maps.join(' · ')] : ['No textures'], ...extra].join(' · ')))
        row.append(swatch, text, el('span', 'bi-count', String(users.length)))
        row.title = `${users.length} object${users.length === 1 ? '' : 's'}: click to select the first`
        row.addEventListener('click', () => select(users[0], true))
        rows.push(row)
    }
    if (!rows.length) rows.push(el('p', 'bi-empty', 'No materials'))
    list.replaceChildren(...rows)
    list.setAttribute('role', 'list')
}

function renderImages() {
    const textures = new Map<string, ITexture>()
    for (const m of sceneMaterials().keys()) for (const [k] of MAPS) {
        const t = (m as any)[k] as ITexture | undefined
        if (t?.name) textures.set(t.name, t)
    }
    const warned = notes.join('\n')
    const rows: HTMLElement[] = []
    // not "Render Result" and "Viewer Node": Blender's own buffers, not images of the file
    for (const img of (parsed?.objects.Image ?? []).filter((i: any) => i.source !== 5)) {
        const path = typeof img.name === 'string' ? img.name : ''
        const file = path.split(/[\\/]/).pop() || img.aname
        const packed = !!(img.packedfile || img.packedfiles?.first)
        const generated = img.source === 4 // GENERATED: made in Blender, no file
        const missing = !packed && !generated && (warned.includes(file) || warned.includes(img.aname))
        const used = textures.has(img.aname)
        const status: Chip = generated ? {text: 'Generated', kind: 'dim', title: 'Made in Blender, no file'}
            : packed ? {text: 'Packed', kind: 'ok', title: 'Inside the .blend'}
                : missing ? {text: 'Missing', kind: 'no', title: `Not found next to the .blend: ${path}`}
                    : {text: 'External', kind: 'ok', title: `Loaded from ${path}, next to the .blend`}
        const row = el('div', 'bi-row bi-row-tall')
        const thumb = thumbnail(textures.get(img.aname)) ?? el('span', 'bi-swatch bi-swatch-empty')
        const text = el('div', 'bi-text')
        const w = textures.get(img.aname)?.image?.width, h = textures.get(img.aname)?.image?.height
        const sub = [w && h ? `${w}×${h}` : '', packed ? '' : path, !used && !missing && !generated ? 'not used by a material' : '']
        text.append(el('span', 'bi-name', img.aname), el('span', 'bi-sub', sub.filter(Boolean).join(' · ') || ' '))
        const chip = el('span', 'bi-chip bi-chip-' + status.kind, status.text)
        chip.title = status.title
        row.append(thumb, text, chip)
        rows.push(row)
    }
    if (!rows.length) rows.push(el('p', 'bi-empty', 'No images'))
    list.replaceChildren(...rows)
    list.setAttribute('role', 'list')
}

function renderTabs() {
    const counts = {
        objects: parsed?.objects.Object?.length ?? 0,
        materials: sceneMaterials().size,
        images: (parsed?.objects.Image ?? []).filter((i: any) => i.source !== 5).length,
    }
    tabs.replaceChildren(...(['objects', 'materials', 'images'] as const).map((t) => {
        const b = el('button', 'bi-tab')
        b.type = 'button'
        b.setAttribute('role', 'tab')
        b.setAttribute('aria-selected', String(state.tab === t))
        b.append(t === 'objects' ? 'Outliner' : t[0].toUpperCase() + t.slice(1), el('span', 'bi-count', String(counts[t])))
        b.addEventListener('click', () => {
            state.tab = t
            render()
        })
        return b
    }))
}

function render() {
    rowOf.clear()
    renderTabs()
    if (state.tab === 'objects') renderObjects()
    else if (state.tab === 'materials') renderMaterials()
    else renderImages()
    showSelection()
}

// the selected object: highlight its row, and show what it is under the list
function showSelection() {
    const selected = picking.getSelectedObject() as IObject3D | undefined
    let row: HTMLElement | undefined
    for (let o: any = selected; o && !row; o = o.parent) row = rowOf.get(o)
    list.querySelectorAll('.bi-selected').forEach(r => r.classList.remove('bi-selected'))
    row?.classList.add('bi-selected')
    row?.scrollIntoView({block: 'nearest'})
    details.replaceChildren()
    const blendObject = selected && parsed?.objects.Object?.find((o: any) => o.aname === selected.name)
    details.hidden = !blendObject
    if (!blendObject || !selected) return
    const type = OBJECT_TYPES[blendObject.type] ?? 'Object'
    const head = el('div', 'bi-details-head')
    const ic = el('span', 'bi-icon bi-icon-' + type.toLowerCase())
    ic.innerHTML = icon(type)
    head.append(ic, el('strong', '', blendObject.aname), el('span', 'bi-sub', type + (blendObject.data?.aname ? ` · ${blendObject.data.aname}` : '')))
    details.appendChild(head)
    const facts: [string, string][] = []
    const geometry = (selected as any).geometry
    if (geometry) {
        const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3
        facts.push(['Vertices', geometry.attributes.position.count.toLocaleString()], ['Triangles', Math.round(tris).toLocaleString()])
        const mats = [(selected as any).material].flat().filter(Boolean).map((m: any) => m.name).filter(Boolean)
        if (mats.length) facts.push([mats.length > 1 ? 'Materials' : 'Material', mats.join(', ')])
    }
    const loc = blendObject.loc ? Array.from(blendObject.loc as number[]).map(v => v.toFixed(2)).join(', ') : ''
    if (loc) facts.push(['Location', loc + ' m'])
    const chips = modifierChips(blendObject, blendLoader.evaluationMode)
    if (chips.length) facts.push(['Modifiers', chips.map(c => `${c.text} (${c.kind === 'ok' ? 'applied' : c.kind === 'off' ? 'off' : 'not supported'})`).join(', ')])
    const dl = el('dl')
    for (const [k, v] of facts) dl.append(el('dt', '', k), el('dd', '', v))
    details.appendChild(dl)
}

function select(object: IObject3D | undefined, frame = false) {
    picking.setSelectedObject(object)
    // frame it, unless it has nothing to see (an empty mesh, a light)
    if (object && frame && !new Box3().setFromObject(object).isEmpty()) viewer.fitToView(object, 2, 600)
}
picking.addEventListener('selectedObjectChanged', showSelection)

function renderSummary() {
    summary.replaceChildren()
    if (!parsed) return
    const thumb = parsed.thumbnail
    if (thumb?.width) {
        // RGBA, one pixel per Uint32, rows bottom-up
        const canvas = el('canvas', 'bi-preview')
        canvas.width = thumb.width
        canvas.height = thumb.height
        const ctx = canvas.getContext('2d')!
        const image = ctx.createImageData(thumb.width, thumb.height)
        const bytes = new Uint8ClampedArray(thumb.data.buffer, thumb.data.byteOffset, thumb.data.byteLength)
        const row = thumb.width * 4
        for (let y = 0; y < thumb.height; y++) image.data.set(bytes.subarray((thumb.height - 1 - y) * row, (thumb.height - y) * row), y * row)
        ctx.putImageData(image, 0, 0)
        canvas.title = 'The preview Blender saved in the file'
        summary.appendChild(canvas)
    }
    const objects = parsed.objects.Object ?? []
    const byType = (t: number) => objects.filter((o: any) => o.type === t).length
    const images = (parsed.objects.Image ?? []).filter((i: any) => i.source !== 5)
    const scene = activeScene(parsed)
    const facts: [string, string][] = [
        ['Saved with', `Blender ${blenderVersion(parsed)}`],
        ['Scene', `${scene?.aname ?? '-'}${(parsed.objects.Scene?.length ?? 0) > 1 ? ` (of ${parsed.objects.Scene!.length})` : ''}`],
        ['Objects', [[byType(1), 'mesh', 'meshes'], [byType(10), 'light', 'lights'], [byType(11), 'camera', 'cameras']]
            .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(', ')],
        ['Modifiers', String(objects.reduce((n: number, o: any) => n + modifiersOf(o).length, 0))],
        ['Images', `${images.length}, ${images.filter((i: any) => i.packedfile || i.packedfiles?.first).length} packed`],
    ]
    const dl = el('dl')
    for (const [k, v] of facts) dl.append(el('dt', '', k), el('dd', '', v))
    summary.appendChild(dl)
}

function setLights(on: boolean) {
    root?.traverse((o: any) => {
        if (o.isLight) o.visible = on
    })
}

function onLoaded(object: IObject3D | undefined) {
    root = object
    picking.setSelectedObject(undefined)
    collapsed.clear()
    if (object) {
        setLights(state.blenderLights)
        const center = new Box3().setFromObject(object).getCenter(new Vector3())
        const view = parsed && blenderCameraView(object, sceneCameraName(parsed), center)
        const camera = viewer.scene.mainCamera
        if (view) {
            camera.position.copy(view.position as Vector3)
            camera.target.copy(view.target as Vector3)
            camera.fov = fitFov(view, viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1))
            camera.setDirty()
        } else viewer.fitToView(object, 1.2)
    }
    credit.replaceChildren(...state.file ? [creditLine(state.file)] : [])
    renderSummary()
    render()
}

async function loadDemo(file: BlenderDemoFile) {
    if (state.loading) return
    state.loading = true
    state.file = file
    notes.length = 0
    parsed = undefined
    try {
        onLoaded(await viewer.load<IObject3D>(file.url, {disposeSceneObjects: true, autoCenter: false, autoScale: false, onBlendLoad} as any))
    } finally {
        state.loading = false
    }
}

viewer.container.addEventListener('drop', () => {
    notes.length = 0
    parsed = undefined
}, true)
dropzone.addEventListener('drop', (e: any) => {
    const object = (e.assets as any[] | undefined)?.find(a => a?.isObject3D)
    if (!object) return
    state.file = undefined
    onLoaded(object)
})

viewer.scene.backgroundColor = new Color(0xdde1e6)

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    if (state.file) await loadDemo(state.file)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'What is inside a .blend: the preview Blender saved, its collections and objects, each modifier stack and what the importer did with it, the materials and the images. Click a row or an object to select it.',
        actions: [
            {type: 'dropdown', label: 'Scene', icon: 'box',
                children: [...blenderDemoFiles.map(f => ({label: f.label, value: f.id})), {label: 'Your file', value: ''}],
                getValue: () => state.file?.id ?? '',
                setValue: (id: string) => {
                    const file = blenderDemoFiles.find(f => f.id === id)
                    if (file) loadDemo(file)
                },
                disabled: () => state.loading},
            {type: 'button', label: 'Open .blend…', icon: 'file-code', value: () => dropzone.promptForFile()},
            {type: 'dropdown', label: 'Modifiers', icon: 'layers',
                children: [{label: 'Viewport', value: 'viewport'}, {label: 'Render', value: 'render'}],
                getValue: () => blendLoader.evaluationMode,
                setValue: (mode: 'viewport' | 'render') => {
                    blendLoader.evaluationMode = mode
                    if (state.file) loadDemo(state.file)
                    else render()
                },
                disabled: () => state.loading || !state.file},
            {type: 'checkbox', label: 'Blender lights', icon: 'lightbulb',
                getValue: () => state.blenderLights,
                setValue: (on: boolean) => {
                    state.blenderLights = on
                    setLights(on)
                }},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
        ],
        content: [summary, credit],
    })
}

const style = document.createElement('style')
style.textContent = `
.bi-panel {
    --bi-bg: #ffffff; --bi-fg: #1e1e1e; --bi-dim: #757575; --bi-line: #e6e6e6; --bi-hover: rgba(127, 127, 127, .12);
    --bi-sel: rgba(255, 160, 51, .18); --bi-ok: #2f8f4e; --bi-ok-bg: rgba(47, 143, 78, .12); --bi-no: #b45309; --bi-no-bg: rgba(217, 119, 6, .14);
    position: absolute; z-index: 300; top: 16px; right: 16px; width: 320px; max-height: calc(100% - 32px);
    display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;
    background: var(--bi-bg); color: var(--bi-fg); border-radius: 10px;
    box-shadow: 0 0 0 1px var(--bi-line), 0 6px 20px rgba(0, 0, 0, .08);
    font: 400 12px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
    .bi-panel { --bi-bg: #2c2c2c; --bi-fg: #fff; --bi-dim: #b3b3b3; --bi-line: #444; --bi-ok: #6fcf8f; --bi-no: #f0a35a; }
}
.bi-tabs { display: flex; gap: 2px; padding: 6px 6px 0; border-bottom: 1px solid var(--bi-line); }
.bi-tab { all: unset; cursor: pointer; padding: 6px 8px 7px; color: var(--bi-dim); font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -1px; display: inline-flex; gap: 5px; align-items: center; }
.bi-tab[aria-selected="true"] { color: var(--bi-fg); border-bottom-color: #ffa033; }
.bi-tab:focus-visible { outline: 2px solid #0d99ff; outline-offset: -2px; border-radius: 4px; }
.bi-list { overflow-y: auto; padding: 4px 0; min-height: 60px; flex: 1; }
.bi-row { display: flex; align-items: center; gap: 4px; padding: 0 8px 0 calc(6px + var(--depth, 0) * 14px); min-height: 24px; cursor: pointer; white-space: nowrap; }
.bi-row:hover { background: var(--bi-hover); }
.bi-row:focus-visible { outline: 2px solid #0d99ff; outline-offset: -2px; }
.bi-row.bi-selected { background: var(--bi-sel); }
.bi-row-tall { min-height: 40px; gap: 8px; padding-left: 10px; }
.bi-collection .bi-name { font-weight: 500; }
.bi-missing, .bi-hidden { opacity: .45; }
.bi-missing { cursor: default; }
.bi-twist { all: unset; width: 14px; height: 14px; display: inline-flex; color: var(--bi-dim); flex-shrink: 0; cursor: pointer; }
.bi-twist:disabled { visibility: hidden; }
.bi-twist svg { width: 12px; height: 12px; margin: 1px; transition: transform .12s; }
.bi-twist.open svg { transform: rotate(90deg); }
.bi-icon { display: inline-flex; flex-shrink: 0; }
.bi-icon svg { width: 14px; height: 14px; }
.bi-icon-collection { color: #8d8d8d; }
.bi-icon-mesh { color: #e08a2c; }
.bi-icon-camera { color: #8a6fd1; }
.bi-icon-light { color: #c9a227; }
.bi-icon-empty { color: #5a9bd5; }
.bi-name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.bi-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.bi-text .bi-name { font-weight: 500; }
.bi-sub { color: var(--bi-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.bi-count { color: var(--bi-dim); font-size: 11px; margin-left: auto; padding-left: 6px; font-variant-numeric: tabular-nums; }
.bi-tab .bi-count { margin-left: 0; padding-left: 0; }
.bi-chips { display: inline-flex; gap: 3px; margin-left: auto; padding-left: 6px; flex-shrink: 0; }
.bi-chip { font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px; white-space: nowrap; flex-shrink: 0; }
.bi-chip-ok { color: var(--bi-ok); background: var(--bi-ok-bg); }
.bi-chip-off { color: var(--bi-dim); background: var(--bi-hover); text-decoration: line-through; }
.bi-chip-no { color: var(--bi-no); background: var(--bi-no-bg); }
.bi-chip-dim { color: var(--bi-dim); background: var(--bi-hover); }
.bi-row-tall .bi-chip { margin-left: auto; }
.bi-thumb, .bi-swatch { width: 28px; height: 28px; border-radius: 5px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .1); object-fit: cover; }
.bi-swatch-empty { background: repeating-conic-gradient(var(--bi-hover) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.bi-empty { color: var(--bi-dim); padding: 8px 12px; margin: 0; }
.bi-details { border-top: 1px solid var(--bi-line); padding: 8px 12px 10px; }
.bi-details-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.bi-details-head .bi-sub { margin-left: auto; }
.bi-details dl, .bi-summary dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; margin: 0; }
.bi-details dt, .bi-summary dt { color: var(--bi-dim, var(--ec-dim)); }
.bi-details dd, .bi-summary dd { margin: 0; overflow-wrap: anywhere; }
.bi-summary { display: flex; gap: 10px; align-items: flex-start; margin: 2px 6px 8px; }
.bi-summary dl { font-size: 11px; }
.bi-summary dt { color: var(--ec-dim); }
.bi-preview { width: 72px; height: 72px; border-radius: 6px; flex-shrink: 0; box-shadow: 0 0 0 1px var(--ec-line); }
.blender-demo-credit { margin: 0 6px 4px !important; }
.blender-demo-credit a { color: inherit; }
@media (max-width: 640px) {
    .bi-panel { top: 12px; right: 12px; left: 12px; width: auto; max-height: 38%; }
    .bi-details { display: none; }
}
`
document.head.appendChild(style)

_testStart()
init().finally(_testFinish)
