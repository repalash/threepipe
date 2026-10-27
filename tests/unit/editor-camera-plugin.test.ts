import {describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Object3D, PerspectiveCamera, Vector3} from 'three'
import {EditorCameraPlugin} from '../../plugins/tweakpane-editor/src/EditorCameraPlugin'

// the editor camera makes its orbit controls on document.body, which the node setup does not have
const doc = globalThis.document as any
const listeners = {addEventListener: () => {}, removeEventListener: () => {}}
if (!doc.body?.addEventListener) doc.body = {style: {}, ...listeners, getRootNode: () => listeners}

// a start view (the scene's default camera) and a scene that tracks the main camera
function setup({undo = true} = {}) {
    const scene = new EventDispatcher<any>() as any
    const start = new PerspectiveCamera() as any
    start.target = new Vector3(0, 0, 0)
    start.position.set(0, 1, 6)
    start.setDirty = vi.fn()
    start.controls = {stopDamping: vi.fn()}
    const activate = (cam: any) => () => {
        scene.mainCamera = cam
        scene.dispatchEvent({type: 'mainCameraChange'})
    }
    start.activateMain = activate(start)
    scene.defaultCamera = start
    scene.mainCamera = start
    scene.add = (o: Object3D) => scene.children.push(o)
    scene.children = [] as Object3D[]

    const records: {undo: () => void, redo: () => void}[] = []
    const undoPlugin = {undoManager: {record: (r: any) => records.push(r)}}
    const viewer = Object.assign(new EventDispatcher<any>(), {
        scene,
        assetManager: new EventDispatcher<any>(),
        getPlugin: (p: any) => undo && p?.PluginType === 'UndoManagerPlugin' ? undoPlugin : undefined,
    }) as any

    const plugin = new EditorCameraPlugin()
    plugin.camera.activateMain = activate(plugin.camera) as any
    plugin.onAdded(viewer)
    return {plugin, scene, start, records, viewer}
}

