import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {BoxGeometry, DirectionalLight, EventDispatcher, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Vector3} from 'three'
import {JSUndoManager} from 'ts-browser-helpers'
import {IObject3D, ObjectPicker} from 'threepipe'
import {
    childTargets,
    contentChildren,
    hasContent,
    isFrame,
    parentTarget,
    resolveTarget,
    scopeObjects,
    selectionLevels,
    siblingTarget,
    toggleSelected,
} from '../../plugins/tweakpane-editor/src/selection/selectionHierarchy'
import {SelectionUxPlugin} from '../../plugins/tweakpane-editor/src/selection/SelectionUxPlugin'

const geometry = new BoxGeometry(0.5, 0.5, 0.5)
const material = new MeshBasicMaterial()

function mesh(name: string, x = 0, y = 0, z = 0, size = 1) {
    const m = new Mesh(geometry, material)
    m.name = name
    m.position.set(x, y, z)
    m.scale.setScalar(size)
    return m as any as IObject3D
}

function group(name: string, ...children: Object3D[]) {
    const g = new Group()
    g.name = name
    g.add(...children)
    return g as any as IObject3D
}

/**
 * root > Ring > Band, Head > (Gem > Crown, Pavilion), (Prongs > Prong 1, Prong 2)
 *      > Scene > root > Watch > Case, Dial (glTF wrappers)
 *      > Stand
 */
function jewellery() {
    const s = {
        band: mesh('Band'), crown: mesh('Crown'), pavilion: mesh('Pavilion'), prong1: mesh('Prong 1'), prong2: mesh('Prong 2'),
        case: mesh('Case'), dial: mesh('Dial'), stand: mesh('Stand'),
    } as Record<string, IObject3D>
    s.gem = group('Gem', s.crown, s.pavilion)
    s.prongs = group('Prongs', s.prong1, s.prong2)
    s.head = group('Head', s.gem, s.prongs)
    s.ring = group('Ring', s.band, s.head)
    s.watch = group('Watch', s.case, s.dial)
    s.watchRoot = group('root', s.watch)
    s.watchScene = group('Scene', s.watchRoot)
    s.root = group('modelRoot', s.ring, s.watchScene, s.stand)
    return s
}

