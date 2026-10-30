import {describe, expect, test, vi} from 'vitest'
import {BoxGeometry, EventDispatcher, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, ShaderMaterial, Texture, Vector3} from 'three'
import {lineMaskFragment, SelectionMaskPass, selectionMaskMaterial, SelectionOutlinePlugin} from '../../plugins/tweakpane-editor/src/SelectionOutlinePlugin'

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

// a plugin with a fake viewer: render manager, and a PickingPlugin when given (looked up by its type name)
function setup(picking?: any) {
    const plugin = new SelectionOutlinePlugin()
    const viewer = {
        renderManager: {setDirty: vi.fn(), screenPass: {setDirty: vi.fn()}},
        getPlugin: (p: any) => p === 'PickingPlugin' ? picking : undefined,
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
            getPlugin: (p: any) => p === 'PickingPlugin' ? picking : undefined,
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
        let modes: any = {}
        const renderer: any = {
            getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: () => {},
            renderWithModes: (m: any) => {
                modes = m
                inPass = [onLayer.layers.mask, other.layers.mask]
            },
        }
        const masks = [onLayer.layers.mask, other.layers.mask]
        pass.render(renderer)
        expect(inPass.every(m => (m & 1 << SelectionMaskPass.Layer) !== 0)).toBe(true)
        expect([onLayer.layers.mask, other.layers.mask]).toEqual(masks)
        expect(camera.layers.mask).toBe(1)
        // glass is in the transmissive list: it is drawn too
        expect(modes.transmissionRender).toBe(true)
    })

    test('the mask pass keeps its mask on the progressive frames: it draws again after a change, a reset, another camera or a resize', () => {
        const target = {width: 4, height: 4}
        const pass = new SelectionMaskPass(() => target as any, selectionMaskMaterial())
        pass.getItems = () => new Map([[mesh('a'), new Vector3(1, 0, 0)]])
        const camera = Object.assign(new PerspectiveCamera(), {updateShaderProperties: () => {}}) as any
        const other = Object.assign(new PerspectiveCamera(), {updateShaderProperties: () => {}}) as any
        const renderManager = {frameCount: 0} as any
        let draws = 0
        const renderer: any = {
            getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: () => {},
            renderWithModes: () => draws++,
        }
        const frame = (cam = camera) => {
            pass.beforeRender(new Group() as any, cam, renderManager)
            pass.render(renderer)
            return draws
        }
        expect(frame()).toBe(1) // the first frame after a reset
        renderManager.frameCount = 5
        expect(frame()).toBe(1) // a progressive frame: nothing changed, the mask is kept
        pass.needsUpdate = true // a change of the selection, the hover or a setting
        expect(frame()).toBe(2)
        expect(frame()).toBe(2)
        expect(frame(other)).toBe(3) // another camera (VirtualCamerasPlugin) renders its own mask
        expect(frame()).toBe(4) // and the main camera draws its mask again
        target.width = 8 // a resize clears the target
        expect(frame()).toBe(5)
        renderManager.frameCount = 0 // the scene or the camera changed
        expect(frame()).toBe(6)
    })

    test('the plugin asks the mask pass for a new mask after a change, and when the pass turns on again', () => {
        const {plugin, viewer} = setup() as any
        Object.assign(viewer, {scene: {mainCamera: {near: 0.1, far: 100}}})
        Object.assign(viewer.renderManager, {renderScale: 1, screenPass: {material: {}}})
        const pass = {enabled: false, needsUpdate: false}
        plugin._pass = pass
        plugin._target = {texture: new Texture(), width: 4, height: 4}
        plugin._preRender() // nothing selected: the pass is off
        expect(pass.enabled).toBe(false)
        plugin.selected = [mesh('a')]
        expect(pass.needsUpdate).toBe(true)
        pass.needsUpdate = false
        plugin._preRender() // on again: the frames that it skipped can have changed the scene
        expect([pass.enabled, pass.needsUpdate]).toEqual([true, true])
        pass.needsUpdate = false
        plugin._preRender()
        expect(pass.needsUpdate).toBe(false)
        plugin.partsOf = (o: Object3D) => o.children
        expect(pass.needsUpdate).toBe(true)
    })

    test('the mask material is cut by the clipping planes of the renderer, as the render', () => {
        const material = selectionMaskMaterial()
        expect(material.clipping).toBe(true) // the renderer passes the clipping planes uniform
        expect(material.vertexShader).toContain('#include <clipping_planes_vertex>')
        expect(material.fragmentShader).toContain('#include <clipping_planes_pars_fragment>')
        expect(material.fragmentShader).toContain('#include <clipping_planes_fragment>')
    })

    test('the line mask keeps the line shader up to its coverage (dash gaps, caps), then writes the mask', () => {
        const line = 'uniform float dashSize;\nvoid main() {\n    if (dash) discard; // the gaps\n    #include <logdepthbuf_fragment>\n    gl_FragColor = vec4(diffuse, 1.);\n}\n'
        const frag = lineMaskFragment(line)
        expect(frag).toContain('uniform float dashSize;')
        expect(frag).toContain('if (dash) discard;')
        expect(frag).toContain('gl_FragColor = vec4(itemData, maskDepth);')
        expect(frag).not.toContain('gl_FragColor = vec4(diffuse') // the line's colour output is cut
        expect(frag.indexOf('discard')).toBeLessThan(frag.indexOf('vec4(itemData'))
        expect(lineMaskFragment('void main() {}')).toContain('gl_FragColor = vec4(itemData, maskDepth);') // no coverage point
    })

    test('the line mask follows the defines of the line (a line made dashed after its first mask)', () => {
        const pass = new SelectionMaskPass(() => ({}) as any, selectionMaskMaterial()) as any
        const line = new ShaderMaterial({defines: {}, fragmentShader: 'void main() {\n#include <logdepthbuf_fragment>\n}'})
        const mask = pass._lineMask(line)
        expect(mask.defines).toEqual({})
        line.defines.USE_DASH = ''
        expect(pass._lineMask(line)).toBe(mask)
        expect(mask.defines).toEqual({USE_DASH: ''})
    })

    test('the line masks are disposed with their line material, and all with the pass', () => {
        const pass = new SelectionMaskPass(() => ({}) as any, selectionMaskMaterial()) as any
        const fragmentShader = 'void main() {\n#include <logdepthbuf_fragment>\n}'
        const line1 = new ShaderMaterial({fragmentShader}), line2 = new ShaderMaterial({fragmentShader})
        const mask1 = pass._lineMask(line1), mask2 = pass._lineMask(line2)
        const disposed1 = vi.fn(), disposed2 = vi.fn()
        mask1.addEventListener('dispose', disposed1)
        mask2.addEventListener('dispose', disposed2)
        line1.dispose()
        expect(disposed1).toHaveBeenCalledOnce()
        expect(pass._lineMask(line1)).not.toBe(mask1) // a new mask for a line material used again
        pass.dispose()
        expect(disposed2).toHaveBeenCalledOnce()
        expect(pass._lineMasks.size).toBe(0)
    })

    test('the mask material has the batching transforms, so a selected BatchedMesh compiles and is drawn', () => {
        const vert = selectionMaskMaterial().vertexShader
        expect(vert).toContain('#include <batching_pars_vertex>')
        expect(vert).toContain('#include <batching_vertex>')
        // batchingMatrix is declared before project_vertex uses it
        expect(vert.indexOf('#include <batching_vertex>')).toBeLessThan(vert.indexOf('#include <project_vertex>'))
    })

    test('the mask material follows the displacement map of the material, as the render', () => {
        const material = selectionMaskMaterial()
        const pass = new SelectionMaskPass(() => ({}) as any, material) as any
        const displaced = new MeshBasicMaterial() as any
        Object.assign(displaced, {displacementMap: new Texture(), displacementScale: 2, displacementBias: 0.5})
        displaced.displacementMap.channel = 1
        const item = new Mesh(new BoxGeometry(), displaced)
        pass._items = new Map([[item, new Vector3(1, 0, 0)]])
        ;(material.onBeforeRender as any)(null, null, null, null, item, null)
        const u = material.uniforms
        expect([u.maskUseDisplacementMap.value, u.maskDisplacementMap.value, u.maskDisplacementMapChannel.value]).toEqual([1, displaced.displacementMap, 1])
        expect([u.maskDisplacementScale.value, u.maskDisplacementBias.value]).toEqual([2, 0.5])
        expect(material.vertexShader).toContain('normalize(objectNormal)')
    })

    test('the mask material: objects outside the mask write nothing; a material array uses the group material', () => {
        const material = selectionMaskMaterial()
        const pass = new SelectionMaskPass(() => ({}) as any, material) as any
        const cutout = new MeshBasicMaterial({alphaTest: 0.3, map: new Texture(), alphaMap: new Texture()})
        cutout.alphaMap!.channel = 2 // the alpha map on the third UV set
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
        // each texture with its own UV set, as in the material
        expect(material.uniforms.maskMapChannel.value).toBe(0)
        expect(material.uniforms.maskAlphaMapChannel.value).toBe(2)

        before(null, null, null, null, item, {materialIndex: 0})
        expect(material.uniforms.maskUseMap.value).toBe(0)
        expect(material.uniforms.maskUseAlphaMap.value).toBe(0)
    })

    test('the mask material: an alpha-tested material is cut with its opacity, as the render (not only when transparent)', () => {
        const material = selectionMaskMaterial()
        const pass = new SelectionMaskPass(() => ({}) as any, material) as any
        const before = material.onBeforeRender as any
        const alphaTested = new Mesh(new BoxGeometry(), new MeshBasicMaterial({alphaTest: 0.5, opacity: 0.2}))
        const opaque = new Mesh(new BoxGeometry(), new MeshBasicMaterial({opacity: 0.2}))
        pass._items = new Map([[alphaTested, new Vector3(1, 0, 0)], [opaque, new Vector3(2, 0, 0)]])
        before(null, null, null, null, alphaTested, null)
        expect(material.uniforms.maskOpacity.value).toBeCloseTo(0.2) // 0.2 < alphaTest 0.5: cut, as in the render
        before(null, null, null, null, opaque, null)
        expect(material.uniforms.maskOpacity.value).toBe(1) // opaque: the render ignores the opacity
    })

    test('the x-ray test gets the near and far of the camera, for a tolerance in view space', () => {
        const {plugin, viewer} = setup() as any
        Object.assign(viewer, {scene: {mainCamera: {near: 0.1, far: 2000}}})
        Object.assign(viewer.renderManager, {renderScale: 1, screenPass: {material: {}}})
        ;(plugin as any)._target = {texture: new Texture(), width: 4, height: 4}
        ;(plugin as any)._preRender()
        expect(plugin.extraUniforms.selNearFar.value.toArray()).toEqual([0.1, 2000])
        // not a fixed bias on the depth normalized by far - near: 0.002 of 0.1..2000 is 4 world units
        const glsl = plugin.parsFragmentSnippet() as string
        expect(glsl).not.toContain('maskDepth - 0.002')
        expect(glsl).toContain('selNearFar')
    })
})
