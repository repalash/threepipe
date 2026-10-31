/**
 * The selection condition of the PickingPlugin (`isPickable`): `userData.userSelectable === false`,
 * `userData.bboxVisible === false` and `visible = false` on the hit object or on any of its parents keep it out of the
 * selection; a widget's handle selects as its widget does.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {Mesh, MeshBasicMaterial, Object3D} from 'three'

// Deferred import: threepipe core has circular static-init dependencies that only resolve once the graph is loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/** A scene root, a model root in it and a group in that (all `assetType` model, as the viewer upgrades them) */
function tree() {
    const scene = new Object3D() as any
    scene.assetType = 'model'
    const modelRoot = new Object3D() as any
    scene.add(modelRoot)
    const group = new Object3D() as any
    group.assetType = 'model'
    modelRoot.add(group)
    return {scene, modelRoot, group}
}

function mesh(parent: Object3D) {
    const m = new Mesh(undefined, new MeshBasicMaterial()) as any
    m.assetType = 'model'
    parent.add(m)
    return m
}

describe('PickingPlugin isPickable', () => {
    test('a mesh with a material in a model is pickable', () => {
        const {group} = tree()
        expect(tp.isPickable(mesh(group))).toBe(true)
    })

    test('userSelectable false on the mesh itself keeps it out', () => {
        const {group} = tree()
        const m = mesh(group)
        m.userData.userSelectable = false
        expect(tp.isPickable(m)).toBe(false)
    })

    test('userSelectable false on a parent keeps the meshes inside it out', () => {
        const {group} = tree()
        const m = mesh(group)
        group.userData.userSelectable = false
        expect(tp.isPickable(m)).toBe(false)
    })

    test('bboxVisible false or a hidden parent keeps it out', () => {
        const a = tree(), b = tree()
        const m1 = mesh(a.group), m2 = mesh(b.group)
        m1.userData.bboxVisible = false
        b.group.visible = false
        expect(tp.isPickable(m1)).toBe(false)
        expect(tp.isPickable(m2)).toBe(false)
    })

    test('a group without a material is pickable only with userSelectable true (a text wrapper)', () => {
        const {group} = tree()
        expect(tp.isPickable(group)).toBe(false)
        group.userData.userSelectable = true
        expect(tp.isPickable(group)).toBe(true)
    })

    test('a handle of a widget follows its widget', () => {
        const {scene} = tree()
        const widget = new Object3D() as any
        widget.assetType = 'widget'
        scene.add(widget)
        const handle = mesh(widget)
        handle.assetType = undefined
        expect(tp.isPickable(handle)).toBe(true)
        widget.userData.bboxVisible = false // as the transform and pivot controls set it
        expect(tp.isPickable(handle)).toBe(false)
    })
})