describe('selection hierarchy', () => {
    test('levels go from the top down; a group with a single child is one level with it', () => {
        const s = jewellery()
        expect(selectionLevels(s.root, s.crown)).toEqual([[s.ring], [s.head], [s.gem], [s.crown]])
        expect(selectionLevels(s.root, s.case)).toEqual([[s.watchScene, s.watchRoot, s.watch], [s.case]])
        expect(selectionLevels(s.root, s.watchRoot)).toEqual([[s.watchScene, s.watchRoot]]) // down to the node only
        expect(selectionLevels(s.root, s.root)).toEqual([])
        expect(selectionLevels(s.root, mesh('Outside'))).toEqual([])
    })

    test('helpers and empty groups are not content', () => {
        const s = jewellery()
        const light = new DirectionalLight() as any as IObject3D
        light.add(light.target) // the target child of a light
        const hidden = mesh('Not selectable')
        hidden.userData.userSelectable = false
        const empty = group('Empty')
        s.ring.add(light, hidden, empty)
        expect(contentChildren(light)).toEqual([])
        expect(contentChildren(s.ring)).toEqual([s.band, s.head, light, empty])
        expect(hasContent(light)).toBe(true)
        expect(hasContent(empty)).toBe(false)
        expect(childTargets(s.root, [s.ring])).toEqual([s.band, s.head, light])
    })

    test('an object that cannot be selected is not a level, and a hidden single child does not merge', () => {
        const a = mesh('A'), b = mesh('B'), c = mesh('C'), d = mesh('D')
        const locked = group('Locked', a, b)
        locked.userData.userSelectable = false
        const hidden = group('Hidden', c, d)
        hidden.visible = false
        const wrapper = group('Wrapper', hidden)
        const root = group('modelRoot', locked, wrapper)
        expect(selectionLevels(root, a)).toEqual([[a]])
        expect(resolveTarget(root, [], a, false, false)).toBe(a) // not the locked group
        expect(selectionLevels(root, c)).toEqual([[wrapper], [hidden], [c]])
        expect(childTargets(root, [wrapper])).toEqual([]) // Enter: the parts of the hidden group are not shown
        // the parts of the locked group are at its parent's level: Tab and Ctrl+A reach them
        expect(scopeObjects(root, [a])).toEqual([a, b, wrapper])
        expect(siblingTarget(root, [a], 1)).toBe(b)
        const outer = group('Outer', locked)
        root.add(outer)
        expect(childTargets(root, [outer])).toEqual([a, b]) // Enter
        expect(selectionLevels(root, a)).toEqual([[outer], [a]])
        expect(parentTarget(root, [a])).toBe(outer)
        // a hidden locked group has no parts to select
        locked.visible = false
        expect(childTargets(root, [outer])).toEqual([])
    })

    test('a frame: a file root, or the only top-level object with meshes, with two or more parts', () => {
        const s = jewellery()
        expect(isFrame(s.root, s.ring)).toBe(false) // other top-level objects have meshes
        expect(isFrame(s.root, s.watchScene)).toBe(false)
        s.watchScene.userData.gltfAsset = {} // an imported glTF root
        expect(isFrame(s.root, s.watchScene)).toBe(true)
        expect(isFrame(s.root, s.watch)).toBe(false) // not at the top level

        const only = jewellery()
        only.root.remove(only.watchScene, only.stand)
        expect(isFrame(only.root, only.ring)).toBe(true)
        only.ring.remove(only.head)
        expect(isFrame(only.root, only.ring)).toBe(false) // one part only
    })

    test('resolveTarget: group first, deep, drill and siblings', () => {
        const s = jewellery()
        const r = (leaf: IObject3D, selected: IObject3D[], deep = false, drill = false) => resolveTarget(s.root, selected, leaf, deep, drill)
        // group first
        expect(r(s.crown, [])).toBe(s.ring)
        expect(r(s.case, [])).toBe(s.watchScene) // the outermost of the wrapper chain
        // deep (Ctrl+click): the leaf
        expect(r(s.crown, [], true)).toBe(s.crown)
        // the selected group stays; drill goes one level deeper each time
        expect(r(s.crown, [s.ring])).toBe(s.ring)
        expect(r(s.crown, [s.ring], false, true)).toBe(s.head)
        expect(r(s.crown, [s.head], false, true)).toBe(s.gem)
        expect(r(s.crown, [s.gem], false, true)).toBe(s.crown)
        expect(r(s.crown, [s.crown], false, true)).toBe(s.crown) // the deepest level
        expect(r(s.case, [s.watchScene], false, true)).toBe(s.case) // a chain is one level
        // a part of the same group as the selection: that part
        expect(r(s.prong1, [s.gem])).toBe(s.prongs)
        expect(r(s.pavilion, [s.crown])).toBe(s.pavilion)
        // outside the group of the selection: the top level
        expect(r(s.stand, [s.crown])).toBe(s.stand)
        expect(r(s.case, [s.crown])).toBe(s.watchScene)
        // a frame passes the click to its part
        s.watchScene.userData.gltfAsset = {}
        expect(r(s.dial, [])).toBe(s.dial)
        expect(r(mesh('Outside'), [])).toBe(null)
    })

    test('parent, children and siblings', () => {
        const s = jewellery()
        expect(parentTarget(s.root, [s.crown, s.stand])).toBe(s.gem) // of the primary selection
        expect(parentTarget(s.root, [s.ring])).toBe(null)
        expect(parentTarget(s.root, [])).toBe(null)
        expect(childTargets(s.root, [s.head])).toEqual([s.gem, s.prongs])
        expect(childTargets(s.root, [s.watchScene])).toEqual([s.case, s.dial])
        expect(childTargets(s.root, [s.crown])).toEqual([])

        expect(siblingTarget(s.root, [s.prong1], 1)).toBe(s.prong2)
        expect(siblingTarget(s.root, [s.prong2], 1)).toBe(s.prong1) // wraps around
        expect(siblingTarget(s.root, [s.prong1], -1)).toBe(s.prong2)
        expect(siblingTarget(s.root, [], 1)).toBe(s.ring)
        expect(siblingTarget(s.root, [], -1)).toBe(s.stand)
    })

    test('scope: the level of the selection; with nothing selected the top level, a frame stands for its parts', () => {
        const s = jewellery()
        expect(scopeObjects(s.root, [s.crown])).toEqual([s.crown, s.pavilion])
        expect(scopeObjects(s.root, [s.case])).toEqual([s.case, s.dial])
        expect(scopeObjects(s.root, [s.ring])).toEqual([s.ring, s.watchScene, s.stand])
        s.stand.visible = false
        expect(scopeObjects(s.root, [])).toEqual([s.ring, s.watchScene])
        s.watchScene.userData.gltfAsset = {}
        expect(scopeObjects(s.root, [])).toEqual([s.ring, s.case, s.dial])
    })

    test('Shift: toggle, an added object becomes the primary', () => {
        const s = jewellery()
        expect(toggleSelected([s.ring], s.stand)).toEqual([s.stand, s.ring])
        expect(toggleSelected([s.stand, s.ring], s.stand)).toEqual([s.ring])
    })
})

