import {beforeEach, describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Object3D, PerspectiveCamera, Vector3} from 'three'
import {EditorCameraPlugin} from '../../plugins/tweakpane-editor/src/EditorCameraPlugin'

// a viewer canvas for the orbit controls of the editor camera (the node setup has no DOM)
function makeCanvas() {
    const listeners = {addEventListener: () => {}, removeEventListener: () => {}}
    return {style: {}, tabIndex: 0, ownerDocument: globalThis.document, ...listeners, getRootNode: () => listeners} as any
}

// a viewer config with a start view, as a file brings it
const viewerConfig = {assetType: 'config', type: 'ThreeViewer', scene: {defaultCamera: {}}}

// a start view (the scene's default camera) and a scene that tracks the main camera
function setup({undo = true} = {}) {
    const scene = new EventDispatcher<any>() as any
    const start = new PerspectiveCamera() as any
    start.target = new Vector3(0, 0, 0)
    start.position.set(0, 1, 6)
    start.lookAt(start.target) // the controls of the start view do this
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
        canvas: makeCanvas(),
        assetManager: new EventDispatcher<any>(),
        getPlugin: (p: any) => undo && (p === 'UndoManagerPlugin' || p?.PluginType === 'UndoManagerPlugin') ? undoPlugin : undefined,
    }) as any

    const plugin = new EditorCameraPlugin()
    plugin.camera.activateMain = activate(plugin.camera) as any
    plugin.onAdded(viewer)
    return {plugin, scene, start, records, viewer}
}

// a key press on the window, with the fields the plugin reads
function key(code: string, fields: Record<string, any> = {}) {
    const e = Object.assign(new Event('keydown', {cancelable: true}), {code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...fields})
    window.dispatchEvent(e)
    return e
}

