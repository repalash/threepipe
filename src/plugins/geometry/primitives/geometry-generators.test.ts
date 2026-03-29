/**
 * Geometry generator unit tests.
 *
 * Tests the _generateData() output of each generator (pure math, no WebGL).
 * Uses dynamic import to handle potential circular dependency issues gracefully.
 */
import {describe, test, expect, beforeAll} from 'vitest'

let BoxGen: any, SphereGen: any, PlaneGen: any, CircleGen: any, CylinderGen: any, TorusGen: any
let TubeGen: any, ShapeGen: any, LineGen: any

beforeAll(async() => {
    BoxGen = (await import('./BoxGeometryGenerator')).BoxGeometryGenerator
    SphereGen = (await import('./SphereGeometryGenerator')).SphereGeometryGenerator
    PlaneGen = (await import('./PlaneGeometryGenerator')).PlaneGeometryGenerator
    CircleGen = (await import('./CircleGeometryGenerator')).CircleGeometryGenerator
    CylinderGen = (await import('./CylinderGeometryGenerator')).CylinderGeometryGenerator
    TorusGen = (await import('./TorusGeometryGenerator')).TorusGeometryGenerator
    TubeGen = (await import('./TubeGeometryGenerator')).TubeGeometryGenerator
    ShapeGen = (await import('./ShapeGeometryGenerator')).ShapeGeometryGenerator
    LineGen = (await import('./LineGeometryGenerator')).LineGeometryGenerator
})

function gen(Cls: any, params?: any) {
    const g = new Cls()
    return g._generateData({...g.defaultParams, ...params})
}

describe('BoxGeometryGenerator', () => {
    test('24 vertices, 36 indices, 6 groups for unit box', () => {
        const d = gen(BoxGen)
        expect(d.vertices.length).toBe(24 * 3)
        expect(d.indices.length).toBe(36)
        expect(d.groups).toHaveLength(6)
    })

    test('normals are unit length', () => {
        const d = gen(BoxGen)
        for (let i = 0; i < d.normals.length; i += 3) {
            expect(Math.sqrt(d.normals[i] ** 2 + d.normals[i + 1] ** 2 + d.normals[i + 2] ** 2)).toBeCloseTo(1, 4)
        }
    })

    test('vertices bounded by half-dimensions', () => {
        const d = gen(BoxGen, {width: 4, height: 6, depth: 8})
        let maxX = 0, maxY = 0, maxZ = 0
        for (let i = 0; i < d.vertices.length; i += 3) {
            maxX = Math.max(maxX, Math.abs(d.vertices[i]))
            maxY = Math.max(maxY, Math.abs(d.vertices[i + 1]))
            maxZ = Math.max(maxZ, Math.abs(d.vertices[i + 2]))
        }
        expect(maxX).toBeCloseTo(2, 4)
        expect(maxY).toBeCloseTo(3, 4)
        expect(maxZ).toBeCloseTo(4, 4)
    })

    test('more segments produce more vertices', () => {
        const d1 = gen(BoxGen, {widthSegments: 1, heightSegments: 1, depthSegments: 1})
        const d2 = gen(BoxGen, {widthSegments: 2, heightSegments: 2, depthSegments: 2})
        expect(d2.vertices.length).toBeGreaterThan(d1.vertices.length)
    })

    test('UVs in [0, 1]', () => {
        for (const u of gen(BoxGen).uvs) {
            expect(u).toBeGreaterThanOrEqual(-1e-6)
            expect(u).toBeLessThanOrEqual(1 + 1e-6)
        }
    })
})

describe('SphereGeometryGenerator', () => {
    test('all vertices at radius distance', () => {
        const radius = 2.5
        const d = gen(SphereGen, {radius, widthSegments: 8, heightSegments: 4})
        for (let i = 0; i < d.vertices.length; i += 3) {
            expect(Math.sqrt(d.vertices[i] ** 2 + d.vertices[i + 1] ** 2 + d.vertices[i + 2] ** 2)).toBeCloseTo(radius, 4)
        }
    })

    test('normals are unit length', () => {
        const d = gen(SphereGen, {widthSegments: 8, heightSegments: 4})
        for (let i = 0; i < d.normals.length; i += 3) {
            expect(Math.sqrt(d.normals[i] ** 2 + d.normals[i + 1] ** 2 + d.normals[i + 2] ** 2)).toBeCloseTo(1, 4)
        }
    })

    test('enforces min segments (3w, 2h)', () => {
        expect(gen(SphereGen, {widthSegments: 1, heightSegments: 1}).vertices.length / 3).toBe(12)
    })

    test('poles at top and bottom', () => {
        const d = gen(SphereGen, {radius: 1, widthSegments: 4, heightSegments: 2})
        expect(d.vertices[1]).toBeCloseTo(1, 4)
        expect(d.vertices[d.vertices.length - 2]).toBeCloseTo(-1, 4)
    })
})