describe('EditorCameraPlugin', () => {
    test('is not saved with the viewer config', () => {
        expect(new EditorCameraPlugin().serializeWithViewer).toBe(false)
    })

    test('on add, the editor camera takes the start view and becomes the main camera', () => {
        const {plugin, scene, start} = setup()
        expect(scene.children).toContain(plugin.camera)
        expect(scene.mainCamera).toBe(plugin.camera)
        expect(plugin.homeCamera).toBe(plugin.camera)
        expect(plugin.camera.position.toArray()).toEqual(start.position.toArray())
        expect(plugin.camera.target.toArray()).toEqual(start.target.toArray())
    })

    test('View looks through the start view; Edit puts the start view back', () => {
        const {plugin, scene, start, records} = setup()
        plugin.editing = false
        expect(scene.mainCamera).toBe(start)
        expect(plugin.homeCamera).toBe(start)

        start.position.set(4, 1, 0) // a look around in View
        plugin.editing = true
        expect(scene.mainCamera).toBe(plugin.camera)
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(records).toHaveLength(0)
    })

    test('keepViewMoves: the moves in View stay, as one undo step', () => {
        const {plugin, start, records} = setup()
        plugin.keepViewMoves = true
        plugin.editing = false
        start.position.set(4, 1, 0)
        plugin.editing = true
        expect(start.position.toArray()).toEqual([4, 1, 0])
        expect(records).toHaveLength(1)
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(start.position.toArray()).toEqual([4, 1, 0])
    })

    test('resetStartView puts the start view back while in View', () => {
        const {plugin, start} = setup()
        plugin.editing = false
        start.position.set(4, 1, 0)
        plugin.resetStartView()
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('setStartViewFromEditor moves the start view to the editor view, as one undo step', () => {
        const {plugin, start, records} = setup()
        plugin.camera.position.set(2, 3, 4)
        plugin.camera.target.set(0, 1, 0)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([2, 3, 4])
        expect(start.target.toArray()).toEqual([0, 1, 0])
        expect(records).toHaveLength(1)
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(start.target.toArray()).toEqual([0, 0, 0])
    })

    test('in View, undo of setStartViewFromEditor is kept when Edit starts again', () => {
        const {plugin, start, records} = setup()
        plugin.editing = false
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        records[0].undo()
        plugin.editing = true
        expect(start.position.toArray()).toEqual([0, 1, 6])
        plugin.editing = false
        records[0].redo()
        plugin.resetStartView()
        expect(start.position.toArray()).toEqual([2, 3, 4])
    })

    test('in View, a file with a viewer config sets the start view to put back', () => {
        const {plugin, viewer, start} = setup()
        plugin.editing = false
        start.position.set(1, 2, 3) // the imported start view
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: true}})
        start.position.set(4, 1, 0) // a look around
        plugin.editing = true
        expect(start.position.toArray()).toEqual([1, 2, 3])
    })

    test('a viewer config file sets the editor camera to its start view', () => {
        const {plugin, viewer, start} = setup()
        start.position.set(1, 2, 3)
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {assetType: 'config'}})
        expect(plugin.camera.position.toArray()).toEqual([1, 2, 3])
    })

    test('added in View: Edit puts back the start view of the add', () => {
        const {plugin, scene, start, viewer} = setup()
        plugin.onRemove(viewer)
        plugin.editing = false
        plugin.onAdded(viewer)
        expect(scene.mainCamera).toBe(start)
        start.position.set(4, 1, 0) // a look around
        plugin.resetStartView()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        start.position.set(4, 1, 0)
        plugin.editing = true
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('setStartViewFromEditor turns a start camera without controls to the new target', () => {
        const {plugin, start, records} = setup()
        start.controls = undefined
        plugin.camera.position.set(5, 0, 0)
        plugin.camera.target.set(0, 0, 0)
        plugin.setStartViewFromEditor()
        const forward = new Vector3(0, 0, -1).applyQuaternion(start.quaternion)
        expect(forward.x).toBeCloseTo(-1) // looks from +x to the origin
        records[0].undo()
        const back = new Vector3(0, 0, -1).applyQuaternion(start.quaternion)
        expect(back.z).toBeLessThan(-0.9) // looks from (0, 1, 6) to the origin again
    })

    test('copyStartView copies the zoom', () => {
        const {plugin, start} = setup()
        start.zoom = 1.5
        plugin.copyStartView()
        expect(plugin.camera.zoom).toBe(1.5)
    })

    test('setStartViewFromEditor works without the UndoManagerPlugin', () => {
        const {plugin, start} = setup({undo: false})
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([2, 3, 4])
    })

    test('disabled: the view goes to the start view and Edit stays off', () => {
        const {plugin, scene, start} = setup()
        plugin.enabled = false
        expect(scene.mainCamera).toBe(start)
        plugin.editing = true
        expect(plugin.editing).toBe(false)
        expect(scene.mainCamera).toBe(start)
        plugin.enabled = true
        expect(scene.mainCamera).toBe(plugin.camera)
    })

    test('the editor camera gets ControlProps when it becomes the main camera; smooth adds damping', () => {
        const {plugin, scene, start} = setup()
        plugin.editing = false
        const controls = plugin.camera.controls as any
        controls.enableDamping = true
        controls.maxPolarAngle = 1
        plugin.editing = true
        expect(controls.enableDamping).toBe(false)
        expect(controls.maxPolarAngle).toBe(Math.PI)
        plugin.smooth = true
        expect(controls.enableDamping).toBe(true)
        // the start view keeps its own controls
        expect(start.controls.enableDamping).toBeUndefined()
        expect(scene.mainCamera).toBe(plugin.camera)
    })

    test('a file with a viewer config sets the editor camera to its start view', () => {
        const {plugin, viewer, start} = setup()
        start.position.set(1, 2, 3)
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {}})
        expect(plugin.camera.position.toArray()).toEqual([0, 1, 6])
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: true}})
        expect(plugin.camera.position.toArray()).toEqual([1, 2, 3])
    })

    test('on remove, the start view is the main camera and the editor camera leaves the scene', () => {
        const {plugin, scene, start, viewer} = setup()
        scene.children = []
        start.add(plugin.camera) // any parent: removeFromParent takes it out
        plugin.onRemove(viewer)
        expect(scene.mainCamera).toBe(start)
        expect(plugin.camera.parent).toBeNull()
        expect(plugin.editing).toBe(true) // kept for the next add
    })
})
