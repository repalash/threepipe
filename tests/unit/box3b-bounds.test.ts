/**
 * Unit tests for the bounds of skinned and instanced meshes in Box3B.expandByObject (Node), as used by autoCenter,
 * autoScale (precise) and fitToView.
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {Bone, BoxGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/** A unit box skinned to one bone that is moved by (5, 0, 0) after binding. */
function movedSkinnedBox() {
    const geometry = new BoxGeometry(1, 1, 1)
    const count = geometry.attributes.position.count
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4))
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
    const bone = new Bone()
    mesh.add(bone)
    mesh.bind(new Skeleton([bone]))
    bone.position.set(5, 0, 0)
    return mesh
}

describe('Box3B.expandByObject', () => {
    it('measures a skinned mesh in its pose before any render (precise)', () => {
        const box = new tp.Box3B().expandByObject(movedSkinnedBox(), true)
        expect(box.min.toArray()).toEqual([4.5, -0.5, -0.5])
        expect(box.max.toArray()).toEqual([5.5, 0.5, 0.5])
    })

    it('measures a skinned mesh in its pose before any render (bounding box)', () => {
        const box = new tp.Box3B().expandByObject(movedSkinnedBox(), false)
        expect(box.min.toArray()).toEqual([4.5, -0.5, -0.5])
        expect(box.max.toArray()).toEqual([5.5, 0.5, 0.5])
    })

    it('measures every instance of an instanced mesh, also when precise', () => {
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2)
        mesh.setMatrixAt(0, new Matrix4().makeTranslation(-10, 0, 0))
        mesh.setMatrixAt(1, new Matrix4().makeTranslation(10, 0, 0))
        for (const precise of [false, true]) {
            const box = new tp.Box3B().expandByObject(mesh, precise)
            expect(box.min.x).toBe(-10.5)
            expect(box.max.x).toBe(10.5)
        }
    })
})
