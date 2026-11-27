/**
 * The dispose event of threepipe objects with three.js r186, whose Object3D.dispose() dispatches it: an object's
 * dispose(), through threepipe's iObjectCommons.dispose, dispatches it once, whether the object's own dispose() calls
 * super.dispose() (three.js classes and threepipe's) or not (a class written for an older three.js).
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

function countDispose(o: {addEventListener: (type: 'dispose', fn: () => void) => void}) {
    const counter = {n: 0}
    o.addEventListener('dispose', () => counter.n++)
    return counter
}

describe('dispose event', () => {
    test('dispatched once by threepipe objects, and the object is removed from its parent', () => {
        const parent = new tp.Group2()
        const objects = [
            new tp.Mesh2(), new tp.Group2(), new tp.Object3D2(), new tp.InstancedMesh2(undefined, undefined, 2),
            new tp.PerspectiveCamera2(), new tp.OrthographicCamera2(), new tp.PointLight2(), new tp.DirectionalLight2(),
            new tp.AmbientLight2(),
        ]
        for (const o of objects) {
            parent.add(o)
            const c = countDispose(o as any)
            o.dispose()
            expect(c.n, o.type).toBe(1)
            expect(o.parent, o.type).toBe(null)
        }
    })

    test('dispatched once by an upgraded three.js object and by a class whose dispose() does not call super', () => {
        class LegacyMesh extends tp.Mesh {
            disposed = 0
            dispose() {
                this.disposed++
            }
        }
        for (const o of [new tp.Mesh(), new tp.Group(), new LegacyMesh()]) {
            tp.iObjectCommons.upgradeObject3D.call(o as any)
            const c = countDispose(o)
            ;(o as any).dispose()
            expect(c.n, o.constructor.name).toBe(1)
            if (o instanceof LegacyMesh) expect(o.disposed).toBe(1)
        }
    })

    test('dispatched by threepipe\'s controls and widget icons, which are not upgraded objects', () => {
        // only what the controls use of the canvas
        const domElement: any = {style: {}, addEventListener: () => {}, removeEventListener: () => {}}
        const camera = new tp.PerspectiveCamera2()
        // ViewHelper2 makes a WebGLRenderer, which Node does not have
        for (const o of [new tp.TransformControls(camera, domElement), new tp.PivotControls(camera, domElement), new tp.WidgetIcon('pointLight')]) {
            const c = countDispose(o as any)
            o.dispose()
            expect(c.n, o.constructor.name).toBe(1)
        }
    })

    test('children are disposed once each and stay in the hierarchy', () => {
        const root = new tp.Group2()
        const child = new tp.Mesh2()
        const grandChild = new tp.Mesh2()
        root.add(child)
        child.add(grandChild)
        const c1 = countDispose(child)
        const c2 = countDispose(grandChild)
        root.dispose()
        expect(c1.n).toBe(1)
        expect(c2.n).toBe(1)
        expect(child.parent).toBe(root)
        expect(grandChild.parent).toBe(child)
    })
})
