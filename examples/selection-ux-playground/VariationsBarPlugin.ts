import {
    AViewerPluginSync,
    IMaterial,
    IObject3D,
    MaterialConfiguratorBasePlugin,
    MaterialVariations,
    Object3D,
    ObjectSwitchNode,
    SwitchNodeBasePlugin,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {injectMotionStyles} from './motionUi'

type Group =
    | {kind: 'material', v: MaterialVariations, mat: IMaterial}
    | {kind: 'switch', node: ObjectSwitchNode, obj: Object3D}

/**
 * A bar over the selection with its variations, like the contextual toolbar of FigJam or Whimsical:
 * - the material variations (MaterialConfiguratorPlugin) of the materials the selection uses,
 * - the options of a switch node (SwitchNodePlugin) when the selection is the switch node, one of its options, or
 *   a part inside one.
 * A click applies one, as one undo step. The bar sits above the selection (below it when the toolbar is in the way)
 * and hides while something is dragged. Previews: the file's icon when it has one, else one made once and kept.
 */
export class VariationsBarPlugin extends AViewerPluginSync {
    static readonly PluginType = 'VariationsBarPlugin'
    enabled = true
    dependencies = [SelectionUxPlugin]

    private _el = document.createElement('div')
    private _groups: Group[] = []
    private _key = ''
    private _down = false
    private _raf = 0
    private _previews = new Map<string, string>()
    private _toMake: (() => void)[] = []

    constructor() {
        super()
        this._el.className = 'mo-ui mo-card vb-root'
        this._el.dataset.ownKeys = ''
        this._el.setAttribute('role', 'toolbar')
        this._el.setAttribute('aria-label', 'Variations of the selection')
        this._el.addEventListener('pointerdown', e => e.stopPropagation())
    }

    private get _ux() {
        return this._viewer?.getPlugin(SelectionUxPlugin)
    }
    private get _materials() {
        return this._viewer?.getPlugin<MaterialConfiguratorBasePlugin>('MaterialConfiguratorPlugin')
    }
    private get _switches() {
        return this._viewer?.getPlugin<SwitchNodeBasePlugin>('SwitchNodePlugin')
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        injectStyles()
        viewer.container.appendChild(this._el)
        this._ux?.addEventListener('uxUpdate', this._onUx)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.canvas.addEventListener('pointerdown', this._onDown)
        window.addEventListener('pointerup', this._onUp)
        this._raf = requestAnimationFrame(this._tick)
        this.refresh()
    }

    onRemove(viewer: ThreeViewer) {
        this._ux?.removeEventListener('uxUpdate', this._onUx)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.canvas.removeEventListener('pointerdown', this._onDown)
        window.removeEventListener('pointerup', this._onUp)
        cancelAnimationFrame(this._raf)
        this._el.remove()
        super.onRemove(viewer)
    }

    private _onUx = (e: {reason: string}) => {
        if (e.reason === 'selection' || e.reason === 'hierarchy' || e.reason === 'settings') this.refresh()
    }
    private _onDown = () => {
        this._down = true
        this._el.classList.add('vb-hidden')
    }
    private _onUp = () => {
        if (!this._down) return
        this._down = false
        this.refresh()
    }

    /** The variation groups for the selection */
    groupsFor(sel: IObject3D[]): Group[] {
        const groups: Group[] = []
        const mc = this._materials
        if (mc && !mc.isDisabled()) {
            for (const o of sel) o.traverseVisible(m => {
                const mats = (m as IObject3D).material
                for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
                    const v = mc.findVariation(mat.uuid) || mc.findVariation(mat.name)
                    if (v && v.materials.length > 1 && !groups.some(g => g.kind === 'material' && g.v === v)) groups.push({kind: 'material', v, mat})
                }
            })
        }
        const sn = this._switches
        if (sn && !sn.isDisabled()) {
            for (const o of sel) {
                // the selection itself, or up its parents: the switch node it is an option of, or inside
                for (let p: Object3D | null = o; p && p !== this._viewer?.scene.modelRoot; p = p.parent) {
                    const node = sn.variations.find(n => n.name && n.name === p!.name)
                    if (node && p.children.length > 1) {
                        if (!groups.some(g => g.kind === 'switch' && g.node === node)) groups.push({kind: 'switch', node, obj: p})
                        break
                    }
                }
            }
        }
        return groups
    }

    refresh() {
        const ux = this._ux
        const sel = ux?.enabled ? ux.selected : []
        this._groups = sel.length ? this.groupsFor(sel) : []
        const key = this._groups.map(g => g.kind === 'material' ? g.v.uuid + ':' + g.v.selectedIndex : g.node.name + ':' + g.node.selected).join('|')
        if (key !== this._key) {
            this._key = key
            this._render()
        }
        this._el.classList.toggle('vb-hidden', !this._groups.length || this._down)
    }

    private _render() {
        this._el.innerHTML = ''
        this._groups.forEach((g, gi) => {
            if (gi) this._el.appendChild(Object.assign(document.createElement('span'), {className: 'vb-sep'}))
            const box = document.createElement('div')
            box.className = 'vb-group'
            const label = document.createElement('span')
            label.className = 'vb-label'
            label.textContent = g.kind === 'material' ? g.v.title || g.mat.name || 'Material' : g.node.title || g.node.name
            box.appendChild(label)
            const items = document.createElement('div')
            items.className = 'vb-items'
            if (g.kind === 'material') {
                const cur = g.v.selectedIndex
                g.v.materials.forEach((m, i) => {
                    const on = cur === i || cur === m.uuid
                    const b = this._swatch(m.name || `${g.v.title} ${i + 1}`, on, g.v.data?.[i]?.icon ?? this._preview(m.uuid, () => this._materials?.getPreview(m, g.v.preview || 'generate:sphere', false) ?? ''))
                    b.addEventListener('click', () => this.applyMaterial(g, i))
                    items.appendChild(b)
                })
            } else {
                g.obj.children.forEach((c, i) => {
                    const id = c.name || c.uuid
                    const icon = (c.userData as any).__icon as string | undefined
                    const b = icon ? this._swatch(c.name || `Option ${i + 1}`, g.node.selected === id, icon) : this._chip(c.name || `Option ${i + 1}`, g.node.selected === id)
                    b.addEventListener('click', () => this.applySwitch(g, id))
                    items.appendChild(b)
                })
            }
            box.appendChild(items)
            this._el.appendChild(box)
        })
    }

    private _swatch(title: string, on: boolean, src: string) {
        const b = document.createElement('button')
        b.className = 'vb-swatch' + (on ? ' on' : '')
        b.title = title
        b.setAttribute('aria-label', title)
        b.setAttribute('aria-pressed', String(on))
        const img = document.createElement('img')
        img.alt = ''
        if (src) img.src = src
        b.appendChild(img)
        return b
    }

    private _chip(title: string, on: boolean) {
        const b = document.createElement('button')
        b.className = 'vb-chip' + (on ? ' on' : '')
        b.textContent = title
        b.setAttribute('aria-pressed', String(on))
        return b
    }

    // a preview made by rendering waits for the next frame start (the configurator renders it with the viewer's renderer)
    private _preview(id: string, make: () => string) {
        const have = this._previews.get(id)
        if (have !== undefined) return have
        this._previews.set(id, '')
        this._toMake.push(() => {
            this._previews.set(id, make())
            this._key = '' // render again with the image
        })
        return ''
    }

    private _preFrame = () => {
        if (!this._toMake.length) return
        const jobs = this._toMake.splice(0)
        jobs.forEach(j => j())
        // the previews drew with the main renderer: one render to clear them from the canvas
        this._viewer?.setDirty()
        this.refresh()
    }

    /** Apply a material variation, one undo step (undo puts back the material as it was) */
    applyMaterial(g: Extract<Group, {kind: 'material'}>, index: number) {
        const mc = this._materials
        const viewer = this._viewer
        if (!mc || !viewer) return
        const before = g.v.selectedIndex
        if (before === index) return
        const snapshot = g.mat.clone()
        mc.applyVariation(g.v, index, true)
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({
            undo: () => {
                viewer.materialManager.applyMaterial(snapshot, g.v.uuid, g.v.regex ?? true)
                g.v.selectedIndex = before
                this.refresh()
            },
            redo: () => {
                mc.applyVariation(g.v, index, true)
                this.refresh()
            },
        })
        this.refresh()
    }

    /** Show one option of a switch node, one undo step */
    applySwitch(g: Extract<Group, {kind: 'switch'}>, id: string) {
        const sn = this._switches
        const viewer = this._viewer
        if (!sn || !viewer) return
        const before = g.node.selected
        if (before === id) return
        sn.selectNode(g.node, id)
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({
            undo: () => {
                if (before) sn.selectNode(g.node, before)
                this.refresh()
            },
            redo: () => {
                sn.selectNode(g.node, id)
                this.refresh()
            },
        })
        this.refresh()
    }

    // follow the selection on screen: above its box, or below it when the toolbar is in the way
    private _tick = () => {
        this._raf = requestAnimationFrame(this._tick)
        const ux = this._ux
        if (!ux || this._el.classList.contains('vb-hidden') || !ux.selected.length) return
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of ux.boxInfo(ux.selected).corners) {
            const s = ux.toScreen(c)
            if (s.behind) continue
            minX = Math.min(minX, s.x)
            maxX = Math.max(maxX, s.x)
            minY = Math.min(minY, s.y)
            maxY = Math.max(maxY, s.y)
        }
        if (!isFinite(minX)) return
        const c = this._viewer!.container
        const w = this._el.offsetWidth, h = this._el.offsetHeight
        const gap = 28 // above the selection's name tag
        let top = minY - gap - h
        if (top < 64) top = Math.min(maxY + gap, c.clientHeight - h - 8) // the toolbar is at the top
        const left = Math.max(8, Math.min(c.clientWidth - w - 8, (minX + maxX) / 2 - w / 2))
        this._el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`
    }
}

let added = false
function injectStyles() {
    injectMotionStyles()
    if (added) return
    added = true
    const st = document.createElement('style')
    st.textContent = `
.vb-root {
  position: absolute; left: 0; top: 0; z-index: 11; display: flex; align-items: stretch; gap: 10px; padding: 6px 10px;
  max-width: calc(100% - 16px); overflow-x: auto; transition: opacity .12s; will-change: transform;
}
.vb-root.vb-hidden { opacity: 0; pointer-events: none; }
.vb-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.vb-label { color: var(--mo-dim); font-size: 10px; white-space: nowrap; }
.vb-items { display: flex; gap: 4px; }
.vb-sep { width: 1px; background: var(--mo-line); align-self: stretch; }
.vb-swatch {
  width: 28px; height: 28px; padding: 2px; border-radius: 50%; border: 0; background: transparent; cursor: pointer; flex: none;
  box-shadow: inset 0 0 0 1px var(--mo-line);
}
.vb-swatch img { width: 100%; height: 100%; border-radius: 50%; display: block; object-fit: cover; background: var(--mo-field); }
.vb-swatch:hover { box-shadow: inset 0 0 0 1px var(--mo-dim); }
.vb-swatch.on { box-shadow: inset 0 0 0 2px var(--mo-accent); }
.vb-chip {
  height: 28px; padding: 0 10px; border-radius: 6px; border: 0; background: var(--mo-field); color: inherit; font: inherit; cursor: pointer; white-space: nowrap;
}
.vb-chip:hover { background: var(--mo-hover); }
.vb-chip.on { background: var(--mo-soft); color: var(--mo-accent); box-shadow: inset 0 0 0 1px var(--mo-accent); }
.vb-swatch:focus-visible, .vb-chip:focus-visible { outline: 2px solid var(--mo-accent); outline-offset: 1px; }
`
    document.head.appendChild(st)
}
