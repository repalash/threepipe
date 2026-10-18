/**
 * Round mesh primitives of the geometry nodes: Mesh Circle (`node_geo_mesh_primitive_circle.cc`
 * `create_circle_mesh` :97), cylinder / cone (`geometry/intern/mesh_primitive_cylinder_cone.cc`
 * `create_cylinder_or_cone_mesh` :646) and UV sphere (`geometry/intern/mesh_primitive_uv_sphere.cc`
 * `create_uv_sphere_mesh` :296). `std::sin`/`std::cos` of a float are `sinf`/`cosf` (plan §2.6).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {cosf, sincosf, sinf} from '../blender/libm'
import {createLineMesh, meshSmoothSet, newMesh} from './meshPrimitives'
import {boundsRadialPrimitive, meshBoundsSetEager} from './meshBounds'


export type CircleFillType = 'NONE' | 'NGON' | 'TRIANGLE_FAN'

/** `create_circle_mesh` (`node_geo_mesh_primitive_circle.cc:97`). */
export function createCircleMesh(radius: number, vertsNum: number, fill: CircleFillType): MeshData {
    const fan = fill === 'TRIANGLE_FAN'
    const verts = fan ? vertsNum + 1 : vertsNum
    const edgesNum = fan ? vertsNum * 2 : vertsNum
    const corners = fill === 'NONE' ? 0 : fill === 'NGON' ? vertsNum : vertsNum * 3
    const faces = fill === 'NONE' ? 0 : fill === 'NGON' ? 1 : vertsNum
    const mesh = newMesh(verts, edgesNum, faces, corners)
    mesh.materials = ['']
    if (fill !== 'NONE') meshSmoothSet(mesh, false)
    const positions = mesh.positions
    // `2.0f * (M_PI / float(verts_num))`: double, stored as float.
    const angleDelta = f32(2 * (Math.PI / vertsNum))
    for (let i = 0; i < vertsNum; i++) {
        const angle = f32(i * angleDelta)
        const [sin, cos] = sincosf(angle)
        positions[i * 3] = f32(cos * radius)
        positions[i * 3 + 1] = f32(sin * radius)
        positions[i * 3 + 2] = 0
    }
    if (fan) positions.fill(0, vertsNum * 3, vertsNum * 3 + 3)
    const edges = mesh.edgeVerts
    for (let i = 0; i < vertsNum; i++) {
        edges[i * 2] = i
        edges[i * 2 + 1] = (i + 1) % vertsNum
    }
    if (fan) {
        for (let i = 0; i < vertsNum; i++) {
            edges[(vertsNum + i) * 2] = vertsNum
            edges[(vertsNum + i) * 2 + 1] = i
        }
    }
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts, ce = mesh.cornerEdges
    if (fill === 'NGON') {
        fo[0] = 0
        fo[1] = corners
        for (let i = 0; i < corners; i++) cv[i] = ce[i] = i
    } else if (fan) {
        for (let i = 0; i <= faces; i++) fo[i] = 3 * i
        for (let i = 0; i < vertsNum; i++) {
            cv[3 * i] = i
            ce[3 * i] = i
            cv[3 * i + 1] = (i + 1) % vertsNum
            ce[3 * i + 1] = vertsNum + ((i + 1) % vertsNum)
            cv[3 * i + 2] = vertsNum
            ce[3 * i + 2] = vertsNum + i
        }
    }
    // `calculate_bounds_circle` (:91).
    meshBoundsSetEager(mesh, boundsRadialPrimitive(0, radius, vertsNum, 0))
    return mesh
}

// region cylinder / cone

/** `ConeConfig` (`mesh_primitive_cylinder_cone.cc:19`). */
class ConeConfig {
    readonly height: number
    readonly topIsPoint: boolean
    readonly bottomIsPoint: boolean
    readonly topHasCenterVert: boolean
    readonly bottomHasCenterVert: boolean
    readonly totQuadRings: number
    readonly totEdgeRings: number
    readonly totVerts: number
    readonly totEdges: number
    readonly totCorners: number
    readonly firstVert = 0
    readonly firstRingVertsStart: number
    readonly lastRingVertsStart: number
    readonly lastVert: number
    readonly firstRingEdgesStart: number
    readonly lastRingEdgesStart: number
    readonly lastFanEdgesStart: number
    readonly lastEdge: number
    readonly topFacesLen: number
    readonly sideFacesStart: number
    readonly sideFacesLen: number
    readonly bottomFacesStart: number
    readonly bottomFacesLen: number
    readonly totFaces: number

