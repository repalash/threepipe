/**
 * Mesh normals as geometry nodes read them - port of `blenkernel/intern/mesh_normals.cc` (face and
 * vertex normals) and `mesh_normals_varray` (`blenkernel/intern/geometry_component_mesh.cc:123`),
 * float32 like Blender.
 *
 * `@threepipe/mesh-kernel`'s render bake computes its own normals (`bake.ts`, double precision, not
 * exported); these are the float32-exact ones the Normal node, Distribute and Set Position need. See
 * `issues/open/modelling-tools/procedural-mesh-normals-duplicate.md`.
 */

import {AttrDomain, AttrName, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {safeAcosApprox} from '../blender/math/base'
import {dot3, interpolate3, normalize3, sub3, V3} from '../blender/math/vec'
import {faceCornerNext, faceCornerPrev, faceFindCornerFromVert, vertToFaceMap} from './meshTopology'
import {GVArray} from './varray'
import {adaptMeshDomain} from './meshDomains'

interface NormalsCache {
    face?: Float32Array
    vert?: Float32Array
}

const caches = new WeakMap<MeshData, NormalsCache>()

/** Blender's `Mesh::tag_positions_changed`: drop cached normals after editing positions in place. */
export function tagPositionsChanged(mesh: MeshData): void {
    caches.delete(mesh)
}

function cache(mesh: MeshData): NormalsCache {
    let c = caches.get(mesh)
    if (!c) caches.set(mesh, c = {})
    return c
}

/**
 * `normal_calc_ngon` (`mesh_normals.cc:123`): Newell's method, then the C `normalize_v3` (one
 * reciprocal, three products); +Z when the face is degenerate.
 */
function normalCalcNgon(positions: Float32Array, cornerVerts: Int32Array, start: number, end: number, out: Float32Array, o: number): void {
    let nx = 0, ny = 0, nz = 0
    let p = cornerVerts[end - 1] * 3
    for (let k = start; k < end; k++) {
        const c = cornerVerts[k] * 3
        // add_newell_cross_v3_v3v3 (math_vector_inline.cc:700)
        nx = f32(nx + f32(f32(positions[p + 1] - positions[c + 1]) * f32(positions[p + 2] + positions[c + 2])))
        ny = f32(ny + f32(f32(positions[p + 2] - positions[c + 2]) * f32(positions[p] + positions[c])))
        nz = f32(nz + f32(f32(positions[p] - positions[c]) * f32(positions[p + 1] + positions[c + 1])))
        p = c
    }
    // normalize_v3 (math_vector_inline.cc:872)
    const d2 = f32(f32(f32(nx * nx) + f32(ny * ny)) + f32(nz * nz))
    if (d2 > 1.0e-35) {
        const s = f32(1 / f32(Math.sqrt(d2)))
        out[o] = f32(nx * s)
        out[o + 1] = f32(ny * s)
        out[o + 2] = f32(nz * s)
    } else {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 1
    }
}

/** `Mesh::face_normals()` via `normals_calc_faces` (`mesh_normals.cc:175`): Newell for every face. */
export function meshFaceNormals(mesh: MeshData): Float32Array {
    const c = cache(mesh)
    if (c.face) return c.face
    const out = new Float32Array(mesh.facesNum * 3)
    const fo = mesh.faceOffsets
    const positions = mesh.positions
    const cv = mesh.cornerVerts
    for (let f = 0; f < mesh.facesNum; f++) normalCalcNgon(positions, cv, fo[f], fo[f + 1], out, f * 3)
    c.face = out
    return out
}

/**
 * `Mesh::vert_normals()` via `normals_calc_verts` (`mesh_normals.cc:189`): face normals weighted by
 * the corner angle (`safe_acos_approx`), normalised; a vertex in no face gets its normalised position.
 */
export function meshVertNormals(mesh: MeshData): Float32Array {
    const c = cache(mesh)
    if (c.vert) return c.vert
    const faceNormals = meshFaceNormals(mesh)
    const positions = mesh.positions
    const cv = mesh.cornerVerts
    const fo = mesh.faceOffsets
    const v2f = vertToFaceMap(mesh)
    const out = new Float32Array(mesh.vertsNum * 3)
    const pos = (v: number): V3 => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
    for (let v = 0; v < mesh.vertsNum; v++) {
        const start = v2f.offsets[v], end = v2f.offsets[v + 1]
        if (start === end) {
            const n = normalize3(pos(v))
            out.set(n, v * 3)
            continue
        }
        let sx = 0, sy = 0, sz = 0
        const pv = pos(v)
        for (let j = start; j < end; j++) {
            const face = v2f.indices[j]
            const s = fo[face], e = fo[face + 1]
            const corner = faceFindCornerFromVert(mesh, face, v)
            const prev = cv[faceCornerPrev(s, e, corner)]
            const next = cv[faceCornerNext(s, e, corner)]
            const dirPrev = normalize3(sub3(pos(prev), pv))
            const dirNext = normalize3(sub3(pos(next), pv))
            const factor = safeAcosApprox(dot3(dirPrev, dirNext))
            sx = f32(sx + f32(faceNormals[face * 3] * factor))
            sy = f32(sy + f32(faceNormals[face * 3 + 1] * factor))
            sz = f32(sz + f32(faceNormals[face * 3 + 2] * factor))
        }
        out.set(normalize3([sx, sy, sz]), v * 3)
    }
    c.vert = out
    return out
}

/**
 * `mesh_normals_varray` (`geometry_component_mesh.cc:123`) - the Normal input on each mesh domain.
 * Corner normals that depend on sharp edges, sharp faces or custom normals
 * (`Mesh::corner_normals()`, `normals_calc_corners`) are not ported yet; a mesh that would need them
 * throws instead of returning face or vertex normals in their place.
 */
export function meshNormalsVArray(mesh: MeshData, domain: AttrDomain): GVArray {
    switch (domain) {
    case AttrDomain.Face:
        return GVArray.fromArray('float3', meshFaceNormals(mesh))
    case AttrDomain.Point:
        return GVArray.fromArray('float3', meshVertNormals(mesh))
    case AttrDomain.Edge: {
        const vn = meshVertNormals(mesh)
        const ev = mesh.edgeVerts
        const out = new Float32Array(mesh.edgesNum * 3)
        for (let e = 0; e < mesh.edgesNum; e++) {
            const a = ev[e * 2] * 3, b = ev[e * 2 + 1] * 3
            out.set(normalize3(interpolate3([vn[a], vn[a + 1], vn[a + 2]], [vn[b], vn[b + 1], vn[b + 2]], 0.5)), e * 3)
        }
        return GVArray.fromArray('float3', out)
    }
    case AttrDomain.Corner: {
        const domainKind = meshNormalsDomain(mesh)
        if (domainKind === 'face') {
            return adaptMeshDomain(mesh, GVArray.fromArray('float3', meshFaceNormals(mesh)), AttrDomain.Face, AttrDomain.Corner)!
        }
        if (domainKind === 'point') {
            return adaptMeshDomain(mesh, GVArray.fromArray('float3', meshVertNormals(mesh)), AttrDomain.Point, AttrDomain.Corner)!
        }
        throw new Error('procedural: corner normals with mixed sharp edges/faces (normals_calc_corners, mesh_normals.cc) are not ported yet')
    }
    default:
        throw new Error(`procedural: no normals on domain ${domain}`)
    }
}

/**
 * `Mesh::normals_domain()` (`mesh_normals.cc:301`). Custom normals (`custom_normal`) are not ported:
 * a mesh carrying them throws rather than silently using the computed normals.
 */
export function meshNormalsDomain(mesh: MeshData): 'face' | 'point' | 'corner' {
    if (mesh.facesNum === 0) return 'point'
    if (mesh.attributes.has(AttrName.customNormal)) {
        throw new Error('procedural: meshes with custom normals (custom_normal) are not supported yet')
    }
    const mix = (name: string, domain: AttrDomain): 'true' | 'false' | 'mixed' => {
        const layer = mesh.attributes.get(name)
        if (!layer || layer.domain !== domain) return 'false'
        const d = layer.data as Uint8Array
        let t = 0
        for (let i = 0; i < d.length; i++) if (d[i]) t++
        return t === 0 ? 'false' : t === d.length ? 'true' : 'mixed'
    }
    const faceMix = mix(AttrName.sharpFace, AttrDomain.Face)
    if (faceMix === 'true') return 'face'
    const edgeMix = mix(AttrName.sharpEdge, AttrDomain.Edge)
    if (edgeMix === 'true') return 'face'
    if (edgeMix === 'false' && faceMix === 'false') return 'point'
    return 'corner'
}