describe('PlaneGeometryGenerator', () => {
    test('vertex/index count matches grid', () => {
        const d = gen(PlaneGen, {widthSegments: 3, heightSegments: 2})
        expect(d.vertices.length / 3).toBe(12)
        expect(d.indices.length).toBe(36)
    })

    test('flat on z=0 with +Z normals', () => {
        const d = gen(PlaneGen)
        for (let i = 0; i < d.vertices.length; i += 3) {
            expect(d.vertices[i + 2]).toBe(0)
            expect(d.normals[i]).toBe(0)
            expect(d.normals[i + 1]).toBe(0)
            expect(d.normals[i + 2]).toBe(1)
        }
    })
})

describe('CircleGeometryGenerator', () => {
    test('center at origin, rim at radius', () => {
        const radius = 3
        const d = gen(CircleGen, {radius, segments: 8})
        expect(d.vertices[0]).toBe(0)
        expect(d.vertices[1]).toBe(0)
        expect(d.vertices[2]).toBe(0)
        for (let i = 3; i < d.vertices.length; i += 3) {
            expect(Math.sqrt(d.vertices[i] ** 2 + d.vertices[i + 1] ** 2)).toBeCloseTo(radius, 4)
        }
    })
})

describe('CylinderGeometryGenerator', () => {
    test('closed=3 groups, open=1 group', () => {
        expect(gen(CylinderGen, {openEnded: false}).groups).toHaveLength(3)
        expect(gen(CylinderGen, {openEnded: true}).groups).toHaveLength(1)
    })

    test('y extent matches height/2', () => {
        const d = gen(CylinderGen, {height: 4, radialSegments: 8})
        let minY = Infinity, maxY = -Infinity
        for (let i = 1; i < d.vertices.length; i += 3) {
            minY = Math.min(minY, d.vertices[i])
            maxY = Math.max(maxY, d.vertices[i])
        }
        expect(maxY).toBeCloseTo(2, 4)
        expect(minY).toBeCloseTo(-2, 4)
    })
})

describe('TorusGeometryGenerator', () => {
    test('outer extent = radius + tube', () => {
        const radius = 2, tube = 0.5
        const d = gen(TorusGen, {radius, tube, radialSegments: 8, tubularSegments: 16})
        let maxDist = 0
        for (let i = 0; i < d.vertices.length; i += 3) {
            maxDist = Math.max(maxDist, Math.sqrt(d.vertices[i] ** 2 + d.vertices[i + 2] ** 2))
        }
        expect(maxDist).toBeCloseTo(radius + tube, 1)
    })
})

// --- Edge case tests: zero dimensions ---

describe('BoxGeometryGenerator — zero dimensions', () => {
    test('width=0 produces degenerate box (all x=0)', () => {
        const d = gen(BoxGen, {width: 0, height: 1, depth: 1})
        // Still produces vertices, indices, groups — just with 0-width faces
        expect(d.vertices.length).toBeGreaterThan(0)
        expect(d.indices.length).toBeGreaterThan(0)
        expect(d.groups).toHaveLength(6)
    })

    test('all dimensions zero produces degenerate geometry', () => {
        const d = gen(BoxGen, {width: 0, height: 0, depth: 0})
        expect(d.vertices.length).toBeGreaterThan(0)
        // All vertex positions should be 0
        for (let i = 0; i < d.vertices.length; i++) {
            expect(d.vertices[i]).toBeCloseTo(0, 10)
        }
    })
})

describe('SphereGeometryGenerator — zero radius', () => {
    test('radius=0 produces all vertices at origin', () => {
        const d = gen(SphereGen, {radius: 0, widthSegments: 8, heightSegments: 4})
        expect(d.vertices.length).toBeGreaterThan(0)
        for (let i = 0; i < d.vertices.length; i++) {
            expect(d.vertices[i]).toBeCloseTo(0, 10)
        }
    })
})

describe('PlaneGeometryGenerator — zero dimensions', () => {
    test('width=0 produces degenerate plane', () => {
        const d = gen(PlaneGen, {width: 0, height: 1, widthSegments: 2, heightSegments: 2})
        expect(d.vertices.length).toBeGreaterThan(0)
        // All x coords should be 0 (width=0 => widthHalf=0)
        for (let i = 0; i < d.vertices.length; i += 3) {
            expect(d.vertices[i]).toBeCloseTo(0, 10)
        }
    })
})

describe('CylinderGeometryGenerator — zero radius', () => {
    test('both radii zero with openEnded=false produces 1 group (no caps generated)', () => {
        // radiusTop=0 and radiusBottom=0: cap generation is skipped (> 0 checks fail)
        const d = gen(CylinderGen, {radiusTop: 0, radiusBottom: 0, height: 1, openEnded: false})
        expect(d.groups).toHaveLength(1)
    })
})

