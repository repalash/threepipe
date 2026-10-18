/**
 * Edges to Face Groups (`node_geo_edges_to_face_groups.cc`) and Face Group Boundaries
 * (`node_geo_mesh_face_group_boundaries.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {invertBooleanField} from '../../fields/booleanField'
import {edgeToFaceMap} from '../../geometry/meshTopology'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/**
 * `FaceSetFromBoundariesInput` (:33): faces joined across the non-boundary edges (`AtomicDisjointSet`), numbered by
 * first occurrence (`calc_reduced_ids`).
 */
class FaceSetFromBoundariesInput extends FieldInput {
    constructor(readonly nonBoundary: GField) {
        super('int32', 'Edges to Face Groups')
    }

    children(): GField[] {
        return [this.nonBoundary]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Edge), mesh.edgesNum).evaluate(this.nonBoundary)
        const map = edgeToFaceMap(mesh)
        const parent = Int32Array.from({length: mesh.facesNum}, (_, i) => i)
        const find = (x: number): number => {
            while (parent[x] !== x) x = parent[x] = parent[parent[x]]
            return x
        }
        for (let e = 0; e < mesh.edgesNum; e++) {
            if (!sel.get(e)) continue
            // `join_indices`: consecutive faces of the edge.
            for (let k = map.offsets[e]; k + 1 < map.offsets[e + 1]; k++) {
                const a = find(map.indices[k]), b = find(map.indices[k + 1])
                if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
            }
        }
        const out = new Int32Array(mesh.facesNum)
        const ids = new Map<number, number>()
        for (let f = 0; f < mesh.facesNum; f++) {
            const r = find(f)
            let id = ids.get(r)
            if (id === undefined) ids.set(r, id = ids.size)
            out[f] = id
        }
        const values = GVArray.fromArray('int32', out)
        return context.domain === AttrDomain.Face ? values : context.attributes().adaptDomain(values, AttrDomain.Face, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeEdgesToFaceGroups',
    label: 'Edges to Face Groups',
    declare(b) {
        b.input('BOOLEAN', 'Boundary Edges').default(true).hideValue().field()
        b.output('INT', 'Face Group ID').field()
    },
    execute(p) {
        p.set('Face Group ID', GField.fromInput(new FaceSetFromBoundariesInput(invertBooleanField(p.field('Boundary Edges')))))
    },
})

/**
 * `BoundaryFieldInput` (:31): edges whose faces are not all in one group. Nothing (false) when the group ID is a
 * single value.
 */
class BoundaryFieldInput extends FieldInput {
    constructor(readonly faceSet: GField) {
        super('bool', 'Face Group Boundaries')
    }

    children(): GField[] {
        return [this.faceSet]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const groups = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), mesh.facesNum).evaluate(this.faceSet)
        if (groups.isSingle) return undefined
        const first = new Int32Array(mesh.edgesNum).fill(-1)
        const out = new Uint8Array(mesh.edgesNum)
        const fo = mesh.faceOffsets, ce = mesh.cornerEdges
        for (let f = 0; f < mesh.facesNum; f++) {
            const g = groups.get(f)
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                const e = ce[c]
                if (first[e] === -1) first[e] = f
                else if (groups.get(first[e]) !== g) out[e] = 1
            }
        }
        const values = GVArray.fromArray('bool', out)
        return context.domain === AttrDomain.Edge ? values : context.attributes().adaptDomain(values, AttrDomain.Edge, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeMeshFaceSetBoundaries',
    label: 'Face Group Boundaries',
    declare(b) {
        b.input('INT', 'Face Group ID', 'Face Set').default(0).hideValue().field()
        b.output('BOOLEAN', 'Boundary Edges').field()
    },
    execute(p) {
        p.set('Boundary Edges', GField.fromInput(new BoundaryFieldInput(p.field('Face Set'))))
    },
})
