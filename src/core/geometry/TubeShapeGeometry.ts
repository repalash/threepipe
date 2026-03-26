/**
 * TODO: Rewrite properly for threepipe with:
 * - Proper IGeometry implementation (extend BufferGeometry2 or upgrade pattern)
 * - Serialization support (register with ThreeSerialization.SerializableClasses)
 * - UI config integration (generationParams pattern like GeometryGeneratorPlugin)
 * - Dedicated example demonstrating usage with different shapes and curves
 * - Integration with GeometryGeneratorPlugin as a generator type
 * - See ShapeTubeExtrudePlugin (below) for the original webgi plugin that used this
 *
 * TubeShapeGeometry — extrudes a closed 2D Shape along a 3D Curve path.
 *
 * Modified from Three.js TubeGeometry to support arbitrary cross-section shapes
 * instead of just circles. Uses Three.js Curve.computeFrenetFrames() for
 * stable normal computation along the path.
 *
 * Features:
 * - Arbitrary closed Shape as cross-section (not just circles)
 * - Shape scaling via shapeScale Vector2
 * - Primary axis control ('shape' or 'path') for triangle orientation
 * - Edge normal fixing for seamless closed shapes
 * - createSplits() for multi-material groups (e.g., road lanes, curb/sidewalk)
 *
 * Reference: Three.js TubeGeometry source
 * https://github.com/mrdoob/three.js/blob/dev/src/geometries/TubeGeometry.js
 */

import {BufferAttribute, BufferGeometry, Curve, Float32BufferAttribute, Shape, Vector2, Vector3} from 'three'

export class TubeShapeGeometry extends BufferGeometry {
    public frames: {tangents: Vector3[]; normals: Vector3[]; binormals: Vector3[]}
    public parameters: {
        path: Curve<Vector3>
        shape: Shape
        shapeScale: Vector2
        shapeSegments: number
        closed: boolean
        tubularSegments: number
        primary: 'shape' | 'path'
    }

