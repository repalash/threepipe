/**
 * Mesh field inputs: Face Area (`node_geo_input_mesh_face_area.cc`), Edge Neighbors
 * (`node_geo_input_mesh_edge_neighbors.cc`), Mesh Island (`node_geo_input_mesh_island.cc`), Vertex Neighbors
 * (`node_geo_input_mesh_vertex_neighbors.cc`), Face Neighbors (`node_geo_input_mesh_face_neighbors.cc`), Is Face
 * Planar (`node_geo_input_mesh_face_is_planar.cc`) and Edge Vertices (`node_geo_input_mesh_edge_vertices.cc`).
 *
 * Each is a `bke::MeshFieldInput`: nothing (the type's default) on other geometry, values computed on their
 * native domain and adapted with `mesh.attributes().adapt_domain` unless the C++ returns nothing for other domains.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {faceAreaCalc} from '../../geometry/meshEvaluate'
import {meshFaceNormals} from '../../geometry/meshNormals'
import {edgeToFaceMap} from '../../geometry/meshTopology'
import {GVArray} from '../../geometry/varray'
import type {DataType} from '../../geometry/dataTypes'
import {registerNodeType} from '../../runtime/registry'
import {stdMax, stdMin} from '../util'

const FLT_MAX = 3.4028234663852886e38

/** A `bke::MeshFieldInput` computing `values` on `native` and adapting them (`adapt_domain`) to the context's domain. */
abstract class MeshFieldInput extends FieldInput {
    constructor(type: DataType, name: string, private readonly keyName: string) {
        super(type, name)
    }

    key(): string {
        return this.keyName
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        return this.meshVArray(mesh, context)
    }

    protected adapt(context: FieldContext, values: GVArray, from: AttrDomain): GVArray | undefined {
        return from === context.domain ? values : context.attributes().adaptDomain(values, from, context.domain)
    }

    abstract meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined
}

// region Face Area

/** `FaceAreaFieldInput` (`node_geo_input_mesh_face_area.cc:33`), `construct_face_area_varray` (:19). */
class FaceAreaFieldInput extends MeshFieldInput {
    constructor() {
        super('float', 'Face Area Field', 'mesh-face-area')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const fo = mesh.faceOffsets, cv = mesh.cornerVerts, positions = mesh.positions
        const out = new Float32Array(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) out[f] = faceAreaCalc(positions, cv, fo[f], fo[f + 1])
        return this.adapt(context, GVArray.fromArray('float', out), AttrDomain.Face)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Face
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshFaceArea',
    label: 'Face Area',
    declare(b) {
        b.output('FLOAT', 'Area').field()
    },
    // `node_geo_exec` (:61).
    execute(p) {
        p.set('Area', GField.fromInput(new FaceAreaFieldInput()))
    },
})

// endregion

// region Edge Neighbors

/** `EdgeNeighborCountFieldInput` (`node_geo_input_mesh_edge_neighbors.cc:20`): `count_indices(corner_edges)`. */
class EdgeNeighborCountFieldInput extends MeshFieldInput {
    constructor() {
        super('int32', 'Edge Neighbor Count Field', 'mesh-edge-neighbors')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const counts = new Int32Array(mesh.edgesNum)
        const ce = mesh.cornerEdges
        for (let c = 0; c < ce.length; c++) counts[ce[c]]++
        return this.adapt(context, GVArray.fromArray('int32', counts), AttrDomain.Edge)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Edge
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshEdgeNeighbors',
    label: 'Edge Neighbors',
    declare(b) {
        b.output('INT', 'Face Count').field()
    },
    // `node_geo_exec` (:49).
    execute(p) {
        p.set('Face Count', GField.fromInput(new EdgeNeighborCountFieldInput()))
    },
})

// endregion

// region Mesh Island

/**
 * `AtomicDisjointSet` over the vertices joined along every edge (`node_geo_input_mesh_island.cc:36-41`). The
 * union order does not matter for the results Blender reads: `calc_reduced_ids` numbers the sets by their first
 * element (`blenlib/intern/atomic_disjoint_set.cc:37`) and `count_sets` counts the roots (:97).
 */
function vertexIslands(mesh: MeshData): {ids: Int32Array, count: number} {
    const n = mesh.vertsNum
    const parent = new Int32Array(n)
    for (let i = 0; i < n; i++) parent[i] = i
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]]
            x = parent[x]
        }
        return x
    }
    const ev = mesh.edgeVerts
    for (let e = 0; e < mesh.edgesNum; e++) {
        const a = find(ev[e * 2]), b = find(ev[e * 2 + 1])
        if (a !== b) parent[a < b ? a : b] = a < b ? b : a
    }
    const ids = new Int32Array(n)
    const idByRoot = new Map<number, number>()
    for (let i = 0; i < n; i++) {
        const root = find(i)
        let id = idByRoot.get(root)
        if (id === undefined) idByRoot.set(root, id = idByRoot.size)
        ids[i] = id
    }
    return {ids, count: idByRoot.size}
}