    constructor(
        readonly radiusTop: number, readonly radiusBottom: number, depth: number, readonly circleSegments: number,
        readonly sideSegments: number, readonly fillSegments: number, readonly fill: CircleFillType,
    ) {
        this.height = f32(0.5 * depth)
        this.topIsPoint = radiusTop === 0
        this.bottomIsPoint = radiusBottom === 0
        this.topHasCenterVert = this.topIsPoint || fill === 'TRIANGLE_FAN'
        this.bottomHasCenterVert = this.bottomIsPoint || fill === 'TRIANGLE_FAN'
        const both = this.topIsPoint && this.bottomIsPoint
        const cs = circleSegments
        // `calculate_total_quad_rings` (:137).
        this.totQuadRings = both ? 0
            : (this.topIsPoint ? 0 : fillSegments - 1) + (!this.topIsPoint && !this.bottomIsPoint ? sideSegments : sideSegments - 1) +
            (this.bottomIsPoint ? 0 : fillSegments - 1)
        // `calculate_total_edge_rings` (:158).
        this.totEdgeRings = both ? 0 : (this.topIsPoint ? 0 : fillSegments) + sideSegments - 1 + (this.bottomIsPoint ? 0 : fillSegments)
        // `calculate_total_verts` (:177).
        this.totVerts = both ? sideSegments + 1
            : (this.topHasCenterVert ? 1 : 0) + (this.topIsPoint ? 0 : cs * fillSegments) + cs * (sideSegments - 1) +
            (this.bottomIsPoint ? 0 : cs * fillSegments) + (this.bottomHasCenterVert ? 1 : 0)
        // `calculate_total_edges` (:206).
        this.totEdges = both ? sideSegments
            : (this.topHasCenterVert ? cs : 0) + cs * (this.totQuadRings * 2 + 1) + (this.bottomHasCenterVert ? cs : 0)
        // `calculate_total_corners` (:225).
        let corners = 0
        if (!both) {
            if (this.topHasCenterVert) corners += cs * 3
            else if (!this.topIsPoint && fill === 'NGON') corners += cs
            corners += this.totQuadRings * cs * 4
            if (this.bottomHasCenterVert) corners += cs * 3
            else if (!this.bottomIsPoint && fill === 'NGON') corners += cs
        }
        this.totCorners = corners
        this.firstRingVertsStart = this.topHasCenterVert ? 1 : 0
        this.lastVert = this.totVerts - 1
        this.lastRingVertsStart = this.lastVert - cs
        this.firstRingEdgesStart = this.topHasCenterVert ? cs : 0
        this.lastRingEdgesStart = this.firstRingEdgesStart + this.totQuadRings * cs * 2
        this.lastFanEdgesStart = this.totEdges - cs
        this.lastEdge = this.totEdges - 1
        this.topFacesLen = this.topIsPoint ? 0
            : (fillSegments - 1) * cs + (this.topHasCenterVert ? cs : 0) + (fill === 'NGON' ? 1 : 0)
        this.sideFacesStart = this.topFacesLen
        this.sideFacesLen = both ? 0 : sideSegments * cs
        this.bottomFacesLen = this.bottomIsPoint ? 0
            : (fillSegments - 1) * cs + (this.bottomHasCenterVert ? cs : 0) + (fill === 'NGON' ? 1 : 0)
        this.bottomFacesStart = this.sideFacesStart + this.sideFacesLen
        this.totFaces = this.topFacesLen + this.sideFacesLen + this.bottomFacesLen
    }
}

