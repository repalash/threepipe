/** Pack UV Islands (`GeometryNodeUVPackIslands`) - `nodes/geometry/nodes/node_geo_uv_pack_islands.cc` (Blender 5.2.2). */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {ParamHandle} from '../../geometry/uvParametrizer'
import {defaultPackParams, RotationMethod, ShapeMethod} from '../../geometry/uvPack'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

const SHAPES: Record<string, ShapeMethod> = {'Bounding Box': ShapeMethod.AABB, 'Convex Hull': ShapeMethod.CONVEX, 'Exact Shape': ShapeMethod.CONCAVE}

/** `PackIslandsFieldInput` (:150) with `construct_uv_gvarray` (:86). */
class PackIslandsFieldInput extends FieldInput {
    constructor(readonly selection: GField, readonly uvField: GField, readonly rotate: boolean, readonly margin: number, readonly shape: ShapeMethod,
        readonly bottom: number[], readonly top: number[]) {
        super('float3', 'Pack UV Islands Field')
    }

    children(): GField[] {
        return [this.selection, this.uvField]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), mesh.facesNum).evaluate(this.selection)
        const faces: number[] = []
        for (let f = 0; f < mesh.facesNum; f++) if (sel.get(f)) faces.push(f)
        // An empty selection returns an empty VArray (`return {}`): the field evaluates to the default value.
        if (!faces.length) return undefined
        const uvValues = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Corner), mesh.cornersNum).evaluate(this.uvField)
        const uv = new Float32Array(mesh.cornersNum * 3)
        for (let c = 0; c < mesh.cornersNum; c++) for (let k = 0; k < 3; k++) uv[c * 3 + k] = uvValues.get(c, k)
        const handle = new ParamHandle(uv, 3)
        const fo = mesh.faceOffsets, cv = mesh.cornerVerts, pos = mesh.positions
        for (const f of faces) {
            const n = fo[f + 1] - fo[f]
            const vkeys: number[] = [], co: Float32Array[] = [], corners: number[] = []
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                vkeys.push(cv[c])
                co.push(pos.subarray(cv[c] * 3, cv[c] * 3 + 3))
                corners.push(c)
            }
            handle.faceAddPublic(f, vkeys, co, corners, new Array(n).fill(false), new Array(n).fill(false))
        }
        handle.constructEnd(true, true)
        const params = defaultPackParams()
        params.shapeMethod = this.shape
        params.rotateMethod = this.rotate ? RotationMethod.ANY : RotationMethod.NONE
        params.margin = this.margin
        if (this.top[0] > this.bottom[0] && this.top[1] > this.bottom[1]) {
            params.udimBaseOffset = [this.bottom[0], this.bottom[1]]
            params.targetExtent = f32(this.top[1] - this.bottom[1])
            params.targetAspectY = f32(f32(this.top[0] - this.bottom[0]) / f32(this.top[1] - this.bottom[1]))
        }
        handle.pack(params)
        handle.flush()
        const values = GVArray.fromArray('float3', uv)
        return context.domain === AttrDomain.Corner ? values : context.attributes().adaptDomain(values, AttrDomain.Corner, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeUVPackIslands',
    label: 'Pack UV Islands',
    declare(b) {
        b.input('VECTOR', 'UV').hideValue().field()
        b.output('VECTOR', 'UV').field()
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Margin').default(0.001).min(0).max(1)
        b.input('BOOLEAN', 'Rotate').default(true)
        b.input('MENU', 'Method').default('Bounding Box')
        b.input('VECTOR', 'Bottom Left').default([0, 0]).subtype('XYZ2D')
        b.input('VECTOR', 'Top Right').default([1, 1]).subtype('XYZ2D')
    },
    // `node_geo_exec` (:210).
    execute(p) {
        const method = p.string('Method')
        const shape = SHAPES[method]
        if (shape === undefined) throw new Error(`Pack UV Islands: method '${method}' is not a menu item`)
        p.set('UV', GField.fromInput(new PackIslandsFieldInput(p.field('Selection'), p.field('UV'), p.bool('Rotate'), p.float('Margin'), shape,
            p.vector('Bottom Left'), p.vector('Top Right'))))
    },
})
