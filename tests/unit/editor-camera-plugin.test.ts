import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Object3D, PerspectiveCamera, Vector3} from 'three'
import {OrbitControls3, OrthographicCamera2, PerspectiveCamera2} from 'threepipe'
import {EditorCameraPlugin} from '../../plugins/tweakpane-editor/src/EditorCameraPlugin'

// a viewer canvas for the orbit controls of the cameras (the node setup has no DOM)
function makeCanvas() {
    const listeners = {addEventListener: () => {}, removeEventListener: () => {}}
    return {style: {}, tabIndex: 0, clientWidth: 400, clientHeight: 300, ownerDocument: globalThis.document, ...listeners, getRootNode: () => listeners} as any
}

// a viewer config with a start view, as a file brings it
const viewerConfig = {assetType: 'config', type: 'ThreeViewer', scene: {defaultCamera: {}}}

/**
 * A start view (the scene's default camera) and a scene that tracks the main camera. By default the start camera has
 * mock controls (`orbit` false), and the preview camera mock controls that send the start and end events of a drag;
 * with `orbit` both have orbit controls on the viewer canvas, as the default camera of a viewer. `syncStartView` is off
 * unless `sync` (the tests of the preview need it off; its default is on).
 */
function setup({undo = true, orbit = false, ortho = false, sync = false} = {}) {
    const canvas = makeCanvas()
    const scene = new EventDispatcher<any>() as any
    const start = (ortho ? new OrthographicCamera2(orbit ? 'orbit' : '', canvas) : new PerspectiveCamera2(orbit ? 'orbit' : '', orbit ? canvas : undefined)) as any
    start.name = 'Default Camera'
    start.target.set(0, 0, 0)
    start.position.set(0, 1, 6)
    start.lookAt(start.target) // the controls of the start view do this
    if (!orbit) Object.defineProperty(start, 'controls', {value: {stopDamping: vi.fn()}, writable: true, configurable: true})
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
    // the subscriptions of forPlugin: mounted at once when the plugin is there; unmount for a remove of the plugin
    const subscriptions: {type: string, mount: (p: any) => void, unmount?: (p: any) => void}[] = []
    const viewer = Object.assign(new EventDispatcher<any>(), {
        scene,
        canvas,
        assetManager: new EventDispatcher<any>(),
        getPlugin: (p: any) => undo && (p === 'UndoManagerPlugin' || p?.PluginType === 'UndoManagerPlugin') ? undoPlugin : undefined,
        forPlugin: (type: string, mount: (p: any) => void, unmount?: (p: any) => void) => {
            subscriptions.push({type, mount, unmount})
            const p = viewer.getPlugin(type)
            if (p) mount(p)
        },
        subscriptions,
        undoPlugin,
    }) as any

    const plugin = new EditorCameraPlugin()
    plugin.syncStartView = sync
    plugin.camera.activateMain = activate(plugin.camera) as any
    plugin.onAdded(viewer)
    const preview = plugin.previewCamera as PerspectiveCamera2
    preview.activateMain = activate(preview) as any
    if (!orbit) Object.defineProperty(preview, 'controls', {value: Object.assign(new EventDispatcher<any>(), {stopDamping: vi.fn()}), writable: true, configurable: true})
    return {plugin, scene, start, preview, records, viewer}
}

// a change of the pose of a camera: in View, out of a gesture, as a clamp of the orbit limits or an animation makes it
function move(camera: any, x: number, y: number, z: number) {
    camera.position.set(x, y, z)
    camera.setDirty()
}

// a user gesture on the preview, as its controls send it: the start event, the changes, the end event
function gesture(preview: any, change: () => void) {
    preview.controls.dispatchEvent({type: 'start'})
    change()
    preview.controls.dispatchEvent({type: 'end'})
}

// a drag of the user in View: a move in a gesture
function drag(preview: any, x: number, y: number, z: number) {
    gesture(preview, () => move(preview, x, y, z))
}