/** `calculate_cone_verts` (:249). */
function coneVerts(c: ConeConfig, positions: Float32Array): void {
    const cs = c.circleSegments
    const circle = new Float32Array(cs * 2)
    // `2.0f * (std::numbers::pi / float(circle_segments))`, stored as float; the angle accumulates in float.
    const angleDelta = f32(2 * (Math.PI / cs))
    let angle = 0
    for (let i = 0; i < cs; i++) {
        const [sin, cos] = sincosf(angle)
        circle[i * 2] = cos
        circle[i * 2 + 1] = sin
        angle = f32(angle + angleDelta)
    }
    let v = 0
    const put = (x: number, y: number, z: number) => {
        positions[v * 3] = x
        positions[v * 3 + 1] = y
        positions[v * 3 + 2] = z
        v++
    }
    if (c.topHasCenterVert) put(0, 0, c.height)
    if (!c.topIsPoint) {
        const delta = f32(c.radiusTop / c.fillSegments)
        for (let i = 0; i < c.fillSegments; i++) {
            const r = f32(delta * (i + 1))
            for (let j = 0; j < cs; j++) put(f32(circle[j * 2] * r), f32(circle[j * 2 + 1] * r), c.height)
        }
    }
    const sideRadiusDelta = f32(f32(c.radiusBottom - c.radiusTop) / c.sideSegments)
    const heightDelta = f32(f32(2 * c.height) / c.sideSegments)
    for (let i = 0; i < c.sideSegments - 1; i++) {
        const r = f32(c.radiusTop + f32(sideRadiusDelta * (i + 1)))
        const h = f32(c.height - f32(heightDelta * (i + 1)))
        for (let j = 0; j < cs; j++) put(f32(circle[j * 2] * r), f32(circle[j * 2 + 1] * r), h)
    }
    if (!c.bottomIsPoint) {
        const delta = f32(c.radiusBottom / c.fillSegments)
        for (let i = 0; i < c.fillSegments; i++) {
            const r = f32(c.radiusBottom - f32(i * delta))
            for (let j = 0; j < cs; j++) put(f32(circle[j * 2] * r), f32(circle[j * 2 + 1] * r), -c.height)
        }
    }
    if (c.bottomHasCenterVert) put(0, 0, -c.height)
}

/** `calculate_cone_edges` (:327). */
function coneEdges(c: ConeConfig, edges: Int32Array): void {
    const cs = c.circleSegments
    let e = 0
    const put = (a: number, b: number) => {
        edges[e * 2] = a
        edges[e * 2 + 1] = b
        e++
    }
    if (c.topHasCenterVert) for (let i = 0; i < cs; i++) put(c.firstVert, c.firstRingVertsStart + i)
    for (let i = 0; i < c.totEdgeRings; i++) {
        const thisRing = c.firstRingVertsStart + i * cs
        const nextRing = thisRing + cs
        for (let j = 0; j < cs; j++) put(thisRing + j, thisRing + ((j + 1) % cs))
        if (i === c.totEdgeRings - 1) break
        for (let j = 0; j < cs; j++) put(thisRing + j, nextRing + j)
    }
    if (c.bottomHasCenterVert) for (let i = 0; i < cs; i++) put(c.lastRingVertsStart + i, c.lastVert)
}