    /**
     * @param shape — closed 2D shape for the cross-section
     * @param path — 3D curve to extrude along
     * @param shapeSegments — subdivisions of the shape cross-section
     * @param tubularSegments — subdivisions along the path
     * @param closed — whether the path forms a closed loop
     * @param shapeScale — scale applied to the shape cross-section
     * @param primary — 'shape' or 'path', controls triangle orientation for optimal rendering
     */
    constructor(
        shape: Shape,
        path: Curve<Vector3>,
        shapeSegments = 32,
        tubularSegments = 64,
        closed = false,
        shapeScale: Vector2 = new Vector2(1, 1),
        primary: 'shape' | 'path' = 'shape',
    ) {
        super()
        // @ts-expect-error type field override
        this.type = 'TubeShapeGeometry'

        this.parameters = {
            path: path,
            shape: shape,
            shapeSegments: shapeSegments,
            tubularSegments: tubularSegments,
            closed: closed,
            primary: primary,
            shapeScale: shapeScale.clone(),
        }

        const frames = path.computeFrenetFrames(tubularSegments, closed)
        this.frames = frames

        const vertex = new Vector3()
        const normal = new Vector3()
        const normal2 = new Vector3()
        const uv = new Vector2()
        let P = new Vector3()

        const vertices: number[] = []
        const uvs: number[] = []
        const indices: number[] = []

        const points = shape.getSpacedPoints(shapeSegments)
        for (const point of points) {
            point.multiply(shapeScale)
        }

        generateBufferData()

        this.setIndex(indices)
        this.setAttribute('position', new Float32BufferAttribute(vertices, 3))
        this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))

        this.computeVertexNormals()

        const normals = this.attributes.normal as BufferAttribute
        fixEdgeNormals()

        function generateBufferData() {
            for (let i = 0; i < tubularSegments; i++) {
                generateSegment(i)
            }
            generateSegment(closed === false ? tubularSegments : 0)
            generateUVs()
            generateIndices()
        }

        function generateSegment(i: number) {
            P = path.getPointAt(i / tubularSegments, P)

            const N = frames.normals[i]
            const B = frames.binormals[i]

            for (let j = 0; j <= shapeSegments; j++) {
                const point = points[j % shapeSegments] // shape is assumed to be closed

                normal.set(0, 0, 0)
                    .addScaledVector(N, point.x).addScaledVector(B, point.y)
                vertex.copy(P).add(normal)

                vertices.push(vertex.x, vertex.y, vertex.z)
            }
        }

        function generateIndices() {
            const ps = primary === 'shape'
            const jl = ps ? shapeSegments : tubularSegments
            const il = ps ? tubularSegments : shapeSegments
            for (let j = 1; j <= jl; j++) {
                for (let i = 1; i <= il; i++) {
                    const [k, m] = ps ? [i, j] : [j, i]

                    const a = (shapeSegments + 1) * (k - 1) + (m - 1)
                    const b = (shapeSegments + 1) * k + (m - 1)
                    const c = (shapeSegments + 1) * k + m
                    const d = (shapeSegments + 1) * (k - 1) + m

                    indices.push(a, b, d)
                    indices.push(b, c, d)
                }
            }
        }

        function generateUVs() {
            for (let i = 0; i <= tubularSegments; i++) {
                for (let j = 0; j <= shapeSegments; j++) {
                    uv.x = i / tubularSegments
                    uv.y = j / shapeSegments
                    uvs.push(uv.x, uv.y)
                }
            }
        }

        /**
         * Average normals at shape seam edges and path start/end edges
         * to eliminate visible hard edges on closed shapes.
         */
        function fixEdgeNormals() {
            // Fix shape seam (first/last shape vertex per ring)
            for (let i = 1; i < shapeSegments; i++) {
                const j = i + tubularSegments * (shapeSegments + 1)
                normal.fromBufferAttribute(normals, i)
                normal2.fromBufferAttribute(normals, j)
                normal.add(normal2).normalize()
                normals.setXYZ(i, normal.x, normal.y, normal.z)
                normals.setXYZ(j, normal.x, normal.y, normal.z)
            }
            // Fix path seam (first/last ring)
            for (let k = 1; k < tubularSegments; k++) {
                const i = k * (shapeSegments + 1)
                const j = i + shapeSegments
                normal.fromBufferAttribute(normals, i)
                normal2.fromBufferAttribute(normals, j)
                normal.add(normal2).normalize()
                normals.setXYZ(i, normal.x, normal.y, normal.z)
                normals.setXYZ(j, normal.x, normal.y, normal.z)
            }

            // Fix the 4 corner vertices where both seams meet
            normal.fromBufferAttribute(normals, 0)
            normal2.fromBufferAttribute(normals, shapeSegments)
            normal.add(normal2)
            const lastI = tubularSegments * (shapeSegments + 1)
            normal2.fromBufferAttribute(normals, lastI)
            normal.add(normal2)
            normal2.fromBufferAttribute(normals, lastI + shapeSegments)
            normal.add(normal2)
            normal.normalize()

            normals.setXYZ(0, normal.x, normal.y, normal.z)
            normals.setXYZ(shapeSegments, normal.x, normal.y, normal.z)
            normals.setXYZ(lastI, normal.x, normal.y, normal.z)
            normals.setXYZ(lastI + shapeSegments, normal.x, normal.y, normal.z)

            normals.needsUpdate = true
        }
    }

    /**
     * Split the geometry into material groups at the given normalized positions.
     * Useful for multi-material tubes (e.g., road with different lane colors).
     * @param splits Array of normalized positions (0-1) along the primary axis where splits occur
     * @returns Number of groups created
     */
    createSplits(splits: number[]): number {
        this.clearGroups()

        const divisions = this.parameters.primary === 'shape' ? this.parameters.shapeSegments : this.parameters.tubularSegments
        const vCount = this.index!.count
        const splits2 = [...splits, 1].sort((a, b) => a - b)
        let last = 0
        let si = 0
        for (const split of splits2) {
            const c = Math.round(divisions * split) * vCount / divisions
            this.addGroup(last, c - last, si++)
            last = c
        }

        return this.groups.length
    }

    toJSON() {
        const data = super.toJSON() as any
        data.path = this.parameters.path.toJSON()
        data.shape = this.parameters.shape.toJSON()
        return data
    }
}