// frames of the viewer for a while: a synced move ends after a time and frames without a move
function wait(viewer: any, ms: number, frames = 3) {
    for (let i = 0; i < frames; i++) viewer.dispatchEvent({type: 'postFrame'})
    vi.advanceTimersByTime(ms)
    viewer.dispatchEvent({type: 'postFrame'})
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
    afterEach(() => {
        vi.useRealTimers()
    })

    test('the C key switches between Edit and View', () => {
        const {plugin, scene, preview} = setup()
        const e = key('KeyC')
        expect(e.defaultPrevented).toBe(true)
        expect(plugin.editing).toBe(false)
        expect(scene.mainCamera).toBe(preview)
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
        expect(plugin.previewCamera).toBeUndefined()
        const {plugin: added, viewer} = setup()
        expect((added.camera.controls as any)?.domElement).toBe(viewer.canvas)
    })

    test('on add, the editor camera takes the start view and becomes the main camera; both cameras are in the scene, not in the model root', () => {
        const {plugin, scene, start, preview} = setup()
        expect(scene.children).toContain(plugin.camera)
        expect(scene.children).toContain(preview)
        expect(scene.mainCamera).toBe(plugin.camera)
        expect(plugin.homeCamera).toBe(plugin.camera)
        expect(plugin.camera.position.toArray()).toEqual(start.position.toArray())
        expect(plugin.camera.target.toArray()).toEqual(start.target.toArray())
    })

    test('View looks through the preview camera at the start view; a move there does not change the start view', () => {
        const {plugin, scene, start, preview, records} = setup()
        plugin.editing = false
        expect(scene.mainCamera).toBe(preview)
        expect(plugin.homeCamera).toBe(preview)
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        expect(preview.quaternion.equals(start.quaternion)).toBe(true)

        drag(preview, 4, 1, 0) // a look around in View
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(plugin.startViewMoved).toBe(true)
        plugin.editing = true
        expect(scene.mainCamera).toBe(plugin.camera)
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(records).toHaveLength(0)
        // the next View starts at the start view again
        plugin.editing = false
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        expect(plugin.startViewMoved).toBe(false)
    })

    test('the preview camera has the controls, projection and settings of the start camera, not its uuid or name', () => {
        const {plugin, start, preview, viewer} = setup({orbit: true})
        const controls = start.controls as OrbitControls3
        controls.minDistance = 3
        controls.enableDamping = true
        start.fov = 30
        start.userData.label = 'start'
        plugin.editing = false
        const pc = preview.controls as OrbitControls3
        expect(preview.controlsMode).toBe('orbit')
        expect(pc.domElement).toBe(viewer.canvas)
        expect(pc.minDistance).toBe(3)
        expect(pc.enableDamping).toBe(true)
        expect(preview.fov).toBe(30)
        expect(preview.userData.label).toBe('start')
        expect(preview.userData.disableWidgets).toBe(true)
        expect(start.userData.disableWidgets).toBeUndefined()
        expect(preview.uuid).not.toBe(start.uuid)
        expect(preview.name).not.toBe(start.name)

        // a change of the start camera settings in Edit is in the next View
        plugin.editing = true
        controls.minDistance = 5
        plugin.editing = false
        expect((preview.controls as OrbitControls3).minDistance).toBe(5)
    })

    test('the preview camera of an orthographic start camera is orthographic', () => {
        const {plugin, preview, start} = setup({ortho: true})
        expect((preview as any).isOrthographicCamera).toBe(true)
        start.zoom = 2
        plugin.editing = false
        expect(preview.zoom).toBe(2)
    })

    test('an export in View after a move that was not saved has the saved start view (the default camera is what a viewer config saves)', () => {
        const {plugin, start, preview} = setup({orbit: true})
        plugin.editing = false
        drag(preview, 4, 1, 0)
        const json = start.toJSON()
        expect(json.position).toEqual(expect.objectContaining({x: 0, y: 1, z: 6}))
        expect(json.uuid ?? json.object?.uuid).not.toBe(preview.uuid)
    })

    test('copyStartView stops the glide of the editor camera (smooth), so it does not move on from the start view', () => {
        const {plugin} = setup({orbit: true})
        plugin.smooth = true
        const stop = vi.spyOn(plugin.camera.controls as OrbitControls3, 'stopDamping')
        plugin.copyStartView()
        expect(stop).toHaveBeenCalled()
    })

    test('syncStartView is on by default', () => {
        expect(new EditorCameraPlugin().syncStartView).toBe(true)
    })

    test('syncStartView: a move in View changes the start view at once, as one undo step until it ends', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup()
        const changes: number[] = []
        const syncs: boolean[] = []
        plugin.addEventListener('startViewChange', () => changes.push(start.position.x))
        plugin.addEventListener('syncStartViewChange', e => syncs.push(e.sync))
        plugin.syncStartView = true
        expect(syncs).toEqual([true])
        plugin.editing = false
        gesture(preview, () => {
            move(preview, 4, 1, 0)
            move(preview, 3, 1, 0)
        })
        expect(start.position.toArray()).toEqual([3, 1, 0])
        expect(changes).toEqual([4, 3])
        expect(plugin.startViewMoved).toBe(false)
        expect(records).toHaveLength(1)
        wait(viewer, EditorCameraPlugin.SyncGestureDelay - 1)
        move(preview, 3.5, 1, 0) // the glide: not ended yet, the same step
        expect(records).toHaveLength(1)
        wait(viewer, EditorCameraPlugin.SyncGestureDelay)
        drag(preview, 2, 1, 0) // the next move
        expect(records).toHaveLength(2)
        wait(viewer, EditorCameraPlugin.SyncGestureDelay)

        records[1].undo()
        expect(start.position.toArray()).toEqual([3.5, 1, 0])
        expect(preview.position.toArray()).toEqual([3.5, 1, 0]) // the view goes there too
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(start.position.toArray()).toEqual([3.5, 1, 0])
        expect(records).toHaveLength(2) // an undo is not a move
    })

    test('syncStartView: a start view that loads during a move ends the move; the next move is a new step from it', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup({orbit: true})
        plugin.syncStartView = true
        plugin.editing = false
        const controls = preview.controls as OrbitControls3
        controls.dispatchEvent({type: 'start'})
        move(preview, 4, 1, 0)
        expect(records).toHaveLength(1)
        // the file's start view, imported before loadAsset
        start.position.set(0, 2, 8)
        start.setDirty()
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: viewerConfig})
        move(preview, 1, 2, 7) // the drag goes on
        expect(records).toHaveLength(2)
        records[1].undo()
        expect(start.position.toArray()).toEqual([0, 2, 8])
    })

    test('syncStartView: a drag is one move while the pointer is down, also when it stops for a while', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup({orbit: true})
        plugin.syncStartView = true
        plugin.editing = false
        const controls = preview.controls as OrbitControls3
        controls.dispatchEvent({type: 'start'})
        move(preview, 4, 1, 0)
        wait(viewer, 2000) // held still
        move(preview, 3, 1, 0)
        controls.dispatchEvent({type: 'end'})
        move(preview, 2.9, 1, 0) // the glide of damping
        expect(records).toHaveLength(1)
        // wheel steps close together: one step
        controls.dispatchEvent({type: 'start'})
        move(preview, 2.5, 1, 0)
        controls.dispatchEvent({type: 'end'})
        expect(records).toHaveLength(1)
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(start.position.toArray()).toEqual([2.5, 1, 0])
        controls.dispatchEvent({type: 'start'})
        move(preview, 2.4, 1, 0) // after an undo or a redo: a new step
        expect(records).toHaveLength(2)
        // a drag later is a new step, also during the glide of the last one
        controls.dispatchEvent({type: 'end'})
        vi.advanceTimersByTime(EditorCameraPlugin.SyncGestureDelay)
        move(preview, 2.3, 1, 0)
        controls.dispatchEvent({type: 'start'})
        move(preview, 2, 1, 0)
        expect(records).toHaveLength(3)
    })

    test('syncStartView: at a slow frame rate, the glide of damping is part of the move', () => {
        vi.useFakeTimers()
        const {plugin, preview, records, viewer} = setup()
        plugin.syncStartView = true
        plugin.editing = false
        // a frame each 500 ms, each one moves the view a little: the drag, then the glide
        for (const x of [4, 3.5, 3.2, 3.1]) {
            if (x === 4) drag(preview, x, 1, 0)
            else move(preview, x, 1, 0)
            vi.advanceTimersByTime(500)
            viewer.dispatchEvent({type: 'postFrame'})
        }
        expect(records).toHaveLength(1)
        wait(viewer, 0) // frames without a move
        drag(preview, 3, 1, 0)
        expect(records).toHaveLength(2)
        records[1].undo()
        records[0].undo()
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(preview.position.toArray()).toEqual([3.1, 1, 0])
    })

    test('syncStartView off: a move in View does not touch the start view or send startViewChange', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup()
        const changes = vi.fn()
        plugin.addEventListener('startViewChange', changes)
        plugin.editing = false
        drag(preview, 4, 1, 0)
        wait(viewer, 1000)
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(changes).not.toHaveBeenCalled()
        expect(records).toHaveLength(0)
    })

    test.each([true, false])('a change of the view in View out of a user gesture (a clamp of the orbit limits, an animation) is not a move, with sync %s', (sync) => {
        const {plugin, start, preview, records} = setup({sync})
        const changes = vi.fn()
        const moved = vi.fn()
        plugin.addEventListener('startViewChange', changes)
        plugin.addEventListener('startViewMovedChange', moved)
        plugin.editing = false
        move(preview, 0, 1, 5) // the orbit controls clamp a start view that is outside their limits
        expect(records).toHaveLength(0)
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(plugin.startViewMoved).toBe(false)
        plugin.saveStartView() // nothing to save
        plugin.syncStartView = true // turned on: no move to save
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(records).toHaveLength(0)
        expect(changes).not.toHaveBeenCalled()
        expect(moved).not.toHaveBeenCalled()
        // the start view changes in the camera panel: the view, that the user did not move, follows it
        move(start, 1, 1, 1)
        expect(preview.position.toArray()).toEqual([1, 1, 1])
    })

    test.each([true, false])('a change after the end of a gesture, or after a reset, an undo or a load in its glide, is not a move, with sync %s', (sync) => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup({sync})
        plugin.editing = false
        drag(preview, 4, 1, 0)
        move(preview, 3.9, 1, 0) // the glide of damping is part of the gesture
        expect(plugin.startViewMoved).toBe(!sync)
        expect(start.position.toArray()).toEqual(sync ? [3.9, 1, 0] : [0, 1, 6])
        wait(viewer, EditorCameraPlugin.SyncGestureDelay)
        move(preview, 3.5, 1, 0) // an animation of another plugin, after the gesture
        expect(start.position.toArray()).toEqual(sync ? [3.9, 1, 0] : [0, 1, 6])
        expect(records).toHaveLength(sync ? 1 : 0)

        // the plugin sets the view (a reset, an undo, a load) in the time of the glide of a gesture, then the controls clamp it
        const actions: Record<string, () => void> = {
            reset: () => plugin.resetStartView(),
            undo: () => records.at(-1)?.undo(),
            load: () => viewer.assetManager.dispatchEvent({type: 'loadAsset', data: viewerConfig}),
        }
        for (const [name, action] of Object.entries(actions)) {
            if (name === 'undo') { // a step to undo, also without sync
                plugin.camera.position.set(1, 1, 5)
                plugin.setStartViewFromEditor()
            }
            drag(preview, 2, 1, 0)
            const count = records.length
            action()
            const saved = start.position.toArray()
            move(preview, 2.5, 1, 0)
            expect(plugin.startViewMoved, name).toBe(false)
            expect(records, name).toHaveLength(count)
            expect(start.position.toArray(), name).toEqual(saved)
            wait(viewer, EditorCameraPlugin.SyncGestureDelay)
        }
    })

    test('syncStartView turned on after a move in View saves the view; Edit and sync off end a move at once', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup()
        plugin.editing = false
        drag(preview, 4, 1, 0)
        plugin.syncStartView = true
        expect(start.position.toArray()).toEqual([4, 1, 0])
        expect(records).toHaveLength(1)

        drag(preview, 3, 1, 0)
        plugin.editing = true // ends the move
        expect(records).toHaveLength(2)
        plugin.editing = false
        drag(preview, 2, 1, 0)
        plugin.syncStartView = false // ends the move
        expect(records).toHaveLength(3)
        wait(viewer, 1000)
        expect(records).toHaveLength(3)
        drag(preview, 1, 1, 0) // a preview only now
        expect(start.position.toArray()).toEqual([2, 1, 0])
    })

    test('in View, saveStartView keeps the move as one undo step, and Edit keeps it', () => {
        const {plugin, start, preview, records} = setup({orbit: true})
        expect(plugin.startViewMoved).toBe(false) // in Edit
        plugin.editing = false
        const stop = vi.spyOn(preview.controls as OrbitControls3, 'stopDamping')
        expect(plugin.startViewMoved).toBe(false)
        drag(preview, 4, 1, 0)
        expect(plugin.startViewMoved).toBe(true)
        plugin.saveStartView()
        expect(stop).toHaveBeenCalled()
        expect(start.position.toArray()).toEqual([4, 1, 0])
        expect(plugin.startViewMoved).toBe(false)
        expect(records).toHaveLength(1)
        plugin.editing = true
        expect(start.position.toArray()).toEqual([4, 1, 0])
        expect(records).toHaveLength(1)
        records[0].undo()
        expect(start.position.toArray()).toEqual([0, 1, 6])
        records[0].redo()
        expect(start.position.toArray()).toEqual([4, 1, 0])
    })

    test('saveStartView does nothing in Edit, or when the view did not move', () => {
        const {plugin, start, records} = setup()
        plugin.saveStartView()
        plugin.editing = false
        plugin.saveStartView()
        expect(records).toHaveLength(0)
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('in View, undo and redo of a start view change move the view there too, with startViewMoved false', () => {
        const {plugin, start, preview, records} = setup()
        const events: boolean[] = []
        plugin.addEventListener('startViewMovedChange', e => events.push(e.moved))
        plugin.editing = false
        plugin.camera.position.set(5, 0, 0)
        plugin.setStartViewFromEditor()
        expect(preview.position.toArray()).toEqual([5, 0, 0])
        records[0].undo()
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        expect(plugin.startViewMoved).toBe(false)
        expect(events.at(-1) ?? false).toBe(false)
        drag(preview, 4, 1, 0) // a move that is not saved: the redo replaces it
        records[0].redo()
        expect(start.position.toArray()).toEqual([5, 0, 0])
        expect(preview.position.toArray()).toEqual([5, 0, 0])
        expect(plugin.startViewMoved).toBe(false)
        expect(events.at(-1)).toBe(false)
    })

    test('startViewMovedChange tells when the moved state changes: a move, a save, a reset, Edit', () => {
        const {plugin, preview} = setup()
        const events: boolean[] = []
        plugin.addEventListener('startViewMovedChange', e => events.push(e.moved))
        plugin.editing = false
        drag(preview, 4, 1, 0)
        drag(preview, 3, 1, 0) // still moved: no event
        plugin.saveStartView()
        drag(preview, 0, 2, 6)
        plugin.resetStartView()
        drag(preview, 1, 1, 6)
        plugin.editing = true // the look around is dropped
        expect(events).toEqual([true, false, true, false, true, false])
    })

    test('resetStartView takes the view back to the saved start view while in View', () => {
        const {plugin, start, preview} = setup()
        plugin.editing = false
        drag(preview, 4, 1, 0)
        plugin.resetStartView()
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        expect(start.position.toArray()).toEqual([0, 1, 6])
        expect(plugin.startViewMoved).toBe(false)
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

    test('startViewChange tells when the start view changes, also from outside (the camera panel); in View a view that was not moved follows it', () => {
        const {plugin, start, preview} = setup()
        const changes = vi.fn()
        plugin.addEventListener('startViewChange', changes)
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(changes).toHaveBeenCalledTimes(1)
        start.setDirty() // no change of the pose
        expect(changes).toHaveBeenCalledTimes(1)

        plugin.editing = false
        move(start, 1, 1, 1) // the camera panel
        expect(changes).toHaveBeenCalledTimes(2)
        expect(preview.position.toArray()).toEqual([1, 1, 1])
        drag(preview, 4, 1, 0)
        move(start, 2, 2, 2)
        expect(preview.position.toArray()).toEqual([4, 1, 0]) // a move that is not saved stays
        expect(plugin.startViewMoved).toBe(true)
    })

    test('showsStartView: the view is at the saved start view', () => {
        const {plugin, preview} = setup()
        expect(plugin.showsStartView).toBe(true) // the editor camera took the start view
        plugin.camera.position.set(9, 0, 0)
        expect(plugin.showsStartView).toBe(false)
        plugin.editing = false
        expect(plugin.showsStartView).toBe(true)
        drag(preview, 4, 1, 0)
        expect(plugin.showsStartView).toBe(false)
        plugin.saveStartView()
        expect(plugin.showsStartView).toBe(true)
        plugin.enabled = false
        expect(plugin.showsStartView).toBe(true) // the default camera is the main camera
    })

    test('in View, a file with a viewer config shows its start view, with its controls', () => {
        const {plugin, viewer, start, preview} = setup({orbit: true})
        plugin.editing = false
        drag(preview, 4, 1, 0) // a look around
        start.position.set(1, 2, 3) // the imported start view
        ;(start.controls as OrbitControls3).minDistance = 2
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {importedViewerConfig: viewerConfig}})
        expect(preview.position.toArray()).toEqual([1, 2, 3])
        expect((preview.controls as OrbitControls3).minDistance).toBe(2)
        expect(plugin.startViewMoved).toBe(false)
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
        const {plugin, viewer, start, preview} = setup()
        plugin.camera.position.set(9, 0, 0) // the editor view
        plugin.editing = false
        drag(preview, 4, 1, 0) // a look around in View
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: {assetType: 'config', type: 'TonemapPlugin'}})
        expect(plugin.camera.position.toArray()).toEqual([9, 0, 0])
        expect(preview.position.toArray()).toEqual([4, 1, 0])
        expect(start.position.toArray()).toEqual([0, 1, 6])
    })

    test('added in View: the view is the start view', () => {
        const {plugin, scene, start, preview, viewer} = setup()
        plugin.onRemove(viewer)
        expect(scene.mainCamera).toBe(start)
        plugin.editing = false
        plugin.onAdded(viewer)
        expect(plugin.previewCamera).toBe(preview) // kept for the next add
        expect(scene.mainCamera).toBe(preview)
        expect(preview.position.toArray()).toEqual([0, 1, 6])
        drag(preview, 4, 1, 0)
        plugin.resetStartView()
        expect(preview.position.toArray()).toEqual([0, 1, 6])
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

    test('View shows, and Edit keeps, a rotation that does not look at the target', () => {
        const {plugin, start, preview} = setup()
        start.controls = undefined
        start.rotation.set(0.3, 0.2, 0) // set in the camera UI, independent of the target
        const q = start.quaternion.clone()
        plugin.editing = false
        expect(preview.quaternion.angleTo(q)).toBeCloseTo(0)
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

    test('the zoom is part of the start view: a zoom in View is a move, saved as one undo step', () => {
        const {plugin, start, preview, records} = setup()
        plugin.editing = false
        const zoom = (z: number) => gesture(preview, () => {
            preview.zoom = z
            preview.setDirty()
        })
        zoom(2) // a zoom in View (an orthographic camera)
        expect(plugin.startViewMoved).toBe(true)
        plugin.resetStartView()
        expect(preview.zoom).toBe(1)
        zoom(3) // only the zoom changes
        plugin.saveStartView()
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

    test('dispose disposes the editor camera and the preview camera (their controls)', () => {
        const {plugin, viewer, preview} = setup()
        const dispose = vi.spyOn(plugin.camera, 'dispose')
        const disposePreview = vi.spyOn(preview, 'dispose')
        plugin.onRemove(viewer)
        expect(dispose).not.toHaveBeenCalled() // a removed plugin can be added again
        expect(disposePreview).not.toHaveBeenCalled()
        plugin.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(disposePreview).toHaveBeenCalledTimes(1)
        expect(plugin.previewCamera).toBeUndefined()
    })

    test('undo restores the position also when a FOV change dollies the start view (dollyFov)', () => {
        const {plugin, start, records} = setup()
        let fov = 50
        Object.defineProperty(start, 'fov', {configurable: true, get: () => fov, set: (v: number) => {
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

    test('an orthographic start camera: copyStartView does not copy its zoom into the perspective editor camera', () => {
        const {plugin, start} = setup({ortho: true})
        start.zoom = 3 // the framing of the orthographic camera
        plugin.camera.zoom = 1.2
        plugin.copyStartView()
        expect(plugin.camera.zoom).toBe(1.2)
        expect(plugin.camera.position.toArray()).toEqual(start.position.toArray())
    })

    test('an orthographic start camera: setStartViewFromEditor keeps its zoom, and the same view is no undo step', () => {
        const {plugin, start, records} = setup({ortho: true})
        start.zoom = 3
        plugin.camera.zoom = 1.2
        plugin.setStartViewFromEditor() // the editor camera is at the start view (the add copied it)
        expect(records).toHaveLength(0)
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([2, 3, 4])
        expect(start.zoom).toBe(3)
        expect(records).toHaveLength(1)
    })

    test('the UndoManagerPlugin is looked up once (forPlugin), not on each record; after its remove, there are no records', () => {
        vi.useFakeTimers()
        const {plugin, start, preview, records, viewer} = setup({sync: true})
        const getPlugin = vi.spyOn(viewer, 'getPlugin')
        plugin.editing = false
        gesture(preview, () => {
            for (let i = 0; i < 5; i++) move(preview, i + 1, 1, 0) // each frame of a synced move
        })
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(records).toHaveLength(2)
        expect(getPlugin).not.toHaveBeenCalled()
        for (const s of viewer.subscriptions) if (s.type === 'UndoManagerPlugin') s.unmount?.(viewer.undoPlugin)
        plugin.camera.position.set(1, 3, 4)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([1, 3, 4])
        expect(records).toHaveLength(2)
    })

    test('setStartViewFromEditor works without the UndoManagerPlugin', () => {
        const {plugin, start} = setup({undo: false})
        plugin.camera.position.set(2, 3, 4)
        plugin.setStartViewFromEditor()
        expect(start.position.toArray()).toEqual([2, 3, 4])
    })

    test('disabled: the view goes to the scene\'s default camera and Edit stays off', () => {
        const {plugin, scene, start} = setup()
        plugin.editing = false
        plugin.enabled = false
        expect(scene.mainCamera).toBe(start)
        expect(plugin.homeCamera).toBe(start)
        plugin.editing = true
        expect(plugin.editing).toBe(false)
        expect(scene.mainCamera).toBe(start)
        plugin.enabled = true
        expect(scene.mainCamera).toBe(plugin.camera)
    })

    test('disable(key), as enabled false: the view goes to the scene\'s default camera until enable(key); editingChange tells it', () => {
        const {plugin, scene, start} = setup()
        const events: boolean[] = []
        plugin.addEventListener('editingChange', e => events.push(e.editing))
        plugin.disable('test')
        expect(plugin.isDisabled()).toBe(true)
        expect(scene.mainCamera).toBe(start)
        expect(plugin.editing).toBe(false)
        plugin.editing = true
        expect(plugin.editing).toBe(false)
        expect(key('KeyC').defaultPrevented).toBe(false)
        expect(scene.mainCamera).toBe(start)
        plugin.enable('test')
        expect(scene.mainCamera).toBe(plugin.camera)
        expect(plugin.editing).toBe(true)
        expect(events).toEqual([false, true])
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

    test('on remove, the start view is the main camera and the editor and preview cameras leave the scene', () => {
        const {plugin, scene, start, preview, viewer} = setup()
        plugin.editing = false
        scene.children = []
        start.add(plugin.camera) // any parent: removeFromParent takes it out
        start.add(preview)
        plugin.onRemove(viewer)
        expect(scene.mainCamera).toBe(start)
        expect(plugin.camera.parent).toBeNull()
        expect(preview.parent).toBeNull()
        expect(plugin.editing).toBe(false) // kept for the next add
    })

    test('on remove, the plugin stops listening to the controls of the preview camera and refreshes its UI', () => {
        const {plugin, preview, viewer} = setup({orbit: true})
        plugin.editing = false
        const controls = preview.controls as OrbitControls3
        const onStart = (plugin as any)._onDragStart
        expect(controls.hasEventListener('start', onStart)).toBe(true)
        const uiRefresh = vi.fn()
        Object.defineProperty(plugin, 'uiConfig', {value: {uiRefresh}, configurable: true})
        plugin.onRemove(viewer)
        expect(controls.hasEventListener('start', onStart)).toBe(false)
        expect(controls.hasEventListener('end', (plugin as any)._onDragEnd)).toBe(false)
        expect(uiRefresh).toHaveBeenCalled()
        // added again in View: it listens again
        plugin.onAdded(viewer)
        expect((preview.controls as OrbitControls3).hasEventListener('start', onStart)).toBe(true)
    })

    test('on remove, another main camera (set in Edit) stays the main camera', () => {
        const {plugin, scene, viewer} = setup()
        const other = new PerspectiveCamera()
        scene.mainCamera = other // e.g. a camera of the file, made the main camera in the UI
        plugin.onRemove(viewer)
        expect(scene.mainCamera).toBe(other)
    })
})

describe('EditorCameraPlugin View and main camera plugins', () => {
    test('a limit that a plugin sets on the main camera change (like the ground limit) applies to the preview in View', () => {
        const {plugin, scene, start} = setup({orbit: true})
        // as BaseGroundPlugin with limitCameraAboveGround: the orbit controls of the main camera get a max polar angle
        scene.addEventListener('mainCameraChange', () => {
            const orbit = scene.mainCamera.controls as OrbitControls3 | undefined
            if (orbit?.maxPolarAngle !== undefined) orbit.maxPolarAngle = Math.PI / 2
        })
        ;(start.controls as OrbitControls3).maxPolarAngle = Math.PI // the start camera is not limited while it is not the main camera
        for (let i = 0; i < 2; i++) { // the first View and a later one
            plugin.editing = false
            expect(plugin.previewCamera?.controls).toBeInstanceOf(OrbitControls3)
            expect((plugin.previewCamera!.controls as OrbitControls3).maxPolarAngle).toBe(Math.PI / 2)
            plugin.editing = true
        }
    })

    // as BaseGroundPlugin with limitCameraAboveGround: the orbit controls of the main camera get a max polar angle
    function groundLimit(scene: any) {
        scene.addEventListener('mainCameraChange', () => {
            const orbit = scene.mainCamera.controls as OrbitControls3 | undefined
            if (orbit?.maxPolarAngle !== undefined) orbit.maxPolarAngle = Math.PI / 2
        })
    }

    test('the limit stays on the preview when a viewer config loads in View', () => {
        const {plugin, scene, start, viewer} = setup({orbit: true})
        groundLimit(scene)
        plugin.editing = false
        ;(start.controls as OrbitControls3).maxPolarAngle = Math.PI // the start camera of the new file
        viewer.assetManager.dispatchEvent({type: 'loadAsset', data: viewerConfig})
        expect(scene.mainCamera).toBe(plugin.previewCamera)
        expect(plugin.editing).toBe(false)
        expect((plugin.previewCamera!.controls as OrbitControls3).maxPolarAngle).toBe(Math.PI / 2)
    })

    test('the preview gets the controls of a mode that a controls plugin gives the main camera only', () => {
        const {plugin, scene, start} = setup({orbit: true})
        // as ACameraControlsPlugin: the controls constructor of its mode is on the main camera only
        const ctor = (object: any, dom: any) => new OrbitControls3(object, dom)
        const register = (cam: any) => cam?.setControlsCtor?.('test', ctor, true)
        scene.addEventListener('mainCameraChange', (e: any) => {
            e.lastCamera?.removeControlsCtor?.('test')
            register(scene.mainCamera)
        })
        register(start)
        start.controlsMode = 'test'
        expect(start.controls).toBeInstanceOf(OrbitControls3)
        start.removeControlsCtor('test') // it is not the main camera
        for (let i = 0; i < 2; i++) {
            plugin.editing = false
            expect(plugin.previewCamera!.controlsMode).toBe('test')
            expect(plugin.previewCamera!.controls).toBeInstanceOf(OrbitControls3)
            plugin.editing = true
        }
    })
})