/** `IslandFieldInput` (`node_geo_input_mesh_island.cc:26`). */
class IslandFieldInput extends MeshFieldInput {
    constructor() {
        super('int32', 'Island Index', 'mesh-island-index')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        return this.adapt(context, GVArray.fromArray('int32', vertexIslands(mesh).ids), AttrDomain.Point)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

/** `IslandCountFieldInput` (`node_geo_input_mesh_island.cc:68`): the count as a single value on every domain. */
class IslandCountFieldInput extends MeshFieldInput {
    constructor() {
        super('int32', 'Island Count', 'mesh-island-count')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        return GVArray.fromSingle('int32', context.size, [vertexIslands(mesh).count])
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshIsland',
    label: 'Mesh Island',
    declare(b) {
        b.output('INT', 'Island Index').field()
        b.output('INT', 'Island Count').field()
    },
    // `node_geo_exec` (:106).
    execute(p) {
        if (p.outputUsed('Island Index')) p.set('Island Index', GField.fromInput(new IslandFieldInput()))
        if (p.outputUsed('Island Count')) p.set('Island Count', GField.fromInput(new IslandCountFieldInput()))
    },
})

// endregion

// region Vertex Neighbors

/**
 * `VertexCountFieldInput` / `VertexFaceCountFieldInput` (`node_geo_input_mesh_vertex_neighbors.cc:25`, `:53`):
 * `count_indices` of the edge vertices / corner vertices, on the point domain only (other domains: nothing).
 */
class VertexNeighborsFieldInput extends MeshFieldInput {
    constructor(private readonly faces: boolean) {
        super('int32', faces ? 'Vertex Face Count Field' : 'Vertex Count Field', faces ? 'mesh-vertex-face-count' : 'mesh-vertex-count')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        if (context.domain !== AttrDomain.Point) return undefined
        const counts = new Int32Array(mesh.vertsNum)
        const indices = this.faces ? mesh.cornerVerts : mesh.edgeVerts
        for (let i = 0; i < indices.length; i++) counts[indices[i]]++
        return GVArray.fromArray('int32', counts)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshVertexNeighbors',
    label: 'Vertex Neighbors',
    declare(b) {
        b.output('INT', 'Vertex Count').field()
        b.output('INT', 'Face Count').field()
    },
    // `node_geo_exec` (:83).
    execute(p) {
        p.set('Vertex Count', GField.fromInput(new VertexNeighborsFieldInput(false)))
        p.set('Face Count', GField.fromInput(new VertexNeighborsFieldInput(true)))
    },
})

// endregion

// region Face Neighbors

/** `FaceNeighborCountFieldInput` (`node_geo_input_mesh_face_neighbors.cc:74`), `construct_neighbor_count_varray` (:55). */
class FaceNeighborCountFieldInput extends MeshFieldInput {
    constructor() {
        super('int32', 'Face Neighbor Count Field', 'mesh-face-neighbor-count')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const map = edgeToFaceMap(mesh)
        const fo = mesh.faceOffsets, ce = mesh.cornerEdges
        const out = new Int32Array(mesh.facesNum)
        const unique = new Set<number>()
        for (let f = 0; f < mesh.facesNum; f++) {
            // `unique_num` (:39) of the faces of the face's edges, minus the face itself.
            unique.clear()
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                const e = ce[c]
                for (let j = map.offsets[e]; j < map.offsets[e + 1]; j++) unique.add(map.indices[j])
            }
            out[f] = unique.size - 1
        }
        return this.adapt(context, GVArray.fromArray('int32', out), AttrDomain.Face)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Face
    }
}

/** `FaceVertexCountFieldInput` (`node_geo_input_mesh_face_neighbors.cc:110`), `construct_vertex_count_varray` (:100). */
class FaceVertexCountFieldInput extends MeshFieldInput {
    constructor() {
        super('int32', 'Vertex Count Field', 'mesh-face-vertex-count')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const fo = mesh.faceOffsets
        const out = new Int32Array(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) out[f] = fo[f + 1] - fo[f]
        return this.adapt(context, GVArray.fromArray('int32', out), AttrDomain.Face)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Face
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshFaceNeighbors',
    label: 'Face Neighbors',
    declare(b) {
        b.output('INT', 'Vertex Count').field()
        b.output('INT', 'Face Count').field()
    },
    // `node_geo_exec` (:133).
    execute(p) {
        p.set('Vertex Count', GField.fromInput(new FaceVertexCountFieldInput()))
        p.set('Face Count', GField.fromInput(new FaceNeighborCountFieldInput()))
    },
})

// endregion

// region Is Face Planar

/** `PlanarFieldInput` (`node_geo_input_mesh_face_is_planar.cc:30`). */
class PlanarFieldInput extends MeshFieldInput {
    constructor(private readonly threshold: GField) {
        super('bool', 'Planar', `mesh-face-planar:${threshold.node.id}:${threshold.index}`)
    }

