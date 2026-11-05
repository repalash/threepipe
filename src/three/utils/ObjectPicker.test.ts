import {describe, expect, it, vi} from 'vitest'
import {BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene} from 'three'
import {ObjectPicker} from './ObjectPicker'

/** Just enough of an element for the picker's listeners and cursor styles. */
function fakeElement(): any {
    return {
        addEventListener() {/* not driven here */},
        removeEventListener() {/* not driven here */},
        style: {},
        getBoundingClientRect: () => ({x: 0, y: 0, left: 0, top: 0, width: 100, height: 100}),
    }
}

function setup(count: number) {
    const scene = new Scene()
    const meshes: Mesh[] = []
    for (let i = 0; i < count; i++) {
        // Stacked along the view axis, so all are under the centre of the screen.
        const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
        m.position.z = -i * 3
        m.name = 'box' + i
        scene.add(m)
        meshes.push(m)
    }
    scene.updateMatrixWorld(true)
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const picker = new ObjectPicker(scene as any, fakeElement(), camera as any)
    picker.mouse.set(0, 0)
    return {picker, meshes}
}

describe('ObjectPicker click cycling', () => {
    it('by default, clicking the only selected object again clears the selection', () => {
        const {picker, meshes} = setup(1)
        picker.setSelected(meshes[0] as any)
        expect(picker.checkIntersection()).toBeNull()
    })

    it('with cycleWrap, clicking the only selected object keeps it', () => {
        const {picker, meshes} = setup(1)
        picker.cycleWrap = true
        picker.setSelected(meshes[0] as any)
        expect(picker.checkIntersection()?.selectedObject).toBe(meshes[0])
    })

    it('with cycleWrap, repeated clicks go front to back and round again', () => {
        const {picker, meshes} = setup(2)
        picker.cycleWrap = true
        picker.setSelected(meshes[0] as any)
        expect(picker.checkIntersection()?.selectedObject).toBe(meshes[1])
        picker.setSelected(meshes[1] as any)
        expect(picker.checkIntersection()?.selectedObject).toBe(meshes[0])
    })

    it('with cycleThroughHits off, a click always picks the front object', () => {
        const {picker, meshes} = setup(2)
        picker.cycleThroughHits = false
        picker.setSelected(meshes[0] as any)
        expect(picker.checkIntersection()?.selectedObject).toBe(meshes[0])
        picker.setSelected(meshes[1] as any)
        expect(picker.checkIntersection()?.selectedObject).toBe(meshes[0])
    })
})

describe('ObjectPicker.setSelected', () => {
    it('re-selecting the selected object from a click is not a change (no event, no undo step)', () => {
        const {picker, meshes} = setup(1)
        picker.cycleWrap = true
        const record = vi.fn()
        picker.undoManager = {record} as any
        picker.setSelected(meshes[0] as any, false) // selected from code: no stored hit
        const changed = vi.fn()
        picker.addEventListener('selectedObjectChanged', changed)
        const hit = picker.checkIntersection()!
        expect(hit.selectedObject).toBe(meshes[0])
        picker.setSelected(hit.selectedObject, true, hit)
        expect(changed).not.toHaveBeenCalled()
        expect(record).not.toHaveBeenCalled()
        expect(picker.selectedObject).toBe(meshes[0])
    })

    it('a different object is still a change with an undo step', () => {
        const {picker, meshes} = setup(2)
        const record = vi.fn()
        picker.undoManager = {record} as any
        picker.setSelected(meshes[0] as any)
        picker.setSelected(meshes[1] as any)
        expect(record).toHaveBeenCalledTimes(2)
    })
})
