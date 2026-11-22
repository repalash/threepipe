/**
 * The archWall generator of GeometryGeneratorPlugin: a wall with round-arched openings, extruded from a Shape.
 */
import {beforeAll, describe, expect, test} from 'vitest'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

function generate(params: Partial<import('threepipe').ArchWallGeometryGeneratorParams> = {}) {
    return new tp.ArchWallGeometryGenerator().generate(undefined, params)
}

describe('ArchWallGeometryGenerator', () => {
    test('stands on y = 0, centered in x and z, with the given size', () => {
        const g = generate({width: 8, height: 4, thickness: 0.5})
        const box = g.boundingBox!
        expect(box.min.x).toBeCloseTo(-4)
        expect(box.max.x).toBeCloseTo(4)
        expect(box.min.y).toBeCloseTo(0)
        expect(box.max.y).toBeCloseTo(4)
        expect(box.min.z).toBeCloseTo(-0.25)
        expect(box.max.z).toBeCloseTo(0.25)
        expect(g.userData.generationParams.type).toBe('archWall')
    })

    test('has unit normals, uvs and the two ExtrudeGeometry groups covering every vertex', () => {
        const g = generate()
        const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv')
        expect(nor.count).toBe(pos.count)
        expect(uv.count).toBe(pos.count)
        for (let i = 0; i < nor.count; i++) {
            expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5)
        }
        expect(g.groups.map(gr => gr.materialIndex)).toEqual([0, 1])
        expect(g.groups[0].count + g.groups[1].count).toBe(pos.count)
    })

    test('cuts the openings: no triangle of the front face covers the middle of an opening', () => {
        // one opening of 2 x 2 in the middle of a 4 x 3 wall: the point (0, 1) is inside it
        const g = generate({width: 4, height: 3, archCount: 1, archWidth: 2, archHeight: 2})
        const pos = g.getAttribute('position')
        const covers = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number) => {
            const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
            const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
            const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
            return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
        }
        const front = g.groups[0]
        let hits = 0
        for (let i = front.start; i < front.start + front.count; i += 3) {
            if (covers(pos.getX(i), pos.getY(i), pos.getX(i + 1), pos.getY(i + 1), pos.getX(i + 2), pos.getY(i + 2), 0, 1)) hits++
        }
        expect(hits).toBe(0)
    })

    test('the arch top reaches the arch height, and the soffit normals are smooth (not faceted)', () => {
        const g = generate({width: 4, height: 3, archCount: 1, archWidth: 2, archHeight: 2, archSegments: 16})
        const pos = g.getAttribute('position'), nor = g.getAttribute('normal')
        // the crown of the arch is at (0, 2): the soffit vertices there (not the front and back faces, whose normals are
        // along z) have a normal pointing straight down, the average of the two segments that meet at the crown
        let found = false
        for (let i = 0; i < pos.count; i++) {
            if (Math.abs(pos.getX(i)) < 1e-6 && Math.abs(pos.getY(i) - 2) < 1e-6 && Math.abs(nor.getZ(i)) < 0.5) {
                expect(nor.getY(i)).toBeCloseTo(-1, 3)
                found = true
            }
        }
        expect(found).toBe(true)
    })

    test('every soffit vertex of a long wall gets the exact curve normal (float32 positions far from the origin)', () => {
        // arches up to 60 m from the origin: float32 rounds their positions by a few 1e-6
        const params = {...new tp.ArchWallGeometryGenerator().defaultParams, width: 120, height: 5, archCount: 40, archWidth: 1.6, archHeight: 4, archSegments: 24}
        const g = generate(params)
        const {left, rx, ry, spring} = tp.ArchWallGeometryGenerator.Layout(params)
        const pos = g.getAttribute('position'), nor = g.getAttribute('normal')
        let soffit = 0
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i)
            if (Math.abs(nor.getZ(i)) > 0.5 || y <= spring + 1e-3 || y > 4 + 1e-3) continue
            const l = left.find(v => x > v - 1e-3 && x < v + 2 * rx + 1e-3)
            if (l === undefined) continue
            const dx = (x - (l + rx)) / rx, dy = (y - spring) / ry
            const n = [-dx / rx, -dy / ry], len = Math.hypot(n[0], n[1])
            expect(nor.getX(i)).toBeCloseTo(n[0] / len, 3)
            expect(nor.getY(i)).toBeCloseTo(n[1] / len, 3)
            soffit++
        }
        expect(soffit).toBeGreaterThan(40 * 24)
    })

    test('clamps an opening wider than its share of the wall and an arch higher than the wall', () => {
        const g = generate({width: 3, height: 2, archCount: 3, archWidth: 5, archHeight: 9})
        const box = g.boundingBox!
        expect(box.max.y).toBeCloseTo(2)
        expect(box.min.x).toBeCloseTo(-1.5)
        expect(box.max.x).toBeCloseTo(1.5)
        expect(g.getAttribute('position').count).toBeGreaterThan(0)
    })

    test('no openings gives a plain slab (a box: 12 triangles)', () => {
        const g = generate({archCount: 0})
        expect(g.getAttribute('position').count).toBe(36)
    })

    test('regenerates with new parameters through the plugin', () => {
        const plugin = new tp.GeometryGeneratorPlugin()
        const obj = plugin.generateObject('archWall', {archCount: 2})
        const before = obj.geometry.getAttribute('position').count
        obj.geometry.userData.generationParams.archCount = 5
        plugin.updateGeometry(obj.geometry)
        expect(obj.geometry.getAttribute('position').count).toBeGreaterThan(before)
        expect(obj.geometry.userData.generationParams.archCount).toBe(5)
    })
})