    children(): GField[] {
        return [this.threshold]
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const positions = mesh.positions, fo = mesh.faceOffsets, cv = mesh.cornerVerts
        const normals = meshFaceNormals(mesh)
        const faceContext = new FieldContext('mesh', mesh, AttrDomain.Face)
        const thresholds = new FieldEvaluation(faceContext, mesh.facesNum).evaluate(this.threshold)
        const out = new Uint8Array(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) {
            if (fo[f + 1] - fo[f] <= 3) {
                out[f] = 1
                continue
            }
            const nx = normals[f * 3], ny = normals[f * 3 + 1], nz = normals[f * 3 + 2]
            let min = FLT_MAX
            let max = -FLT_MAX
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                const v = cv[c] * 3
                const dot = f32(f32(f32(nx * positions[v]) + f32(ny * positions[v + 1])) + f32(nz * positions[v + 2]))
                max = stdMax(dot, max)
                min = stdMin(dot, min)
            }
            out[f] = f32(max - min) < f32(thresholds.get(f) / 2) ? 1 : 0
        }
        return this.adapt(context, GVArray.fromArray('bool', out), AttrDomain.Face)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Face
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshFaceIsPlanar',
    label: 'Is Face Planar',
    declare(b) {
        b.input('FLOAT', 'Threshold').default(0.01).min(0).subtype('DISTANCE').field()
        b.output('BOOLEAN', 'Planar').field()
    },
    // `geo_node_exec` (:101).
    execute(p) {
        p.set('Planar', GField.fromInput(new PlanarFieldInput(p.field('Threshold'))))
    },
})

// endregion

// region Edge Vertices

/** `EdgeVertsInput` (`node_geo_input_mesh_edge_vertices.cc:43`): edge domain only. */
class EdgeVertsInput extends MeshFieldInput {
    constructor(private readonly second: boolean) {
        super('int32', 'Edge Vertices Field', second ? 'mesh-edge-vert-2' : 'mesh-edge-vert-1')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        if (context.domain !== AttrDomain.Edge) return undefined
        const ev = mesh.edgeVerts
        const out = new Int32Array(mesh.edgesNum)
        for (let e = 0; e < mesh.edgesNum; e++) out[e] = ev[e * 2 + (this.second ? 1 : 0)]
        return GVArray.fromArray('int32', out)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Edge
    }
}

/** `EdgePositionFieldInput` (`node_geo_input_mesh_edge_vertices.cc:94`): adapted from the edge domain. */
class EdgePositionFieldInput extends MeshFieldInput {
    constructor(private readonly second: boolean) {
        super('float3', 'Edge Position Field', second ? 'mesh-edge-position-2' : 'mesh-edge-position-1')
    }

    meshVArray(mesh: MeshData, context: FieldContext): GVArray | undefined {
        const ev = mesh.edgeVerts, positions = mesh.positions
        const out = new Float32Array(mesh.edgesNum * 3)
        for (let e = 0; e < mesh.edgesNum; e++) {
            const v = ev[e * 2 + (this.second ? 1 : 0)] * 3
            out[e * 3] = positions[v]
            out[e * 3 + 1] = positions[v + 1]
            out[e * 3 + 2] = positions[v + 2]
        }
        return this.adapt(context, GVArray.fromArray('float3', out), AttrDomain.Edge)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Edge
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshEdgeVertices',
    label: 'Edge Vertices',
    declare(b) {
        b.output('INT', 'Vertex Index 1').field()
        b.output('INT', 'Vertex Index 2').field()
        b.output('VECTOR', 'Position 1').field()
        b.output('VECTOR', 'Position 2').field()
    },
    // `node_geo_exec` (:124).
    execute(p) {
        p.set('Vertex Index 1', GField.fromInput(new EdgeVertsInput(false)))
        p.set('Vertex Index 2', GField.fromInput(new EdgeVertsInput(true)))
        p.set('Position 1', GField.fromInput(new EdgePositionFieldInput(false)))
        p.set('Position 2', GField.fromInput(new EdgePositionFieldInput(true)))
    },
})

// endregion
