import {describe, expect, test, vi} from 'vitest'
import {BoxGeometry, EventDispatcher, Group, Matrix3, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, ShaderMaterial, Texture, Vector3} from 'three'
import {PickingPlugin} from 'threepipe'
import {SelectionMaskPass, SelectionOutlinePlugin} from '../../plugins/tweakpane-editor/src/SelectionOutlinePlugin'

const mesh = (name: string) => Object.assign(new Mesh(new BoxGeometry()), {name})

// a watch: root > one wrapper group > [case (2 meshes), hands (1 mesh)]
function watch() {
    const root = new Group()
    const wrapper = new Group()
    const caseGroup = new Group()
    caseGroup.add(mesh('case-a'), mesh('case-b'))
    const hands = mesh('hands')
    wrapper.add(caseGroup, hands)
    root.add(wrapper)
    return {root, wrapper, caseGroup, hands}
}

// a plugin with a fake viewer: render manager, and a PickingPlugin when given
function setup(picking?: any) {
    const plugin = new SelectionOutlinePlugin()
    const viewer = {
        renderManager: {setDirty: vi.fn(), screenPass: {setDirty: vi.fn()}},
        getPlugin: (p: any) => p === PickingPlugin ? picking : undefined,
    }
    ;(plugin as any)._viewer = viewer
    return {plugin, viewer}
}

const byName = (items: Map<Object3D, any>) =>
    Object.fromEntries([...items].map(([o, v]) => [o.name, v.toArray()]))

