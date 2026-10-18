import {describe, expect, it} from 'vitest'
import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {copyMesh, meshRuntime, meshTagPositionsChanged, meshTagTopologyChanged} from './meshRuntime'
import {meshFaceNormals, meshVertNormals, meshVertNormalsAssign} from './meshNormals'
import {meshBoundsMinMax, meshBoundsSetEager} from './meshBounds'
import {meshBVHVerts, meshCornerTris} from './meshBVH'
import {vertToFaceMap} from './meshTopology'
import {GeometrySet} from './GeometrySet'
import {meshTransform, meshTranslate} from './transform'

/** 2 x 1 quads: verts 0..5, faces [0,1,4,3], [1,2,5,4]. */
function twoQuads(): MeshData {
    return MeshData.fromFaces({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0],
        faces: [[0, 1, 4, 3], [1, 2, 5, 4]],
    })
}

const ASSIGNED = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0])

describe('mesh runtime caches (bke::MeshRuntime)', () => {
    it('copies share the caches (mesh_copy_data): assigned normals and eager bounds survive a copy', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        meshBoundsSetEager(mesh, {min: [-5, -5, -5], max: [5, 5, 5]})
        const faces = meshFaceNormals(mesh)
        const v2f = vertToFaceMap(mesh)
        const tris = meshCornerTris(mesh)
        const copy = copyMesh(mesh)
        expect(copy).not.toBe(mesh)
        expect(meshVertNormals(copy)).toBe(ASSIGNED)
        expect(meshFaceNormals(copy)).toBe(faces)
        expect(vertToFaceMap(copy)).toBe(v2f)
        expect(meshCornerTris(copy)).toBe(tris)
        expect(meshBoundsMinMax(copy)).toEqual({min: [-5, -5, -5], max: [5, 5, 5]})
    })

    it('a copy made for writing (GeometrySet.meshForWrite) keeps them too', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        const g = GeometrySet.fromMesh(mesh).copy()
        const w = g.meshForWrite()!
        expect(w).not.toBe(mesh)
        expect(meshVertNormals(w)).toBe(ASSIGNED)
    })

    it('tag_positions_changed drops normals, triangulation, trees and bounds on that mesh only', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        meshBoundsSetEager(mesh, {min: [-5, -5, -5], max: [5, 5, 5]})
        meshBVHVerts(mesh)
        const v2f = vertToFaceMap(mesh)
        const copy = copyMesh(mesh)
        meshTagPositionsChanged(copy)
        const r = meshRuntime(copy)
        expect(r.normals).toEqual({})
        expect(r.bounds).toBeUndefined()
        expect(r.bvh.verts).toBeUndefined()
        expect(r.bvh.cornerTris).toBeUndefined()
        // Topology is unchanged (`tag_positions_changed` keeps the maps).
        expect(vertToFaceMap(copy)).toBe(v2f)
        expect(meshVertNormals(copy)).not.toBe(ASSIGNED)
        expect(meshBoundsMinMax(copy)).toEqual({min: [0, 0, 0], max: [2, 1, 0]})
        // The source keeps its caches.
        expect(meshVertNormals(mesh)).toBe(ASSIGNED)
        expect(meshBoundsMinMax(mesh)).toEqual({min: [-5, -5, -5], max: [5, 5, 5]})
    })

    it('tag_topology_changed drops every cache', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        const v2f = vertToFaceMap(mesh)
        meshTagTopologyChanged(mesh)
        expect(vertToFaceMap(mesh)).not.toBe(v2f)
        expect(meshVertNormals(mesh)).not.toBe(ASSIGNED)
    })

    it('writing positions through the accessor tags them (changed_tags)', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        const g = GeometrySet.fromMesh(mesh)
        const acc = g.attributesForWrite('mesh')!
        acc.layerForWrite('position')!.data[2] = 1
        expect(meshVertNormals(g.mesh!)).not.toBe(ASSIGNED)
        // Other attributes do not drop the normals.
        meshVertNormalsAssign(g.mesh!, ASSIGNED)
        acc.add('w', AttrDomain.Point, 'float')
        acc.layerForWrite('w')
        acc.remove('w')
        expect(meshVertNormals(g.mesh!)).toBe(ASSIGNED)
    })

    it('mesh_translate moves cached bounds along; mesh_transform drops them', () => {
        const mesh = twoQuads()
        meshVertNormalsAssign(mesh, ASSIGNED)
        meshBoundsSetEager(mesh, {min: [-5, -5, -5], max: [5, 5, 5]})
        meshTranslate(mesh, [1, 2, 3])
        expect(meshBoundsMinMax(mesh)).toEqual({min: [-4, -3, -2], max: [6, 7, 8]})
        // `tag_positions_changed_uniformly` keeps the normals.
        expect(meshVertNormals(mesh)).toBe(ASSIGNED)
        meshTransform(mesh, [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1])
        expect(meshBoundsMinMax(mesh)).toEqual({min: [2, 4, 6], max: [6, 6, 6]})
        expect(meshVertNormals(mesh)).not.toBe(ASSIGNED)
    })
})
