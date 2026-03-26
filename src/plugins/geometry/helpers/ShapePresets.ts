import {Shape} from 'three'

/**
 * Create a 2D Shape from preset type and scalar parameters.
 * Used by ShapeGeometryGenerator and TubeShapeGeometryGenerator.
 * Shapes are created with CCW winding (standard for three.js ShapeGeometry).
 */
export function createShapeFromPreset(shapeType: string, params: {
    width?: number, height?: number,
    circleRadius?: number, circleSegments?: number,
    sides?: number, polygonRadius?: number,
}): Shape {
    const shape = new Shape()

    switch (shapeType) {
    case 'rectangle': {
        const w = (params.width ?? 1) / 2
        const h = (params.height ?? 1) / 2
        shape.moveTo(-w, -h)
        shape.lineTo(w, -h)
        shape.lineTo(w, h)
        shape.lineTo(-w, h)
        shape.closePath()
        return shape
    }
    case 'circle': {
        const r = params.circleRadius ?? 1
        const segments = params.circleSegments ?? 32
        for (let i = 0; i < segments; i++) {
            const theta = (i / segments) * Math.PI * 2
            const x = r * Math.cos(theta)
            const y = r * Math.sin(theta)
            if (i === 0) shape.moveTo(x, y)
            else shape.lineTo(x, y)
        }
        shape.closePath()
        return shape
    }
    case 'polygon': {
        const sides = Math.max(3, params.sides ?? 6)
        const pr = params.polygonRadius ?? 1
        for (let i = 0; i < sides; i++) {
            const theta = (i / sides) * Math.PI * 2 - Math.PI / 2
            const x = pr * Math.cos(theta)
            const y = pr * Math.sin(theta)
            if (i === 0) shape.moveTo(x, y)
            else shape.lineTo(x, y)
        }
        shape.closePath()
        return shape
    }
    default:
        throw new Error('Unknown shape preset type: ' + shapeType)
    }
}

/**
 * Reverse the winding order of a shape's points.
 * TubeShapeGeometry expects CW winding for outward-facing normals,
 * while ShapeGeometry expects CCW. Use this when passing a preset shape to TubeShapeGeometry.
 */
export function reverseShapeWinding(shape: Shape): Shape {
    const points = shape.getPoints()
    points.reverse()
    return new Shape(points)
}
