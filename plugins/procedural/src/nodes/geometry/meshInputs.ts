/** Mesh topology inputs: Edge Angle (`node_geo_input_mesh_edge_angle.cc`). */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {cornerTrisCalc} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {angleNormalizedV3V3, dot3, normalize3} from '../../blender/math/vec'
import {FieldContext, FieldInput, GField} from '../../fields'
import {faceNormalCalc} from '../../geometry/meshNormals'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `create_edge_map` (:28): the two faces of each edge; -1 missing, -2 more than two. */
function createEdgeMap(mesh: MeshData): Int32Array {
    const map = new Int32Array(mesh.edgesNum * 2).fill(-1)
    const fo = mesh.faceOffsets, ce = mesh.cornerEdges
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let c = fo[f]; c < fo[f + 1]; c++) {
            const e = ce[c]
            if (map[e * 2] === -1) map[e * 2] = f
            else if (map[e * 2 + 1] === -1) map[e * 2 + 1] = f
            else map[e * 2] = map[e * 2 + 1] = -2
        }
    }
    return map
}

function faceNormal(mesh: MeshData, f: number): [number, number, number] {
    return faceNormalCalc(mesh.positions, mesh.cornerVerts, mesh.faceOffsets[f], mesh.faceOffsets[f + 1])
}

/** `find_other_vert_of_edge_triangle` (:87). */
function otherVertOfEdgeTriangle(mesh: MeshData, tris: Int32Array, face: number, a: number, b: number): number {
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts
    // `face_triangles_range`: `poly_to_tri_count(face, start)` .. + size - 2.
    const first = fo[face] - 2 * face
    for (let t = first; t < first + (fo[face + 1] - fo[face]) - 2; t++) {
        const v = [cv[tris[t * 3]], cv[tris[t * 3 + 1]], cv[tris[t * 3 + 2]]]
        const same = (x: number, y: number) => (x === a && y === b) || (x === b && y === a)
        if (same(v[0], v[1])) return v[2]
        if (same(v[1], v[2])) return v[0]
        if (same(v[2], v[0])) return v[1]
    }
    throw new Error('procedural: Edge Angle: edge not found in its face triangles')
}

class EdgeAngleFieldInput extends FieldInput {
    constructor(private readonly signed: boolean) {
        super('float', signed ? 'Signed Angle Field' : 'Unsigned Angle Field')
    }

    key(): string {
        return this.signed ? 'edge-angle-signed' : 'edge-angle'
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const map = createEdgeMap(mesh)
        const out = new Float32Array(mesh.edgesNum)
        const tris = this.signed ? cornerTrisCalc(mesh) : new Int32Array()
        const positions = mesh.positions, edges = mesh.edgeVerts
        for (let i = 0; i < mesh.edgesNum; i++) {
            const f1 = map[i * 2], f2 = map[i * 2 + 1]
            if (f1 < 0 || f2 < 0) continue
            const n1 = faceNormal(mesh, f1), n2 = faceNormal(mesh, f2)
            const angle = angleNormalizedV3V3(n1, n2)
            if (!this.signed) {
                out[i] = angle
                continue
            }
            // :143-167: the other vertex of the edge's triangle in face 2 tells concave from convex.
            const a = edges[i * 2], b = edges[i * 2 + 1]
            const mid = [0, 1, 2].map(k => f32(f32(positions[a * 3 + k] + positions[b * 3 + k]) * 0.5))
            const other = otherVertOfEdgeTriangle(mesh, tris, f2, a, b)
            const tangent = normalize3([0, 1, 2].map(k => f32(positions[other * 3 + k] - mid[k])))
            const concavity = dot3(n1, tangent)
            out[i] = angle === 0 || angle === 2 * Math.PI || concavity < 0 ? angle : -angle
        }
        const varray = GVArray.fromArray('float', out)
        return context.domain === AttrDomain.Edge ? varray : context.attributes().adaptDomain(varray, AttrDomain.Edge, context.domain)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Edge
    }
}

registerNodeType({
    idname: 'GeometryNodeInputMeshEdgeAngle',
    label: 'Edge Angle',
    declare(b) {
        b.output('FLOAT', 'Unsigned Angle').field()
        b.output('FLOAT', 'Signed Angle').field()
    },
    execute(p) {
        if (p.outputUsed('Unsigned Angle')) p.set('Unsigned Angle', GField.fromInput(new EdgeAngleFieldInput(false)))
        if (p.outputUsed('Signed Angle')) p.set('Signed Angle', GField.fromInput(new EdgeAngleFieldInput(true)))
    },
})