/** `calculate_cone_faces` (:367): face sizes into `sizes`, corners into the arrays. */
function coneFaces(c: ConeConfig, cv: Int32Array, ce: Int32Array, sizes: Int32Array): void {
    const cs = c.circleSegments
    let ringsFaceStart = 0, ringsLoopStart = 0
    if (c.topHasCenterVert) {
        ringsFaceStart = cs
        ringsLoopStart = cs * 3
        sizes.fill(3, 0, cs)
        for (let i = 0; i < cs; i++) {
            const l = i * 3
            cv[l] = c.firstRingVertsStart + i
            ce[l] = c.firstRingEdgesStart + i
            cv[l + 1] = c.firstRingVertsStart + ((i + 1) % cs)
            ce[l + 1] = (i + 1) % cs
            cv[l + 2] = 0
            ce[l + 2] = i
        }
    } else if (c.fill === 'NGON') {
        ringsFaceStart = 1
        ringsLoopStart = cs
        sizes[0] = cs
        for (let i = 0; i < cs; i++) cv[i] = ce[i] = i
    }
    const ringFacesNum = c.totQuadRings * cs
    sizes.fill(4, ringsFaceStart, ringsFaceStart + ringFacesNum)
    for (let i = 0; i < c.totQuadRings; i++) {
        const thisRingLoopStart = ringsLoopStart + i * cs * 4
        const thisRingVertStart = c.firstRingVertsStart + i * cs
        const nextRingVertStart = thisRingVertStart + cs
        const thisRingEdgesStart = c.firstRingEdgesStart + i * 2 * cs
        const nextRingEdgesStart = thisRingEdgesStart + 2 * cs
        const ringConnectionsStart = thisRingEdgesStart + cs
        for (let j = 0; j < cs; j++) {
            const l = thisRingLoopStart + j * 4
            cv[l] = thisRingVertStart + j
            ce[l] = ringConnectionsStart + j
            cv[l + 1] = nextRingVertStart + j
            ce[l + 1] = nextRingEdgesStart + j
            cv[l + 2] = nextRingVertStart + ((j + 1) % cs)
            ce[l + 2] = ringConnectionsStart + ((j + 1) % cs)
            cv[l + 3] = thisRingVertStart + ((j + 1) % cs)
            ce[l + 3] = thisRingEdgesStart + j
        }
    }
    const bottomFaceStart = ringsFaceStart + ringFacesNum
    const bottomLoopStart = ringsLoopStart + ringFacesNum * 4
    if (c.bottomHasCenterVert) {
        sizes.fill(3, bottomFaceStart, bottomFaceStart + cs)
        for (let i = 0; i < cs; i++) {
            const l = bottomLoopStart + i * 3
            cv[l] = c.lastRingVertsStart + i
            ce[l] = c.lastFanEdgesStart + i
            cv[l + 1] = c.lastVert
            ce[l + 1] = c.lastFanEdgesStart + ((i + 1) % cs)
            cv[l + 2] = c.lastRingVertsStart + ((i + 1) % cs)
            ce[l + 2] = c.lastRingEdgesStart + i
        }
    } else if (c.fill === 'NGON') {
        sizes[bottomFaceStart] = cs
        for (let i = 0; i < cs; i++) {
            // Backwards to reverse the surface normal.
            cv[bottomLoopStart + i] = c.lastVert - i
            ce[bottomLoopStart + i] = c.lastEdge - ((i + 1) % cs)
        }
    }
}

export interface ConeAttributeOutputs {
    topId?: string
    bottomId?: string
    sideId?: string
    uvMapId?: string
}

/** `calculate_selection_outputs` (:449). */
function coneSelectionOutputs(c: ConeConfig, outputs: ConeAttributeOutputs, mesh: MeshData): void {
    const add = (name: string, domain: AttrDomain) => mesh.attributes.add({name, domain, type: 'bool'}).data
    if (outputs.topId) {
        const face = !c.topIsPoint && c.fill !== 'NONE'
        const s = add(outputs.topId, face ? AttrDomain.Face : AttrDomain.Point)
        if (c.topIsPoint) s[c.firstVert] = 1
        else s.fill(1, 0, face ? c.topFacesLen : c.circleSegments)
    }
    if (outputs.bottomId) {
        const face = !c.bottomIsPoint && c.fill !== 'NONE'
        const s = add(outputs.bottomId, face ? AttrDomain.Face : AttrDomain.Point)
        if (c.bottomIsPoint) s[c.lastVert] = 1
        else if (face) s.fill(1, c.bottomFacesStart, c.bottomFacesStart + c.bottomFacesLen)
        else s.fill(1, c.lastRingVertsStart + 1, c.lastRingVertsStart + 1 + c.circleSegments)
    }
    if (outputs.sideId) {
        add(outputs.sideId, AttrDomain.Face).fill(1, c.sideFacesStart, c.sideFacesStart + c.sideFacesLen)
    }
}

