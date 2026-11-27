import {BufferAttribute, ExtrudeGeometry, Shape, Vector2} from 'three'
import {AGeometryGenerator} from '../AGeometryGenerator'

export interface ArchWallGeometryGeneratorParams {
    /** Length of the wall along x. */
    width: number
    /** Height of the wall. */
    height: number
    /** Thickness of the wall along z. */
    thickness: number
    /** Number of arched openings, evenly spaced, with piers of equal width between them and at both ends. */
    archCount: number
    /** Width of each opening. Clamped so the openings fit in the wall. */
    archWidth: number
    /** Height of the top of each opening, from the bottom of the wall. Clamped below the wall height. */
    archHeight: number
    /** Segments along each arch curve. */
    archSegments: number
}

/**
 * Generates a wall with a row of round-arched openings, like an arcade or a colonnade.
 * The wall outline is a three.js Shape with the openings cut up from the bottom edge, extruded by the thickness with
 * ExtrudeGeometry. Each opening is straight up to its springing line and has a semicircular top; when the arch height
 * is less than half the opening width, the top is a flattened half ellipse.
 *
 * The origin is at the bottom center of the wall, so it stands on y = 0, and the thickness is centered on z = 0.
 * The arch soffits get the exact normals of the curve, so they shade smooth; the flat faces keep their face normals.
 * Groups: 0 is the front and back faces, 1 the sides, the top and the arch soffits (as ExtrudeGeometry).
 */
export class ArchWallGeometryGenerator extends AGeometryGenerator<ArchWallGeometryGeneratorParams> {

    constructor(type = 'archWall', defaultParams?: Partial<ArchWallGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: ArchWallGeometryGeneratorParams = {
        width: 6,
        height: 3,
        thickness: 0.3,
        archCount: 3,
        archWidth: 1.2,
        archHeight: 2.2,
        archSegments: 16,
    }

    /**
     * The placement of the openings after clamping: each opening goes from `left[i]` to `left[i] + archWidth`, is
     * straight up to `spring`, and its top is a half ellipse with radii `rx` (half the width) and `ry`.
     */
    static Layout(params: ArchWallGeometryGeneratorParams) {
        const width = Math.max(params.width, 1e-4)
        const height = Math.max(params.height, 1e-4)
        const count = Math.max(0, Math.floor(params.archCount))
        const segments = Math.max(1, Math.floor(params.archSegments))
        // leave at least a sliver of pier between and around the openings, so the outline never touches itself
        const minPier = Math.min(width, height) * 1e-3
        let archWidth = count > 0 ? Math.max(0, Math.min(params.archWidth, (width - minPier * (count + 1)) / count)) : 0
        const archTop = Math.max(0, Math.min(params.archHeight, height - minPier))
        if (archTop <= 0) archWidth = 0
        const pier = (width - archWidth * count) / (count + 1)
        const rx = archWidth / 2
        const spring = Math.max(0, archTop - rx)
        const ry = archTop - spring
        const left = archWidth > 0 ? Array.from({length: count}, (_, i) => -width / 2 + pier * (i + 1) + archWidth * i) : []
        return {width, height, segments, archWidth, left, rx, ry, spring}
    }

    /**
     * The wall outline in the xy plane, counter-clockwise, with the openings as notches up from the bottom edge
     * (a shape without holes, since the openings reach the bottom).
     */
    static CreateShape(params: ArchWallGeometryGeneratorParams): Shape {
        const {width, height, segments, archWidth, left, rx, ry, spring} = ArchWallGeometryGenerator.Layout(params)
        const pts: Vector2[] = []
        const push = (x: number, y: number) => {
            const last = pts[pts.length - 1]
            if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) return
            pts.push(new Vector2(x, y))
        }
        push(-width / 2, 0)
        for (const l of left) {
            const cx = l + rx
            push(l, 0)
            push(l, spring)
            for (let k = 1; k < segments; k++) {
                const a = Math.PI * (1 - k / segments)
                push(cx + rx * Math.cos(a), spring + ry * Math.sin(a))
            }
            push(l + archWidth, spring)
            push(l + archWidth, 0)
        }
        push(width / 2, 0)
        push(width / 2, height)
        push(-width / 2, height)
        return new Shape(pts)
    }

    protected _generateData(params: ArchWallGeometryGeneratorParams) {
        const thickness = Math.max(params.thickness, 1e-4)
        const geometry = new ExtrudeGeometry(ArchWallGeometryGenerator.CreateShape(params), {
            depth: thickness,
            bevelEnabled: false,
            curveSegments: 1, // the outline is already made of line segments
            steps: 1,
        })
        geometry.translate(0, 0, -thickness / 2)
        ArchWallGeometryGenerator._SetSoffitNormals(geometry.getAttribute('position') as BufferAttribute, geometry.getAttribute('normal') as BufferAttribute, params)

        const vertices = geometry.getAttribute('position') as BufferAttribute
        const result = {
            // ExtrudeGeometry is not indexed: sequential indices, so a geometry this generates into (an indexed one, like a
            // generated box) gets its index replaced and does not draw the new vertices through the old index
            indices: Array.from({length: vertices.count}, (_, i) => i),
            vertices,
            normals: geometry.getAttribute('normal') as BufferAttribute,
            uvs: geometry.getAttribute('uv') as BufferAttribute,
            groups: geometry.groups.map(g => ({...g})),
        }
        geometry.dispose()
        return result
    }

    /**
     * ExtrudeGeometry gives each face its own flat normal. On the side faces that lie on an arch curve, replace it with
     * the normal of the half ellipse at the vertex, pointing into the opening, so the soffit shades as one smooth surface.
     */
    private static _SetSoffitNormals(position: BufferAttribute, normal: BufferAttribute, params: ArchWallGeometryGeneratorParams) {
        const {left, rx, ry, spring} = ArchWallGeometryGenerator.Layout(params)
        if (!left.length || rx <= 0 || ry <= 0) return
        for (let i = 0; i < position.count; i++) {
            if (Math.abs(normal.getZ(i)) > 0.5) continue // the front and back faces
            const x = position.getX(i), y = position.getY(i)
            for (const l of left) {
                const dx = (x - (l + rx)) / rx, dy = (y - spring) / ry
                // the positions are float32: a vertex far from the origin is off the curve by about 1e-7 of its distance
                if (dy < -1e-4 || Math.abs(dx) > 1 + 1e-4 || Math.abs(dx * dx + dy * dy - 1) > 1e-4) continue
                // on the springing line the curve is vertical: the end of the first and last segment gets the horizontal
                // normal of the jamb below, so they meet smoothly. A face there that is flat already keeps its normal: the
                // jamb (the same normal) and, for an arch that starts at the floor, the bottom face of the pier (a sharp corner)
                if (dy < 1e-4 && (Math.abs(normal.getX(i)) > 0.999 || Math.abs(normal.getY(i)) > 0.999)) break
                // the gradient of the ellipse points out of the opening; the soffit faces into it
                const nx = -dx / rx, ny = -dy / ry
                const len = Math.hypot(nx, ny)
                normal.setXYZ(i, nx / len, ny / len, 0)
                break
            }
        }
        normal.needsUpdate = true
    }

}
