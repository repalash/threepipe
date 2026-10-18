/**
 * `geometry::transform_geometry` / `translate_geometry` / `transform_mesh` (`geometry/intern/transform.cc`),
 * `bke::mesh_transform` / `mesh_translate` (`blenkernel/intern/mesh.cc:2045-2086`),
 * `CurvesGeometry::transform` / `translate` (`curves_geometry.cc:1345-1384`). Volumes and grease pencil
 * are not components here. Custom normals (`transform_custom_normal_attribute`) are not ported: a
 * `custom_normal` float3 attribute throws instead of being left wrong.
 */

import {AttributeStorage, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {isIdentityTransform, mat4FromLocQuatScale, mat4Multiply, transformPoint} from '../blender/math/matrix'
import {GeometrySet} from './GeometrySet'
import {CurvesGeometry, Instances, PointCloud} from './components'

/** `math::transform_points(transform, points)` (`math_matrix.cc:616`): skipped for an identity matrix. */
export function transformPoints(m: ArrayLike<number>, points: Float32Array): void {
    if (isIdentityTransform(m)) return
    for (let i = 0; i < points.length; i += 3) transformPoint(m, points[i], points[i + 1], points[i + 2], points, i)
}

function translatePositions(points: Float32Array, t: ArrayLike<number>): void {
    for (let i = 0; i < points.length; i += 3) {
        points[i] = f32(points[i] + t[0])
        points[i + 1] = f32(points[i + 1] + t[1])
        points[i + 2] = f32(points[i + 2] + t[2])
    }
}

const isZero3 = (t: ArrayLike<number>) => t[0] === 0 && t[1] === 0 && t[2] === 0

/** `transform_custom_normal_attribute` (`attribute_access.cc:971`) - not ported. */
function checkCustomNormals(attributes: AttributeStorage, what: string): void {
    const n = attributes.get('custom_normal')
    if (n && n.type === 'float3') throw new Error(`procedural: transforming ${what} custom normals (transform_custom_normal_attribute) is not ported`)
}

/** `bke::mesh_transform(mesh, transform, false)`. */
export function meshTransform(mesh: MeshData, m: ArrayLike<number>): void {
    transformPoints(m, mesh.positions)
    checkCustomNormals(mesh.attributes, 'mesh')
}

/** `bke::mesh_translate(mesh, translation, false)`. */
export function meshTranslate(mesh: MeshData, t: ArrayLike<number>): void {
    if (isZero3(t)) return
    translatePositions(mesh.positions, t)
}

function curvesTransform(c: CurvesGeometry, m: ArrayLike<number>): void {
    transformPoints(m, c.positions)
    for (const h of ['handle_left', 'handle_right']) {
        const l = c.attributes.get(h)
        if (l) transformPoints(m, l.data as Float32Array)
    }
    checkCustomNormals(c.attributes, 'curves')
}

function curvesTranslate(c: CurvesGeometry, t: ArrayLike<number>): void {
    if (isZero3(t)) return
    translatePositions(c.positions, t)
    for (const h of ['handle_left', 'handle_right']) {
        const l = c.attributes.get(h)
        if (l) translatePositions(l.data as Float32Array, t)
    }
}

function pointCloudTransform(pc: PointCloud, m: ArrayLike<number>): void {
    transformPoints(m, pc.positions)
}

function instancesTransform(inst: Instances, m: ArrayLike<number>): void {
    const t = inst.transforms
    for (let i = 0; i < inst.instancesNum; i++) {
        const r = mat4Multiply(m, t.subarray(i * 16, i * 16 + 16))
        t.set(r, i * 16)
    }
}

/** `translate_instances` (:96): `add_v3_v3(transform[3], translation)`. */
function instancesTranslate(inst: Instances, tr: ArrayLike<number>): void {
    const t = inst.transforms
    for (let i = 0; i < inst.instancesNum; i++) {
        t[i * 16 + 12] = f32(t[i * 16 + 12] + tr[0])
        t[i * 16 + 13] = f32(t[i * 16 + 13] + tr[1])
        t[i * 16 + 14] = f32(t[i * 16 + 14] + tr[2])
    }
}

/** `translate_geometry` (:235). `geometry` must be writable (a copy owned by the caller). */
export function translateGeometry(geometry: GeometrySet, t: ArrayLike<number>): void {
    if (isZero3(t)) return
    const curves = geometry.curvesForWrite()
    if (curves) curvesTranslate(curves, t)
    const mesh = geometry.meshForWrite()
    if (mesh) meshTranslate(mesh, t)
    const pc = geometry.pointCloudForWrite()
    if (pc && !isZero3(t)) translatePositions(pc.positions, t)
    const inst = geometry.instancesForWrite()
    if (inst) instancesTranslate(inst, t)
}

/** `transform_geometry` (:266): nothing for an exact identity matrix. */
export function transformGeometry(geometry: GeometrySet, m: ArrayLike<number>): void {
    let identity = true
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) if (m[c * 4 + r] !== (c === r ? 1 : 0)) identity = false
    if (identity) return
    const curves = geometry.curvesForWrite()
    if (curves) curvesTransform(curves, m)
    const mesh = geometry.meshForWrite()
    if (mesh) meshTransform(mesh, m)
    const pc = geometry.pointCloudForWrite()
    if (pc) pointCloudTransform(pc, m)
    const inst = geometry.instancesForWrite()
    if (inst) instancesTransform(inst, m)
}

/** `transform_mesh(mesh, translation, rotation, scale)` (:311). */
export function transformMesh(mesh: MeshData, translation: ArrayLike<number>, rotation: ArrayLike<number>, scale: ArrayLike<number>): void {
    meshTransform(mesh, mat4FromLocQuatScale(translation, rotation, scale))
}