/** `calculate_cone_uvs` (:494): a float2 corner attribute. */
function coneUVs(c: ConeConfig, mesh: MeshData, uvMapId: string): void {
    const uvs = mesh.attributes.add({name: uvMapId, domain: AttrDomain.Corner, type: 'float2'}).data
    const cs = c.circleSegments
    const circle = new Float32Array(cs * 2)
    let angle = 0
    // `2.0f * std::numbers::pi / float(circle_segments)`.
    const angleDelta = f32((2 * Math.PI) / cs)
    for (let i = 0; i < cs; i++) {
        const [sin, cos] = sincosf(angle)
        circle[i * 2] = f32(cos * f32(0.225))
        circle[i * 2 + 1] = f32(sin * f32(0.225))
        angle = f32(angle + angleDelta)
    }
    let corner = 0
    const put = (x: number, y: number) => {
        uvs[corner * 2] = x
        uvs[corner * 2 + 1] = y
        corner++
    }
    // `factor * circle[j] + center`.
    const at = (factor: number, j: number, cx: number, cy: number) => put(f32(f32(factor * circle[j * 2]) + cx), f32(f32(factor * circle[j * 2 + 1]) + cy))
    if (c.topIsPoint || c.fill !== 'NONE') {
        const cx = 0.25, cy = 0.25
        const delta = f32(1 / (c.topIsPoint ? c.sideSegments : c.fillSegments))
        const count = c.topIsPoint ? c.sideSegments : c.fillSegments
        if (c.topHasCenterVert) {
            for (let i = 0; i < cs; i++) {
                at(delta, i, cx, cy)
                at(delta, (i + 1) % cs, cx, cy)
                put(cx, cy)
            }
        } else if (!c.topIsPoint && c.fill === 'NGON') {
            for (let i = 0; i < cs; i++) at(delta, i, cx, cy)
        }
        for (let i = 1; i < count; i++) {
            const inner = f32(i * delta), outer = f32((i + 1) * delta)
            for (let j = 0; j < cs; j++) {
                at(inner, j, cx, cy)
                at(outer, j, cx, cy)
                at(outer, (j + 1) % cs, cx, cy)
                at(inner, (j + 1) % cs, cx, cy)
            }
        }
    }
    if (!c.topIsPoint && !c.bottomIsPoint) {
        const bottom = c.fill === 'NONE' ? 0 : 0.5
        const xDelta = f32(1 / cs)
        const yDelta = f32(f32(1 - bottom) / c.sideSegments)
        for (let i = 0; i < c.sideSegments; i++) {
            for (let j = 0; j < cs; j++) {
                put(f32(j * xDelta), f32(f32(i * yDelta) + bottom))
                put(f32(j * xDelta), f32(f32((i + 1) * yDelta) + bottom))
                put(f32((j + 1) * xDelta), f32(f32((i + 1) * yDelta) + bottom))
                put(f32((j + 1) * xDelta), f32(f32(i * yDelta) + bottom))
            }
        }
    }
    if (c.bottomIsPoint || c.fill !== 'NONE') {
        const cx = 0.75, cy = 0.25
        const delta = f32(1 / (c.bottomIsPoint ? c.sideSegments : c.fillSegments))
        const count = c.bottomIsPoint ? c.sideSegments : c.fillSegments
        for (let i = 0; i < count - 1; i++) {
            const outer = f32(1 - f32(i * delta)), inner = f32(1 - f32((i + 1) * delta))
            for (let j = 0; j < cs; j++) {
                at(outer, j, cx, cy)
                at(inner, j, cx, cy)
                at(inner, (j + 1) % cs, cx, cy)
                at(outer, (j + 1) % cs, cx, cy)
            }
        }
        if (c.bottomHasCenterVert) {
            for (let i = 0; i < cs; i++) {
                at(delta, i, cx, cy)
                put(cx, cy)
                at(delta, (i + 1) % cs, cx, cy)
            }
        } else if (!c.bottomIsPoint && c.fill === 'NGON') {
            for (let i = 0; i < cs; i++) at(delta, cs - 1 - i, cx, cy)
        }
    }
}

/** `create_cylinder_or_cone_mesh` (:646). */
export function createCylinderOrConeMesh(
    radiusTop: number, radiusBottom: number, depth: number, circleSegments: number, sideSegments: number,
    fillSegments: number, fill: CircleFillType, outputs: ConeAttributeOutputs,
): MeshData {
    const c = new ConeConfig(f32(radiusTop), f32(radiusBottom), f32(depth), circleSegments, sideSegments, fillSegments, fill)
    if (c.topIsPoint && c.bottomIsPoint) {
        if (c.height === 0) {
            // `create_vertex_mesh` (:631).
            return newMesh(1, 0, 0, 0)
        }
        const zDelta = f32(f32(-2 * c.height) / c.sideSegments)
        const line = createLineMesh([0, 0, c.height], [0, 0, zDelta], c.totVerts)!
        // `create_line_mesh` (`mesh_primitive_line.cc:46`): `min_max({start, start + delta * edges_num})`.
        const end = f32(c.height + f32(zDelta * (c.totVerts - 1)))
        meshBoundsSetEager(line, {min: [0, 0, Math.min(c.height, end)], max: [0, 0, Math.max(c.height, end)]})
        return line
    }
    const mesh = newMesh(c.totVerts, c.totEdges, c.totFaces, c.totCorners)
    meshSmoothSet(mesh, false)
    coneVerts(c, mesh.positions)
    coneEdges(c, mesh.edgeVerts)
    const sizes = new Int32Array(c.totFaces)
    coneFaces(c, mesh.cornerVerts, mesh.cornerEdges, sizes)
    // `offset_indices::accumulate_counts_to_offsets`.
    const fo = mesh.faceOffsets
    fo[0] = 0
    for (let i = 0; i < c.totFaces; i++) fo[i + 1] = fo[i] + sizes[i]
    if (outputs.uvMapId) coneUVs(c, mesh, outputs.uvMapId)
    coneSelectionOutputs(c, outputs, mesh)
    // `calculate_bounds_cylinder` (:640).
    meshBoundsSetEager(mesh, boundsRadialPrimitive(c.radiusTop, c.radiusBottom, c.circleSegments, c.height))
    return mesh
}

