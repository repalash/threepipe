import {
    _testFinish,
    _testStart,
    getUrlQueryParam,
    IGeometry,
    IMaterial,
    IObject3D,
    LoadingScreenPlugin,
    MaterialPreviewHandle,
    MaterialPreviewPlugin,
    MaterialPreviewShape,
    PickingPlugin,
    ThreeViewer,
    UiObjectConfig,
    Vector3,
    ViewerUiConfigPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorFrame, LayersPanelPlugin, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

// PROTOTYPE, not for merging: where the inspector (the settings of the picked object, its material and its geometry)
// goes in the editor. ?inspector=right (default): a section above the mode settings in the right panel. ?inspector=left:
// stacked under the Layers panel in the left area. ?inspector=swap: the right panel shows the inspector while something
// is selected, and the mode settings when nothing is. The buttons at the top of the inspector switch.

type Variant = 'right' | 'left' | 'swap'
const variant = (['right', 'left', 'swap'].includes(getUrlQueryParam('inspector') ?? '') ? getUrlQueryParam('inspector') : 'right') as Variant

async function init() {
    TweakpaneEditorPlugin.LayoutStorageKey = 'tpInspectorPrototypeLayout'
    EditorFrame.AreaStorageKey = 'tpInspectorPrototypeAreas'

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        dropzone: {addOptions: {disposeSceneObjects: true, autoCenter: true, autoScale: true}},
        plugins: [LoadingScreenPlugin, PickingPlugin, MaterialPreviewPlugin],
    })
    viewer.addPluginSync(ViewerUiConfigPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin],
        ['Interaction']: [PickingPlugin, MaterialPreviewPlugin],
    })
    const layers = viewer.addPluginSync(LayersPanelPlugin)

    const inspector = new Inspector(viewer, ui.colorMode)
    if (variant === 'left') {
        editor.setArea('left', [layers.element, inspector.element], LayersPanelPlugin.AreaEntry)
    } else {
        editor.setArea('left', layers.element, LayersPanelPlugin.AreaEntry)
        // the right panel: the inspector goes in the container of the Tweakpane UI, above the mode settings
        const panel = document.getElementById('tweakpaneUiContainer')!
        panel.prepend(inspector.element)
        document.body.classList.add('insp-' + variant)
    }

    const picking = viewer.getPlugin(PickingPlugin)!
    picking.addEventListener('selectedObjectChanged', () => inspector.show(picking.getSelectedObject() as any))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})
}

type Tab = 'object' | 'material' | 'geometry'

/**
 * The inspector: a header with the name and the tabs of the selection (Object, Material, Geometry), the uiConfig of the
 * open tab rendered by its own Tweakpane renderer, and for a material a large preview that a drag turns.
 */
class Inspector {
    readonly element = document.createElement('div')
    private _title = document.createElement('div')
    private _tabs = document.createElement('div')
    private _preview = document.createElement('div')
    private _canvas = document.createElement('canvas')
    private _body = document.createElement('div')
    private _empty = document.createElement('div')
    private _ui: TweakpaneUiPlugin
    private _shown?: UiObjectConfig
    private _object?: IObject3D
    private _material?: IMaterial
    private _geometry?: IGeometry
    private _tab: Tab = 'object'
    private _shape: MaterialPreviewShape = 'sphere'
    private _view = {yaw: 0.5, pitch: 0.25, distance: 1}
    private _handle?: MaterialPreviewHandle
    private _previews: MaterialPreviewPlugin

    constructor(viewer: ThreeViewer, colorMode: TweakpaneUiPlugin['colorMode']) {
        this._previews = viewer.getPlugin(MaterialPreviewPlugin)!
        this.element.className = 'insp'
        const switcher = document.createElement('div')
        switcher.className = 'insp-variants'
        for (const v of ['right', 'left', 'swap'] as Variant[]) {
            const b = document.createElement('button')
            b.textContent = {right: 'Right section', left: 'Left section', swap: 'Swap'}[v]
            b.classList.toggle('on', v === variant)
            b.onclick = () => {
                const u = new URL(location.href)
                u.searchParams.set('inspector', v)
                location.href = u.toString()
            }
            switcher.append(b)
        }
        this._title.className = 'insp-title'
        this._tabs.className = 'insp-tabs'
        this._preview.className = 'insp-preview'
        this._canvas.width = this._canvas.height = 256
        const shapes = document.createElement('div')
        shapes.className = 'insp-shapes'
        for (const s of ['sphere', 'cube', 'mesh'] as MaterialPreviewShape[]) {
            const b = document.createElement('button')
            b.textContent = {sphere: 'Sphere', cube: 'Cube', mesh: 'This mesh'}[s as string]!
            b.classList.toggle('on', s === this._shape)
            b.onclick = () => {
                this._shape = s
                shapes.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
                this._requestPreview()
            }
            shapes.append(b)
        }
        this._preview.append(this._canvas, shapes)
        this._setupPreviewDrag()
        this._empty.className = 'insp-empty'
        this._empty.textContent = 'Select an object in the viewport or in Layers'
        this._body.className = 'insp-body'
        this.element.append(switcher, this._title, this._tabs, this._preview, this._body, this._empty)

        // a second Tweakpane renderer, for the inspector only (the main one shows the modes)
        this._ui = new TweakpaneUiPlugin(true, false, this._body, colorMode)
        this._ui.onAdded(viewer)
        this.show(undefined)
    }