describe('SelectionOutlinePlugin', () => {
    test('is not saved with the viewer config', () => {
        expect(new SelectionOutlinePlugin().serializeWithViewer).toBe(false)
    })

    test('mask items: item per selected object, part per child below the single-child chain', () => {
        const {plugin} = setup()
        const a = watch()
        const b = mesh('other')
        plugin.selected = [a.root as any, b as any]
        expect(byName(plugin.maskItems())).toEqual({
            'case-a': [1, 1, 0], 'case-b': [1, 1, 0], 'hands': [1, 2, 0],
            'other': [2, 0, 0],
        })
    })

    test('mask items: the hover is a flag; hovering a selected object adds nothing', () => {
        const {plugin} = setup()
        const a = watch()
        const other = mesh('other')
        plugin.selected = [a.root as any]
        plugin.hovered = [other as any, a.root as any]
        const items = byName(plugin.maskItems())
        expect(items.other).toEqual([0, 0, 1])
        expect(items.hands).toEqual([1, 2, 0])
    })

    test('mask items: a hovered part of the selection is flagged', () => {
        const {plugin} = setup()
        const a = watch()
        plugin.selected = [a.root as any]
        plugin.hovered = [a.hands as any]
        expect(byName(plugin.maskItems()).hands).toEqual([1, 2, 1])
    })

    test('mask items: hidden meshes, the options and the enabled state', () => {
        const {plugin} = setup()
        const a = watch()
        a.hands.visible = false
        plugin.selected = [a.root as any]
        plugin.hovered = [mesh('other') as any]
        expect(Object.keys(byName(plugin.maskItems())).sort()).toEqual(['case-a', 'case-b', 'other'])

        plugin.outlineSelected = false
        expect(Object.keys(byName(plugin.maskItems()))).toEqual(['other'])
        plugin.outlineHover = false
        expect(plugin.maskItems().size).toBe(0)
        plugin.outlineSelected = true
        plugin.enabled = false
        expect(plugin.maskItems().size).toBe(0)
    })

    test('partsOf can be replaced', () => {
        const {plugin} = setup()
        const a = watch()
        plugin.partsOf = (o) => o.children[0].children[0].children // the two case meshes
        plugin.selected = [a.root as any]
        expect(byName(plugin.maskItems())).toEqual({'case-a': [1, 1, 0], 'case-b': [1, 2, 0], 'hands': [1, 0, 0]})
    })

    test('a change of the selection or the hover renders one frame; the same objects do not', () => {
        const {plugin, viewer} = setup()
        const a = mesh('a') as any
        plugin.selected = [a]
        expect(viewer.renderManager.setDirty).toHaveBeenCalledTimes(1)
        plugin.selected = [a]
        expect(viewer.renderManager.setDirty).toHaveBeenCalledTimes(1)
        plugin.hovered = [a]
        expect(viewer.renderManager.setDirty).toHaveBeenCalledTimes(2)
        plugin.width = 3
        expect(viewer.renderManager.setDirty).toHaveBeenCalledTimes(3)
    })

    test('followPicking: a PickingPlugin added later or replaced is followed', () => {
        const makePicking = (sel: any[]) => Object.assign(new EventDispatcher<any>(), {getSelectedObjects: () => sel})
        const listeners: Record<string, (() => void)[]> = {add: [], remove: []}
        let picking: any
        const plugin = new SelectionOutlinePlugin()
        const viewer = Object.assign(new EventDispatcher<any>(), {
            renderManager: {setDirty: vi.fn(), screenPass: {setDirty: vi.fn()}},
            getPlugin: (p: any) => p === PickingPlugin ? picking : undefined,
            addPluginListener: (t: string, l: () => void) => listeners[t].push(l),
            removePluginListener: vi.fn(),
        })
        ;(plugin as any)._viewer = viewer
        // only the listener part of onAdded: the render targets need a renderer
        viewer.addPluginListener('add', (plugin as any)._onPickingAdded)
        viewer.addPluginListener('remove', (plugin as any)._onPickingRemoved)

        const a = mesh('a') as any
        const b = mesh('b') as any
        picking = makePicking([a]) // added after the outline plugin
        listeners.add.forEach(l => l())
        expect(plugin.selected).toEqual([a])

        const old = picking
        listeners.remove.forEach(l => l()) // replaced: the old one is removed first
        picking = makePicking([b])
        listeners.add.forEach(l => l())
        expect(plugin.selected).toEqual([b])
        old.dispatchEvent({type: 'hoverObjectChanged', object: a})
        expect(plugin.hovered).toEqual([]) // the old one is not followed
    })

    test('followPicking: the selection and the hover come from the PickingPlugin', () => {
        const picking = Object.assign(new EventDispatcher<any>(), {selected: [] as any[], getSelectedObjects() {
            return this.selected
        }})
        const {plugin} = setup(picking)
        ;(plugin as any)._refreshPicking()
        const a = mesh('a') as any
        const b = mesh('b') as any
        picking.selected = [a]
        picking.dispatchEvent({type: 'selectedObjectChanged'})
        expect(plugin.selected).toEqual([a])
        picking.dispatchEvent({type: 'hoverObjectChanged', object: b})
        expect(plugin.hovered).toEqual([b])
        picking.dispatchEvent({type: 'hoverObjectChanged', object: null})
        expect(plugin.hovered).toEqual([])

        // off: the plugin stops following, and keeps what was set
        plugin.followPicking = false
        picking.selected = [b]
        picking.dispatchEvent({type: 'selectedObjectChanged'})
        expect(plugin.selected).toEqual([a])
        plugin.selected = [b]
        expect(plugin.selected).toEqual([b])

        // on again: it takes the current selection
        picking.selected = [a]
        plugin.followPicking = true
        expect(plugin.selected).toEqual([a])
    })

    test('the mask pass gives each object its own layer mask back', () => {
        const pass = new SelectionMaskPass(() => ({}) as any, new ShaderMaterial({uniforms: {itemData: {value: new Vector3()}}}))
        const onLayer = mesh('on-layer')
        onLayer.layers.enable(SelectionMaskPass.Layer)
        const other = mesh('other')
        pass.getItems = () => new Map([[onLayer, new Vector3(1, 0, 0)], [other, new Vector3(2, 0, 0)]])
        pass.scene = new Group() as any
        const camera = new PerspectiveCamera() as any
        pass.camera = camera
        let inPass: number[] = []
        const renderer: any = {
            getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: () => {},
            renderWithModes: () => {
                inPass = [onLayer.layers.mask, other.layers.mask]
            },
        }
        const masks = [onLayer.layers.mask, other.layers.mask]
        pass.render(renderer)
        expect(inPass.every(m => (m & 1 << SelectionMaskPass.Layer) !== 0)).toBe(true)
        expect([onLayer.layers.mask, other.layers.mask]).toEqual(masks)
        expect(camera.layers.mask).toBe(1)
    })

    test('the mask material: objects outside the mask write nothing; a material array uses the group material', () => {
        const u = (v: any) => ({value: v})
        const material = new ShaderMaterial({uniforms: {
            itemData: u(new Vector3()), maskSkip: u(0), maskOpacity: u(1),
            maskMap: u(null), maskUseMap: u(0), maskMapUvTransform: u(new Matrix3()),
            maskAlphaMap: u(null), maskUseAlphaMap: u(0), maskAlphaMapUvTransform: u(new Matrix3()), maskAlphaCut: u(0.5),
        }})
        const pass = new SelectionMaskPass(() => ({}) as any, material) as any
        const cutout = new MeshBasicMaterial({alphaTest: 0.3, map: new Texture(), alphaMap: new Texture()})
        const item = new Mesh(new BoxGeometry(), [new MeshBasicMaterial(), cutout])
        const other = mesh('other')
        pass._items = new Map([[item, new Vector3(1, 2, 0)]])
        const before = material.onBeforeRender as any

        before(null, null, null, null, other, null)
        expect(material.uniforms.maskSkip.value).toBe(1)

        before(null, null, null, null, item, {materialIndex: 1})
        expect(material.uniforms.maskSkip.value).toBe(0)
        expect(material.uniforms.itemData.value.toArray()).toEqual([1, 2, 0])
        // both textures: the alpha of map and the green of alphaMap are multiplied
        expect(material.uniforms.maskMap.value).toBe(cutout.map)
        expect(material.uniforms.maskUseMap.value).toBe(1)
        expect(material.uniforms.maskAlphaMap.value).toBe(cutout.alphaMap)
        expect(material.uniforms.maskUseAlphaMap.value).toBe(1)
        expect(material.uniforms.maskAlphaCut.value).toBeCloseTo(0.3)

        before(null, null, null, null, item, {materialIndex: 0})
        expect(material.uniforms.maskUseMap.value).toBe(0)
        expect(material.uniforms.maskUseAlphaMap.value).toBe(0)
    })
})
