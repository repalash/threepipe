import {describe, expect, test} from 'vitest'
import {BufferGeometry, Float32BufferAttribute, Group, Line, Object3D, Vector3} from 'three'
import {basicObjectConstraints} from './BasicObjectConstraints'

// a straight path from (0, 0, 0) to (10, 0, 0)
function path() {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 10, 0, 0], 3))
    const line = new Line(g)
    line.updateMatrixWorld()
    return line
}

describe('follow_path constraint', () => {
    test('puts the object on the path', () => {
        const obj = new Object3D()
        basicObjectConstraints.follow_path.update(obj as any, path() as any, {offset: 0.5}, 1)
        expect(obj.position.toArray()).toEqual([5, 0, 0])
    })

    test('puts an object inside a moved group on the path too', () => {
        const parent = new Group()
        parent.position.set(5, 0, 2)
        const obj = new Object3D()
        parent.add(obj)
        parent.updateMatrixWorld()
        basicObjectConstraints.follow_path.update(obj as any, path() as any, {offset: 0.5}, 1)
        obj.updateMatrixWorld()
        const world = obj.getWorldPosition(new Vector3())
        expect(world.x).toBeCloseTo(5)
        expect(world.y).toBeCloseTo(0)
        expect(world.z).toBeCloseTo(0)
    })
})
