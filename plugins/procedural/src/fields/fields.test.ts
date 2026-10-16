import {describe, expect, it} from 'vitest'
import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {GeometrySet} from '../geometry/GeometrySet'
import {elementwise, FieldOperation, GField} from './field'
import {evaluateConstantField, evaluateFields} from './evaluate'
import {AttributeFieldInput, EvaluateAtIndexInput, EvaluateOnDomainInput, IDAttributeFieldInput, IndexFieldInput} from './inputs'
import {FieldContext} from './context'
import {captureFieldsOnGeometry} from './capture'

function grid(): MeshData {
    return MeshData.fromFaces({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0],
        faces: [[0, 1, 4, 3], [1, 2, 5, 4]],
    })
}

const addFloat = elementwise('Add', ['float', 'float'], ['float'], (i, o) => { o[0][0] = i[0][0] + i[1][0] })
const separateX = elementwise('Separate X', ['float3'], ['float'], (i, o) => { o[0][0] = i[0][0] })

describe('field evaluation (field_evaluation.cc)', () => {
    it('reads the position attribute, interpolated to the context domain', () => {
        const mesh = grid()
        const x = new FieldOperation(separateX, [GField.fromInput(new AttributeFieldInput('position', 'float3'))]).output()
        const [onFaces] = evaluateFields(new FieldContext('mesh', mesh, AttrDomain.Face), [x])
        expect(Array.from(onFaces.materialize())).toEqual([0.5, 1.5])
    })

    it('constant subtrees stay single values and fold', () => {
        const c = new FieldOperation(addFloat, [GField.constant('float', [1]), GField.constant('float', [2])]).output()
        expect(c.dependsOnInput).toBe(false)
        expect(evaluateConstantField(c)).toEqual([3])
        const [v] = evaluateFields(new FieldContext('mesh', grid(), AttrDomain.Point), [c])
        expect(v.isSingle).toBe(true)
        expect(v.size).toBe(6)
    })

    it('ID falls back to the index without an "id" attribute, and only on points/instances reads it', () => {
        const mesh = grid()
        mesh.attributes.add({name: 'id', domain: AttrDomain.Point, type: 'int32', data: [10, 11, 12, 13, 14, 15]})
        const id = GField.fromInput(new IDAttributeFieldInput())
        expect(Array.from(evaluateFields(new FieldContext('mesh', mesh, AttrDomain.Point), [id])[0].materialize())).toEqual([10, 11, 12, 13, 14, 15])
        expect(Array.from(evaluateFields(new FieldContext('mesh', mesh, AttrDomain.Face), [id])[0].materialize())).toEqual([0, 1])
    })

    it('a missing attribute evaluates to the type default', () => {
        const [v] = evaluateFields(new FieldContext('mesh', grid(), AttrDomain.Point), [GField.fromInput(new AttributeFieldInput('nope', 'float'))])
        expect(v.isSingle).toBe(true)
        expect(v.single).toEqual([0])
    })

    it('Evaluate on Domain evaluates on the source domain then adapts', () => {
        const index = GField.fromInput(new IndexFieldInput())
        const toFloat = elementwise('int->float', ['int32'], ['float'], (i, o) => { o[0][0] = i[0][0] })
        const f = new FieldOperation(toFloat, [index]).output()
        const onFaceThenPoint = GField.fromInput(new EvaluateOnDomainInput(f, AttrDomain.Face))
        const [v] = evaluateFields(new FieldContext('mesh', grid(), AttrDomain.Point), [onFaceThenPoint])
        expect(Array.from(v.materialize())).toEqual([0, 0.5, 1, 0, 0.5, 1])
    })

    it('Evaluate at Index gathers, with the default outside the range', () => {
        const index = GField.fromInput(new IndexFieldInput())
        const plus4 = elementwise('+4', ['int32'], ['int32'], (i, o) => { o[0][0] = i[0][0] + 4 })
        const at = GField.fromInput(new EvaluateAtIndexInput(new FieldOperation(plus4, [index]).output(), index, AttrDomain.Point))
        const [v] = evaluateFields(new FieldContext('mesh', grid(), AttrDomain.Point), [at])
        expect(Array.from(v.materialize())).toEqual([4, 5, 0, 0, 0, 0])
    })
})

describe('capturing fields into attributes (try_capture_fields_on_geometry)', () => {
    it('stores a field, writes only selected elements of an existing attribute, and refuses wrong built-in shapes', () => {
        const g = GeometrySet.fromMesh(grid())
        const x = new FieldOperation(separateX, [GField.fromInput(new AttributeFieldInput('position', 'float3'))]).output()
        expect(captureFieldsOnGeometry(g, 'mesh', ['x'], AttrDomain.Point, undefined, [x])).toBe(true)
        expect(Array.from(g.mesh!.attributes.get('x')!.data)).toEqual([0, 1, 2, 0, 1, 2])
        const isEven = elementwise('even', ['int32'], ['bool'], (i, o) => { o[0][0] = i[0][0] % 2 === 0 ? 1 : 0 })
        const sel = new FieldOperation(isEven, [GField.fromInput(new IndexFieldInput())]).output()
        expect(captureFieldsOnGeometry(g, 'mesh', ['x'], AttrDomain.Point, sel, [GField.constant('float', [9])])).toBe(true)
        expect(Array.from(g.mesh!.attributes.get('x')!.data)).toEqual([9, 1, 9, 0, 9, 2])
        expect(captureFieldsOnGeometry(g, 'mesh', ['material_index'], AttrDomain.Point, undefined, [GField.constant('int32', [1])])).toBe(false)
        // The validator clamps material_index (mesh_attributes.cc:802).
        expect(captureFieldsOnGeometry(g, 'mesh', ['material_index'], AttrDomain.Face, undefined, [GField.constant('int32', [-4])])).toBe(true)
        expect(Array.from(g.mesh!.attributes.get('material_index')!.data)).toEqual([0, 0])
    })
})
