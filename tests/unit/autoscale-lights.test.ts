import {beforeAll, describe, expect, it} from 'vitest'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

// A model 20 units across (radius 10) with its own lights, scaled to radius 1 by autoScale
function makeModel() {
    const root = new tp.Object3D2()
    const mesh = new tp.Mesh2(new tp.BoxGeometry(20 / Math.sqrt(3), 20 / Math.sqrt(3), 20 / Math.sqrt(3)), new tp.PhysicalMaterial())
    const point = new tp.PointLight2(0xffffff, 1000, 50, 2)
    point.position.set(5, 0, 0)
    const spot = new tp.SpotLight2(0xffffff, 400, 0, Math.PI / 4, 0, 2)
    const constant = new tp.PointLight2(0xffffff, 3, 0, 0) // decay 0: doesn't fade with distance
    const area = new tp.RectAreaLight2(0xffffff, 5, 4, 2)
    const sun = new tp.DirectionalLight2(0xffffff, 2)
    root.add(mesh, point, spot, constant, area, sun)
    return {root, point, spot, constant, area, sun}
}

describe('autoScale keeps the lighting of the model', () => {
    it('scales point and spot intensity by scale^decay, the cutoff distance and the area light size', () => {
        const {root, point, spot, constant, area, sun} = makeModel()
        root.autoScale!(1)
        const s = root.scale.x
        expect(s).toBeCloseTo(0.1, 5)
        expect(point.intensity).toBeCloseTo(1000 * s * s, 6)
        expect(point.distance).toBeCloseTo(50 * s, 6)
        expect(spot.intensity).toBeCloseTo(400 * s * s, 6)
        expect(spot.distance).toBe(0) // 0 means no cutoff, stays 0
        expect(constant.intensity).toBe(3)
        expect(area.width).toBeCloseTo(4 * s, 6)
        expect(area.height).toBeCloseTo(2 * s, 6)
        expect(area.intensity).toBe(5) // luminance: the same at any size
        expect(sun.intensity).toBe(2)
        expect(point.shadow.camera.near).toBeCloseTo(0.5 * s, 6)
    })

    it('undo restores the lights', () => {
        const {root, point, area} = makeModel()
        root.autoScale!(1)
        root.autoScale!(1, undefined, true, true)
        expect(root.scale.x).toBeCloseTo(1, 6)
        expect(point.intensity).toBeCloseTo(1000, 6)
        expect(point.distance).toBeCloseTo(50, 6)
        expect(area.width).toBeCloseTo(4, 6)
    })
})