// region SelectionUxPlugin with a fake viewer

const SIZE = 400

/** An event with the fields the plugin reads */
function ev(type: string, fields: Record<string, any> = {}) {
    return Object.assign(new Event(type, {cancelable: true}), {isPrimary: true, button: 0, buttons: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...fields})
}

/**
 * Table (x -2) > Top, Legs > Leg 1, Leg 2; Lamp (x 2) with Wall behind it; the camera looks down -z.
 * The canvas is the container, a SIZE px square at the page origin.
 */
function setup() {
    const top = mesh('Top', 0, 0.5, 0), leg1 = mesh('Leg 1', -0.6, -0.5, 0), leg2 = mesh('Leg 2', 0.6, -0.5, 0)
    const legs = group('Legs', leg1, leg2)
    const table = group('Table', top, legs)
    table.position.x = -2
    const lamp = mesh('Lamp', 2, 0, 0)
    const wall = mesh('Wall', 2, 0, -3, 4)
    const root = group('modelRoot', table, lamp, wall)
    root.updateMatrixWorld(true)

    const camera = new PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.updateMatrixWorld(true)

    const canvas = Object.assign(new EventTarget(), {
        style: {},
        getBoundingClientRect: () => ({left: 0, top: 0, width: SIZE, height: SIZE}),
    })
    const picker = new ObjectPicker(root, canvas as any, camera as any)
    const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
    picker.undoManager = undoManager
    const picking = Object.assign(new EventDispatcher<any>(), {
        picker,
        isDisabled: () => false,
        getSelectedObjects: () => picker.selectedObjects,
    })
    picker.addEventListener('selectedObjectChanged', e => picking.dispatchEvent(e))
    picker.addEventListener('hitObject', e => picking.dispatchEvent(e)) // as PickingPlugin: the same intersects object
    const viewer = Object.assign(new EventDispatcher<any>(), {
        container: canvas,
        canvas,
        scene: {modelRoot: root, mainCamera: camera},
        getPlugin: (p: any) => p?.PluginType === 'Picking' ? picking : undefined,
    }) as any
    document.elementFromPoint = () => canvas as any

    const ux = new SelectionUxPlugin()
    ux.onAdded(viewer)
    const events: string[] = []
    ux.addEventListener('uxUpdate', e => events.push(e.reason))

    /** The screen point of an object's centre */
    const at = (o: Object3D) => {
        const p = o.getWorldPosition(new Vector3()).project(camera)
        return {clientX: (p.x + 1) / 2 * SIZE, clientY: (1 - p.y) / 2 * SIZE}
    }
    let time = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const wait = (ms: number) => time += ms
    const click = (o: Object3D | {clientX: number, clientY: number}, mods: Record<string, any> = {}) => {
        const p = (o as Object3D).isObject3D ? at(o as Object3D) : o
        canvas.dispatchEvent(ev('pointerdown', {...p, ...mods}))
        window.dispatchEvent(ev('pointerup', {...p, ...mods}))
        wait(100)
    }
    const dblclick = (o: Object3D) => canvas.dispatchEvent(ev('dblclick', at(o)))
    const key = (code: string, mods: Record<string, any> = {}) => {
        const e = ev('keydown', {code, ...mods})
        window.dispatchEvent(e)
        return e.defaultPrevented
    }
    const names = () => ux.selected.map(o => o.name)
    return {ux, viewer, picking, undoManager, canvas, events, table, legs, leg1, leg2, top, lamp, wall, at, wait, click, dblclick, key, names}
}