// endregion

// region UV sphere

/** `create_uv_sphere_mesh` (`mesh_primitive_uv_sphere.cc:296`). Returns the mesh and the vertex normals Blender assigns. */
export function createUVSphereMesh(radius: number, segments: number, rings: number, uvMapId?: string): {mesh: MeshData, vertNormals: Float32Array} {
    const vertsNum = segments * (rings - 1) + 2
    const edgesNum = segments * (rings * 2 - 1)
    const facesNum = segments * (rings - 2) + segments * 2
    const cornersNum = 4 * segments * (rings - 2) + 3 * segments * 2
    const mesh = newMesh(vertsNum, edgesNum, facesNum, cornersNum)
    meshSmoothSet(mesh, false)

    // `calculate_sphere_vertex_data` (:65).
    const positions = mesh.positions
    const normals = new Float32Array(vertsNum * 3)
    const deltaTheta = f32(Math.PI / rings)
    const deltaPhi = f32((2 * Math.PI) / segments)
    const cosines = new Float32Array(segments + 1), sines = new Float32Array(segments + 1)
    for (let s = 1; s <= segments; s++) cosines[s] = cosf(f32(s * deltaPhi))
    for (let s = 1; s <= segments; s++) sines[s] = sinf(f32(s * deltaPhi))
    positions.set([0, 0, radius], 0)
    normals.set([0, 0, 1], 0)
    let v = 1
    for (let ring = 1; ring < rings; ring++) {
        const theta = f32(ring * deltaTheta)
        // `std::sin(theta)` and `std::cos(theta)` in one block: one `__sincosf_stret` call.
        const [sinTheta, z] = sincosf(theta)
        for (let s = 1; s <= segments; s++) {
            const x = f32(sinTheta * cosines[s]), y = f32(sinTheta * sines[s])
            positions[v * 3] = f32(x * radius)
            positions[v * 3 + 1] = f32(y * radius)
            positions[v * 3 + 2] = f32(z * radius)
            normals[v * 3] = x
            normals[v * 3 + 1] = y
            normals[v * 3 + 2] = z
            v++
        }
    }
    positions.set([0, 0, -radius], (vertsNum - 1) * 3)
    normals.set([0, 0, -1], (vertsNum - 1) * 3)

    // `calculate_sphere_edge_indices` (:105).
    const edges = mesh.edgeVerts
    let e = 0
    const put = (a: number, b: number) => {
        edges[e * 2] = a
        edges[e * 2 + 1] = b
        e++
    }
    for (let s = 0; s < segments; s++) put(0, 1 + s)
    let ringStart = 1
    for (let ring = 0; ring < rings - 1; ring++) {
        const next = ringStart + segments
        for (let s = 0; s < segments; s++) put(ringStart + s, ringStart + ((s + 1) % segments))
        if (ring < rings - 2) for (let s = 0; s < segments; s++) put(ringStart + s, next + s)
        ringStart += segments
    }
    const lastVert = vertsNum - 1
    const lastRingStart = lastVert - segments
    for (let s = 0; s < segments; s++) put(lastVert, lastRingStart + s)

    // `calculate_sphere_faces` (:148).
    const fo = mesh.faceOffsets
    for (let f = 0; f < facesNum; f++) fo[f + 1] = fo[f] + (f < segments || f >= facesNum - segments ? 3 : 4)

    // `calculate_sphere_corners` (:161).
    const cv = mesh.cornerVerts, ce = mesh.cornerEdges
    const nextOf = (s: number) => (s === segments - 1 ? 0 : s + 1)
    for (let s = 0; s < segments; s++) {
        const l = s * 3, sn = nextOf(s)
        cv[l] = 0
        ce[l] = s
        cv[l + 1] = 1 + s
        ce[l + 1] = segments + s
        cv[l + 2] = 1 + sn
        ce[l + 2] = sn
    }
    const ringsLoopStart = segments * 3
    for (let ring = 1; ring <= rings - 2; ring++) {
        const ringVertStart = 1 + (ring - 1) * segments
        const ringEdgeStart = segments + (ring - 1) * segments * 2
        const ringLoopStart = ringsLoopStart + (ring - 1) * segments * 4
        const nextRingVertStart = ringVertStart + segments
        const nextRingEdgeStart = ringEdgeStart + segments * 2
        const verticalStart = ringEdgeStart + segments
        for (let s = 0; s < segments; s++) {
            const l = ringLoopStart + s * 4, sn = nextOf(s)
            cv[l] = ringVertStart + s
            ce[l] = verticalStart + s
            cv[l + 1] = nextRingVertStart + s
            ce[l + 1] = nextRingEdgeStart + s
            cv[l + 2] = nextRingVertStart + sn
            ce[l + 2] = verticalStart + sn
            cv[l + 3] = ringVertStart + sn
            ce[l + 3] = ringEdgeStart + s
        }
    }
    const bottomLoopStart = ringsLoopStart + segments * (rings - 2) * 4
    const lastEdgeRingStart = segments * (rings - 2) * 2 + segments
    const bottomFanStart = lastEdgeRingStart + segments
    for (let s = 0; s < segments; s++) {
        const l = bottomLoopStart + s * 3, sn = nextOf(s)
        cv[l] = lastVert
        ce[l] = bottomFanStart + sn
        cv[l + 1] = lastRingStart + sn
        ce[l + 1] = lastEdgeRingStart + s
        cv[l + 2] = lastRingStart + s
        ce[l + 2] = bottomFanStart + s
    }

    // `calculate_sphere_uvs` (:238): `segments` and `rings` are floats there.
    if (uvMapId) {
        const uvs = mesh.attributes.add({name: uvMapId, domain: AttrDomain.Corner, type: 'float2'}).data
        const dy = f32(1 / rings)
        const inv = f32(1 / segments)
        const uv = (l: number, x: number, y: number) => {
            uvs[l * 2] = x
            uvs[l * 2 + 1] = y
        }
        for (let s = 0; s < segments; s++) {
            const l = s * 3
            uv(l, f32(f32(s + 0.5) * inv), 0)
            uv(l + 1, f32(s * inv), dy)
            uv(l + 2, f32(f32(s + 1) * inv), dy)
        }
        for (let ring = 1; ring <= rings - 2; ring++) {
            const ringLoopStart = ringsLoopStart + (ring - 1) * segments * 4
            for (let s = 0; s < segments; s++) {
                const l = ringLoopStart + s * 4
                uv(l, f32(s * inv), f32(ring / rings))
                uv(l + 1, f32(s * inv), f32(f32(ring + 1) / rings))
                uv(l + 2, f32(f32(s + 1) * inv), f32(f32(ring + 1) / rings))
                uv(l + 3, f32(f32(s + 1) * inv), f32(ring / rings))
            }
        }
        for (let s = 0; s < segments; s++) {
            const l = bottomLoopStart + s * 3
            uv(l, f32(f32(s + 0.5) * inv), 1)
            uv(l + 1, f32(f32(s + 1) * inv), f32(1 - dy))
            uv(l + 2, f32(s * inv), f32(1 - dy))
        }
    }
    // `calculate_bounds_uv_sphere` (:286).
    const deltaThetaB = f32(Math.PI / rings)
    const roundf = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x))
    const sinEquator = sinf(f32(roundf(f32(0.5 * rings)) * deltaThetaB))
    meshBoundsSetEager(mesh, boundsRadialPrimitive(0, f32(radius * sinEquator), segments, radius))
    return {mesh, vertNormals: normals}
}

// endregion