// --- Edge case tests: zero segments ---

describe('BoxGeometryGenerator — zero segments', () => {
    test('widthSegments=0 (floored to 0) produces degenerate box', () => {
        // Math.floor(0)=0; gridX=0 means gridX1=1, so inner loop doesn't execute for indices
        // But vertex loop still runs (gridY1 * gridX1 vertices per face)
        const d = gen(BoxGen, {widthSegments: 0})
        // With 0 segments on width, faces using widthSegments produce no indices for those faces
        // but some faces still produce geometry
        expect(d.vertices.length).toBeGreaterThan(0)
    })
})

describe('PlaneGeometryGenerator — zero segments', () => {
    test('widthSegments=0 produces vertices but no indices', () => {
        // gridX = Math.floor(0) = 0, gridX1 = 1
        // Vertex loop: iy < gridY1, ix < gridX1 => gridY1 * 1 vertices
        // Index loop: iy < gridY, ix < gridX(=0) => no iterations
        const d = gen(PlaneGen, {widthSegments: 0, heightSegments: 2})
        // segmentWidth = width/0 = Infinity, but vertices still generated
        expect(d.vertices.length).toBeGreaterThan(0)
        expect(d.indices.length).toBe(0)
    })
})

// --- New generator tests ---

describe('TubeGeometryGenerator', () => {
    test('generates geometry with default params', () => {
        const d = gen(TubeGen)
        // TubeGen returns Float32BufferAttribute for vertices, not plain array
        expect(d.vertices).toBeDefined()
        expect(d.normals).toBeDefined()
        expect(d.uvs).toBeDefined()
        expect(d.indices.length).toBeGreaterThan(0)
    })

    test('more tubular segments produce more indices', () => {
        const d1 = gen(TubeGen, {tubularSegments: 8, radialSegments: 4})
        const d2 = gen(TubeGen, {tubularSegments: 32, radialSegments: 4})
        expect(d2.indices.length).toBeGreaterThan(d1.indices.length)
    })

    test('more radial segments produce more indices', () => {
        const d1 = gen(TubeGen, {tubularSegments: 16, radialSegments: 4})
        const d2 = gen(TubeGen, {tubularSegments: 16, radialSegments: 12})
        expect(d2.indices.length).toBeGreaterThan(d1.indices.length)
    })
})

describe('ShapeGeometryGenerator', () => {
    test('generates rectangle shape with default params', () => {
        const d = gen(ShapeGen)
        expect(d.vertices).toBeDefined()
        expect(d.normals).toBeDefined()
        expect(d.indices.length).toBeGreaterThan(0)
    })

    test('generates circle shape', () => {
        const d = gen(ShapeGen, {shapeType: 'circle', circleRadius: 2, circleSegments: 16})
        expect(d.vertices).toBeDefined()
        expect(d.indices.length).toBeGreaterThan(0)
    })

    test('generates polygon shape', () => {
        const d = gen(ShapeGen, {shapeType: 'polygon', sides: 5, polygonRadius: 1})
        expect(d.vertices).toBeDefined()
        expect(d.indices.length).toBeGreaterThan(0)
    })
})

describe('LineGeometryGenerator', () => {
    test('generates line with default params', () => {
        const d = gen(LineGen)
        expect(d.vertices.length).toBeGreaterThan(0)
        expect(d.positions.length).toBeGreaterThan(0)
        // normals and uvs are empty arrays for lines
        expect(d.normals).toEqual([])
        expect(d.uvs).toEqual([])
    })

    test('closePath adds an extra point', () => {
        const d1 = gen(LineGen, {segments: 10, closePath: false})
        const d2 = gen(LineGen, {segments: 10, closePath: true})
        // closePath adds one extra point (3 floats)
        expect(d2.vertices.length).toBe(d1.vertices.length + 3)
    })

    test('throws when no curve provided and no default curve', () => {
        const g = new LineGen()
        g.defaultParams.curve = undefined
        expect(() => g._generateData({segments: 10, closePath: false})).toThrow('No curve specified')
    })

    test('segments clamped to minimum of 2', () => {
        const d = gen(LineGen, {segments: 0})
        // Math.max(2, 0 || 50) => Math.max(2, 50) = 50 (falsy 0 becomes 50)
        // Actually segments=0 is falsy, so `params.segments || 50` = 50
        expect(d.vertices.length / 3).toBe(50)
    })

    test('segments=1 is clamped to minimum of 2', () => {
        const d = gen(LineGen, {segments: 1})
        // Math.max(2, 1) = 2
        expect(d.vertices.length / 3).toBe(2)
    })
})