describe('SelectionUxPlugin', () => {
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
        vi.restoreAllMocks()
    })

    test('a click selects the group; again keeps it; a double click drills one level each time', () => {
        const {click, dblclick, leg1, names, events} = setup()
        click(leg1)
        expect(names()).toEqual(['Table'])
        expect(events).toEqual(['selection'])
        click(leg1) // the second click of a double click
        expect(names()).toEqual(['Table'])
        dblclick(leg1)
        expect(names()).toEqual(['Legs'])
        click(leg1)
        click(leg1)
        dblclick(leg1)
        expect(names()).toEqual(['Leg 1'])
    })

    test('a click on another part of the selected group selects that part', () => {
        const {ux, click, legs, top, names} = setup()
        ux.select([legs])
        click(top)
        expect(names()).toEqual(['Top'])
    })

    test('a click again on the same spot after a pause selects the object behind, then cycles', () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
        try {
            const {click, lamp, wait, names} = setup()
            click(lamp)
            expect(names()).toEqual(['Lamp'])
            wait(500)
            click(lamp)
            expect(names()).toEqual(['Lamp']) // it can still be a double click
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual(['Wall'])
            wait(500)
            click(lamp)
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual(['Lamp'])
        } finally {
            vi.useRealTimers()
        }
    })

    test('a selection change or a disabled plugin during the wait cancels the click behind', () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
        try {
            const {ux, click, key, lamp, wait, names} = setup()
            click(lamp)
            wait(500)
            click(lamp) // the click behind waits
            key('Escape') // the parent: nothing
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual([])
            click(lamp)
            wait(500)
            click(lamp)
            ux.enabled = false
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual(['Lamp'])
        } finally {
            vi.useRealTimers()
        }
    })

    test('a double click after a pause goes one level in, not to the object behind', () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
        try {
            const {click, dblclick, lamp, legs, leg1, wait, names} = setup()
            click(lamp)
            wait(500)
            click(lamp) // the first click of the double click
            click(lamp) // the second one, which cancels the click behind
            dblclick(lamp)
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual(['Lamp']) // a mesh: one level in is the lamp itself, not the wall
            click(leg1)
            wait(500)
            click(leg1)
            click(leg1)
            dblclick(leg1)
            vi.advanceTimersByTime(SelectionUxPlugin.ClickAgainDelay)
            expect(names()).toEqual([legs.name])
        } finally {
            vi.useRealTimers()
        }
    })

    test('Shift adds and removes, Ctrl selects the deepest object, empty space selects nothing', () => {
        const {click, leg1, lamp, names} = setup()
        click(leg1)
        click(lamp, {shiftKey: true})
        expect(names()).toEqual(['Lamp', 'Table'])
        click(leg1, {shiftKey: true})
        expect(names()).toEqual(['Lamp'])
        click(leg1, {ctrlKey: true})
        expect(names()).toEqual(['Leg 1'])
        click({clientX: 2, clientY: 2})
        expect(names()).toEqual([])
    })

    test('a drag past the threshold is not a click and is left to the camera controls', () => {
        const {canvas, at, leg1, names} = setup()
        const p = at(leg1)
        canvas.dispatchEvent(ev('pointerdown', p))
        window.dispatchEvent(ev('pointermove', {clientX: p.clientX + 10, clientY: p.clientY, buttons: 1}))
        window.dispatchEvent(ev('pointerup', {clientX: p.clientX + 10, clientY: p.clientY}))
        expect(names()).toEqual([])
    })

    test('a short quick drag on empty space keeps the selection (the core picker takes it as a click)', () => {
        const {canvas, click, top, names} = setup()
        click(top)
        expect(names()).toEqual(['Table'])
        const p = {clientX: 2, clientY: 2}, q = {clientX: 12, clientY: 2} // 10 px in no time: a click for the core picker
        canvas.dispatchEvent(ev('pointerdown', p))
        window.dispatchEvent(ev('pointermove', {...q, buttons: 1}))
        canvas.dispatchEvent(ev('pointerup', q))
        window.dispatchEvent(ev('pointerup', q))
        expect(names()).toEqual(['Table'])
    })

    test('a press on a widget handle (a curve point) is left to the PickingPlugin', () => {
        const {ux, click, lamp, picking, names} = setup()
        const widget = Object.assign(group('Lamp widget'), {assetType: 'widget', object: lamp})
        const handle = mesh('Handle', 2, 0, 1) // in front of the lamp
        handle.userData.isWidgetHandle = true
        widget.add(handle)
        widget.updateMatrixWorld(true)
        picking.picker.extraObjects.push(widget)
        click(handle)
        expect(names()).toEqual([]) // this plugin does not select the lamp
        const hit = {intersects: {selectedHandle: handle} as any}
        ;(ux as any)._onPickerHit(hit)
        expect(hit.intersects.consumed).toBeUndefined() // the core pick goes on, with the handle for the gizmo
    })

    test('a hit on a part that cannot be selected selects its first parent that can, as the core picker does', () => {
        const {picking, click, lamp, names} = setup()
        const g = lamp.parent as IObject3D
        const box = group('Box')
        box.userData.userSelectable = true
        g.add(box)
        g.remove(lamp)
        box.add(lamp)
        lamp.userData.userSelectable = false
        box.updateMatrixWorld(true)
        const condition = picking.picker.selectionCondition
        picking.picker.selectionCondition = (o: IObject3D) => o.userData.userSelectable === true || condition(o)
        click(lamp)
        expect(names()).toEqual(['Box'])
    })

    test('the pointer is measured on the canvas, also when the container is larger', () => {
        const {viewer, click, lamp, names} = setup()
        viewer.container = {getBoundingClientRect: () => ({left: 0, top: 0, width: SIZE * 2, height: SIZE * 2})}
        click(lamp)
        expect(names()).toEqual(['Lamp'])
    })

    test('a hidden object is not selected: the click goes to the visible one behind it', () => {
        const {click, lamp, names} = setup()
        lamp.visible = false
        click(lamp)
        expect(names()).toEqual(['Wall'])
    })

    test('keys: Esc and Shift+Enter parent, Enter children, Tab siblings, Ctrl+A the level', () => {
        const {ux, key, leg1, names} = setup()
        expect(key('Escape')).toBe(false) // nothing selected: Esc stays for others
        ux.select([leg1])
        expect(key('Tab')).toBe(true)
        expect(names()).toEqual(['Leg 2'])
        key('Tab', {shiftKey: true})
        expect(names()).toEqual(['Leg 1'])
        expect(key('Escape')).toBe(true)
        expect(names()).toEqual(['Legs'])
        key('Enter', {shiftKey: true})
        expect(names()).toEqual(['Table'])
        key('Enter')
        expect(names()).toEqual(['Top', 'Legs'])
        key('KeyA', {ctrlKey: true})
        expect(names()).toEqual(['Top', 'Legs']) // the level of Top
        key('Escape')
        key('Escape')
        expect(names()).toEqual([])
        key('KeyA', {metaKey: true})
        expect(names()).toEqual(['Table', 'Lamp', 'Wall'])
    })

    test('each selection change is one undo step', () => {
        const {click, dblclick, key, leg1, lamp, undoManager, names} = setup()
        click(leg1)
        click(leg1)
        dblclick(leg1)
        click(lamp, {shiftKey: true})
        key('Escape') // Lamp is the primary: its parent is the top level
        expect(names()).toEqual([])
        expect(undoManager.stack).toHaveLength(4)
        undoManager.undo()
        expect(names()).toEqual(['Lamp', 'Legs'])
        undoManager.undo()
        expect(names()).toEqual(['Legs'])
        undoManager.undo()
        expect(names()).toEqual(['Table'])
        undoManager.redo()
        undoManager.redo()
        expect(names()).toEqual(['Lamp', 'Legs'])
    })

    test('hover: the target of a click; inside the selected group, the part a double click selects', () => {
        const {ux, viewer, canvas, at, leg1, table, events} = setup()
        const move = () => {
            canvas.dispatchEvent(ev('pointermove'))
            window.dispatchEvent(ev('pointermove', at(leg1)))
            viewer.dispatchEvent({type: 'preFrame'})
        }
        move()
        expect(ux.hovered?.name).toBe('Table')
        expect(events).toEqual(['hover'])
        ux.select([table])
        move()
        expect(ux.hovered?.name).toBe('Legs')
        canvas.dispatchEvent(ev('pointerleave'))
        viewer.dispatchEvent({type: 'preFrame'})
        expect(ux.hovered).toBe(null)
    })

    test('takes the clicks of the PickingPlugin while enabled', () => {
        const {ux, picking} = setup()
        const hit = {intersects: {} as any}
        picking.dispatchEvent({type: 'hitObject', ...hit})
        expect(hit.intersects.consumed).toBe(true)
        ux.enabled = false
        const hit2 = {intersects: {} as any}
        picking.dispatchEvent({type: 'hitObject', ...hit2})
        expect(hit2.intersects.consumed).toBeUndefined()
    })

    test('onRemove removes the listeners', () => {
        const {ux, viewer, picking, click, key, leg1, lamp} = setup()
        ux.select([lamp])
        ux.onRemove(viewer)
        click(leg1)
        key('Escape')
        expect(picking.getSelectedObjects()).toEqual([lamp])
    })
})

// endregion