describe('EditorCameraPlugin', () => {
    // the window of the node setup is globalThis, without events: a new event target for each test
    beforeEach(() => {
        const win = new EventTarget()
        Object.assign(globalThis, {
            addEventListener: win.addEventListener.bind(win),
            removeEventListener: win.removeEventListener.bind(win),
            dispatchEvent: win.dispatchEvent.bind(win),
        })
    })

    test('the C key switches between Edit and View', () => {
        const {plugin, scene, start} = setup()
        const e = key('KeyC')
        expect(e.defaultPrevented).toBe(true)
        expect(plugin.editing).toBe(false)
        expect(scene.mainCamera).toBe(start)
        key('KeyC')
        expect(plugin.editing).toBe(true)
        expect(scene.mainCamera).toBe(plugin.camera)
    })

    test('the key does nothing with a modifier, held down, in a text field, after another handler, or for another key', () => {
        const {plugin} = setup()
        for (const fields of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true}, {repeat: true}]) {
            expect(key('KeyC', fields).defaultPrevented).toBe(false)
        }
        for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
            const e = Object.assign(new Event('keydown', {cancelable: true}), {code: 'KeyC'})
            Object.defineProperty(e, 'target', {value: {tagName}})
            window.dispatchEvent(e)
        }
        const editable = Object.assign(new Event('keydown', {cancelable: true}), {code: 'KeyC'})
        Object.defineProperty(editable, 'target', {value: {tagName: 'DIV', isContentEditable: true}})
        window.dispatchEvent(editable)
        const used = Object.assign(new Event('keydown', {cancelable: true}), {code: 'KeyC'})
        used.preventDefault()
        window.dispatchEvent(used)
        key('KeyV')
        expect(plugin.editing).toBe(true)
    })

    test('hotkey sets the key or turns it off; a disabled plugin and a removed one do not take it', () => {
        const {plugin, viewer} = setup()
        plugin.hotkey = 'KeyK'
        key('KeyC')
        expect(plugin.editing).toBe(true)
        key('KeyK')
        expect(plugin.editing).toBe(false)
        key('KeyK')
        plugin.hotkey = ''
        expect(key('KeyK').defaultPrevented).toBe(false)
        expect(plugin.editing).toBe(true)

        plugin.hotkey = 'KeyC'
        plugin.enabled = false
        expect(key('KeyC').defaultPrevented).toBe(false)
        expect(plugin.editing).toBe(false)
        plugin.enabled = true
        plugin.onRemove(viewer)
        expect(key('KeyC').defaultPrevented).toBe(false)
        expect(plugin.editing).toBe(true)
    })

    test('editingChange tells when the view changes between Edit and View (the toggle, the key, disable, remove)', () => {
        const {plugin, viewer} = setup()
        const events: boolean[] = []
        plugin.addEventListener('editingChange', e => events.push(e.editing))
        plugin.editing = false
        plugin.editing = false // no change
        key('KeyC')
        plugin.enabled = false
        plugin.enabled = true
        plugin.onRemove(viewer)
        expect(events).toEqual([false, true, false, true, false])
    })

    test('is not saved with the viewer config', () => {
        expect(new EditorCameraPlugin().serializeWithViewer).toBe(false)
    })

    test('the orbit controls of the editor camera are made on the viewer canvas, not before the add on document.body', () => {
        const plugin = new EditorCameraPlugin()
        expect(plugin.camera.controls).toBeUndefined()
        const {plugin: added, viewer} = setup()
        expect((added.camera.controls as any)?.domElement).toBe(viewer.canvas)
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

    test('in View, startViewMoved after a look around; saveStartView keeps it as one undo step, and Edit keeps it', () => {
        const {plugin, start, records} = setup()
        expect(plugin.startViewMoved).toBe(false) // in Edit
        plugin.editing = false
        expect(plugin.startViewMoved).toBe(false)
        start.position.set(4, 1, 0)
        expect(plugin.startViewMoved).toBe(true)
        plugin.saveStartView()
        expect(start.controls.stopDamping).toHaveBeenCalled()
        expect(plugin.startViewMoved).toBe(false)
        expect(records).toHaveLength(1)
        plugin.editing = true // keepViewMoves is off: the saved view stays
        expect(start.position.toArray()).toEqual([4, 1, 0])
        expect(records).toHaveLength(1)
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(start.position.toArray()).toEqual([4, 1, 0])
    })

    test('saveStartView does nothing in Edit, or when the start view did not move', () => {
        const {plugin, start, records} = setup()
        plugin.saveStartView()
        plugin.editing = false
        plugin.saveStartView()
        expect(records).toHaveLength(0)
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('in View, undo and redo of a start view change end with startViewMoved false, and the last event says so', () => {
        const {plugin, start, records} = setup()
        // as the real camera: setDirty sends cameraUpdate, at once
        start.setDirty = () => start.dispatchEvent({type: 'cameraUpdate'})
        const events: boolean[] = []
        plugin.addEventListener('startViewMovedChange', e => events.push(e.moved))
        plugin.editing = false
        plugin.camera.position.set(5, 0, 0)
        plugin.setStartViewFromEditor()
        records[0].undo()
        expect(plugin.startViewMoved).toBe(false)
        expect(events.at(-1) ?? false).toBe(false)
        records[0].redo()
        expect(plugin.startViewMoved).toBe(false)
        expect(events.at(-1) ?? false).toBe(false)
    })

    test('startViewMovedChange tells when the moved state changes: a move, a save, a reset, Edit', () => {
        const {plugin, start} = setup()
        const events: boolean[] = []
        plugin.addEventListener('startViewMovedChange', e => events.push(e.moved))
        plugin.editing = false
        start.position.set(4, 1, 0)
        start.dispatchEvent({type: 'cameraUpdate'})
        start.position.set(3, 1, 0)
        start.dispatchEvent({type: 'cameraUpdate'}) // still moved: no event
        plugin.saveStartView()
        start.position.set(0, 2, 6)
        start.dispatchEvent({type: 'cameraUpdate'})
        plugin.resetStartView()
        start.dispatchEvent({type: 'cameraUpdate'})
        start.position.set(1, 1, 6)
        start.dispatchEvent({type: 'cameraUpdate'})
        plugin.editing = true // the look around is put back
        expect(events).toEqual([true, false, true, false, true, false])
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
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: viewerConfig}})
        start.position.set(4, 1, 0) // a look around
        plugin.editing = true
        expect(start.position.toArray()).toEqual([1, 2, 3])
    })

    test('a viewer config file sets the editor camera to its start view', () => {
        const {plugin, viewer, start} = setup()
        start.position.set(1, 2, 3)
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: viewerConfig})
        expect(plugin.camera.position.toArray()).toEqual([1, 2, 3])
    })

    test('a plugin preset (a config without a start view) leaves the cameras as they are', () => {
        const {plugin, viewer, start} = setup()
        plugin.camera.position.set(9, 0, 0) // the editor view
        plugin.editing = false
        start.position.set(4, 1, 0) // a look around in View
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {assetType: 'config', type: 'TonemapPlugin'}})
        expect(plugin.camera.position.toArray()).toEqual([9, 0, 0])
        plugin.editing = true
        expect(start.position.toArray()).toEqual([0, 1, 6]) // the look around is not kept
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

    test('setStartViewFromEditor gives a start camera without controls the editor rotation; undo the old one', () => {
        const {plugin, start, records} = setup()
        start.controls = undefined
        plugin.camera.position.set(5, 0, 0)
        plugin.camera.target.set(0, 0, 0)
        plugin.camera.lookAt(0, 0, 0) // the orbit controls do this for the editor camera
        plugin.setStartViewFromEditor()
        const forward = new Vector3(0, 0, -1).applyQuaternion(start.quaternion)
        expect(forward.x).toBeCloseTo(-1) // looks from +x to the origin
        records[0].undo()
        const back = new Vector3(0, 0, -1).applyQuaternion(start.quaternion)
        expect(back.z).toBeLessThan(-0.9) // looks from (0, 1, 6) to the origin again
    })

    test('View and back to Edit keep a rotation that does not look at the target', () => {
        const {plugin, start} = setup()
        start.controls = undefined
        start.rotation.set(0.3, 0.2, 0) // set in the camera UI, independent of the target
        const q = start.quaternion.clone()
        plugin.editing = false
        plugin.editing = true
        expect(start.quaternion.equals(q)).toBe(true)
    })

    test('copyStartView keeps the view direction of a start view that looks away from its target', () => {
        const {plugin, start} = setup()
        start.controls = undefined
        start.rotation.set(0, 0.5, 0) // set in the camera UI, independent of the target
        start.updateMatrixWorld()
        plugin.copyStartView()
        const forward = start.getWorldDirection(new Vector3())
        const editorForward = plugin.camera.target.clone().sub(plugin.camera.position).normalize()
        expect(editorForward.dot(forward)).toBeCloseTo(1)
        expect(plugin.camera.position.distanceTo(plugin.camera.target)).toBeCloseTo(start.position.distanceTo(start.target))
        // a start view that looks at its target gives its own target
        start.lookAt(start.target)
        start.updateMatrixWorld()
        plugin.copyStartView()
        expect(plugin.camera.target.toArray()).toEqual(start.target.toArray())
    })

    test('the zoom is part of the start view: put back in Edit, one undo step with keepViewMoves', () => {
        const {plugin, start, records} = setup()
        plugin.editing = false
        start.zoom = 2 // a zoom in View (an orthographic camera)
        plugin.resetStartView()
        expect(start.zoom).toBe(1)
        start.zoom = 2
        plugin.editing = true
        expect(start.zoom).toBe(1)

        plugin.keepViewMoves = true
        plugin.editing = false
        start.zoom = 3 // only the zoom changes
        plugin.editing = true
        expect(start.zoom).toBe(3)
        expect(records.length).toBe(1)
        records[0].undo()
        expect(start.zoom).toBe(1)
    })

    test('a file loaded with importConfig false leaves the cameras as they are', () => {
        const {plugin, viewer, start} = setup()
        plugin.camera.position.set(9, 0, 0) // the editor view
        start.position.set(1, 2, 3)
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: viewerConfig}, options: {importConfig: false}})
        expect(plugin.camera.position.toArray()).toEqual([9, 0, 0])
    })

    test('setStartViewFromEditor gives the start view the editor FOV; undo the old one', () => {
        const {plugin, start, records} = setup()
        start.fov = 50
        plugin.camera.fov = 30
        plugin.setStartViewFromEditor()
        expect(start.fov).toBe(30)
        records[0].undo()
        expect(start.fov).toBe(50)
    })

    test('dispose disposes the editor camera (its controls)', () => {
        const {plugin, viewer} = setup()
        const dispose = vi.spyOn(plugin.camera, 'dispose')
        plugin.onRemove(viewer)
        expect(dispose).not.toHaveBeenCalled() // a removed plugin can be added again
        plugin.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    test('undo restores the position also when a FOV change dollies the start view (dollyFov)', () => {
        const {plugin, start, records} = setup()
        let fov = 50
        Object.defineProperty(start, 'fov', {get: () => fov, set: (v: number) => {
            fov = v
            start.position.set(99, 99, 99) // the dolly of RootScene on a FOV change
        }})
        plugin.camera.fov = 30
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([2, 3, 4])
        records[0].undo()
        expect(fov).toBe(50)
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('in View, copyStartView also turns the editor camera to the start view', () => {
        const {plugin, start} = setup()
        plugin.editing = false
        plugin.camera.quaternion.set(0, 1, 0, 0) // an old editor view, looking the other way
        start.controls = undefined
        plugin.copyStartView() // e.g. a viewer config loads in View
        const forward = plugin.camera.getWorldDirection(new Vector3())
        expect(forward.dot(start.getWorldDirection(new Vector3()))).toBeCloseTo(1)
        // and the start view keeps its direction when it is set from the editor
        const q = start.quaternion.clone()
        plugin.setStartViewFromEditor()
        expect(start.quaternion.angleTo(q)).toBeCloseTo(0)
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
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: viewerConfig}})
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

    test('on remove, another main camera (set in Edit) stays the main camera', () => {
        const {plugin, scene, viewer} = setup()
        const other = new PerspectiveCamera()
        scene.mainCamera = other // e.g. a camera of the file, made the main camera in the UI
        plugin.onRemove(viewer)
        expect(scene.mainCamera).toBe(other)
    })
})