    show(selected: IObject3D | IMaterial | IGeometry | undefined) {
        const object = (selected as IObject3D)?.isObject3D ? selected as IObject3D : undefined
        const m = object ? object.material : (selected as IMaterial)?.isMaterial ? selected as IMaterial : undefined
        this._object = object
        this._material = (Array.isArray(m) ? m[0] : m) as IMaterial | undefined
        this._geometry = object ? object.geometry as IGeometry : (selected as IGeometry)?.isBufferGeometry ? selected as IGeometry : undefined
        const tabs = ([['object', this._object], ['material', this._material], ['geometry', this._geometry]] as const).filter(t => t[1])
        document.body.classList.toggle('insp-has-sel', tabs.length > 0)
        this._empty.style.display = tabs.length ? 'none' : ''
        this._title.textContent = selected ? (selected as any).name || (selected as any).type : ''
        this._tabs.innerHTML = ''
        for (const [tab] of tabs) {
            const b = document.createElement('button')
            b.textContent = tab[0].toUpperCase() + tab.slice(1)
            b.onclick = () => this._open(tab)
            b.dataset.tab = tab
            this._tabs.append(b)
        }
        // keep the open tab when the new selection has it (a pick of another mesh keeps the Material tab)
        this._open(tabs.find(t => t[0] === this._tab)?.[0] ?? tabs[0]?.[0])
    }

    private _open(tab: Tab | undefined) {
        if (this._shown) this._ui.removeChild(this._shown)
        this._shown = undefined
        if (tab) this._tab = tab
        this._tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab))
        const target = tab === 'object' ? this._object : tab === 'material' ? this._material : tab === 'geometry' ? this._geometry : undefined
        const config = target?.uiConfig
        if (config) {
            if (config.type === 'folder') config.expanded = true
            this._ui.appendChild(config)
            this._shown = config
        }
        this._preview.style.display = tab === 'material' ? '' : 'none'
        this._requestPreview()
    }

    // the large preview of the material: it follows each change, a drag turns it, the wheel zooms
    private _material2?: IMaterial
    private _requestPreview = () => {
        this._handle?.cancel()
        if (this._material2 !== this._material) {
            this._material2?.removeEventListener('materialUpdate', this._requestPreview)
            this._material2 = this._material
            this._material?.addEventListener('materialUpdate', this._requestPreview)
        }
        const material = this._material
        if (!material || this._tab !== 'material') return
        const {yaw, pitch, distance} = this._view
        this._handle = this._previews.request(material, {
            shape: this._shape,
            geometry: this._shape === 'mesh' ? this._geometry : undefined,
            size: 256,
            cameraDirection: new Vector3().setFromSphericalCoords(1, Math.PI / 2 - pitch, yaw),
            cameraDistance: distance,
            dragInterval: 0,
        }, p => {
            const ctx = this._canvas.getContext('2d')!
            ctx.clearRect(0, 0, 256, 256)
            ctx.drawImage(p.canvas, 0, 0, 256, 256)
        })
    }

    private _setupPreviewDrag() {
        const c = this._canvas
        let drag: {x: number, y: number} | undefined
        c.addEventListener('pointerdown', e => {
            drag = {x: e.clientX, y: e.clientY}
            c.setPointerCapture(e.pointerId)
        })
        c.addEventListener('pointermove', e => {
            if (!drag) return
            this._view.yaw -= (e.clientX - drag.x) * 0.01
            this._view.pitch = Math.max(-1.4, Math.min(1.4, this._view.pitch + (e.clientY - drag.y) * 0.01))
            drag = {x: e.clientX, y: e.clientY}
            this._requestPreview()
        })
        c.addEventListener('pointerup', () => drag = undefined)
        c.addEventListener('pointercancel', () => drag = undefined)
        c.addEventListener('wheel', e => {
            e.preventDefault()
            this._view.distance = Math.max(0.4, Math.min(2.5, this._view.distance * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
            this._requestPreview()
        }, {passive: false})
    }
}

_testStart()
init().finally(_testFinish)
