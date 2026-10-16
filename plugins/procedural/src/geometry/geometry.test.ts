import {describe, expect, it} from 'vitest'
import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {createDefaultMixer, createPropagationMixer, mix2} from './mixers'
import {adaptMeshDomain} from './meshDomains'
import {GVArray} from './varray'
import {meshFaceNormals, meshVertNormals, meshNormalsVArray} from './meshNormals'
import {convertVArray, isConvertible} from './typeConversions'
import {GeometrySet} from './GeometrySet'
import {Instances, PointCloud, CurvesGeometry} from './components'
import {quatFromExpmap, quatToExpmap} from '../blender/math/quaternion'
import {eulerToQuat, mat4FromLocQuatScale, mat4ToLocQuatScaleSafe, quatToMat3, mat3ToEuler} from '../blender/math/matrix'
import {safeAcosApprox} from '../blender/math/base'

/** 2 x 1 quads: verts 0..5, faces [0,1,4,3], [1,2,5,4]. */
function twoQuads(): MeshData {
    return MeshData.fromFaces({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0],
        faces: [[0, 1, 4, 3], [1, 2, 5, 4]],
    })
}

describe('attribute mixers (BKE_attribute_math.hh)', () => {
    it('SimpleMixer averages floats and leaves untouched elements at the default', () => {
        const buf = new Float32Array(2)
        const m = createDefaultMixer('float', buf)
        m.mixIn(0, [1], 0)
        m.mixIn(0, [2], 0)
        m.finalize()
        expect(Array.from(buf)).toEqual([1.5, 0])
    })

    it('int mixing accumulates in double and rounds half away from zero (double_to_int, :329)', () => {
        const buf = new Int32Array(2)
        const m = createDefaultMixer('int32', buf)
        m.mixIn(0, [-2], 0)
        m.mixIn(0, [-3], 0)
        m.mixIn(1, [2], 0)
        m.mixIn(1, [3], 0)
        m.finalize()
        expect(Array.from(buf)).toEqual([-3, 3])
    })

    it('bool default mixing is "at least half", propagation mixing is "or"', () => {
        const a = new Uint8Array(1)
        const d = createDefaultMixer('bool', a)
        d.mixIn(0, [1], 0)
        d.mixIn(0, [0], 0)
        d.mixIn(0, [0], 0)
        d.finalize()
        expect(a[0]).toBe(0)
        const b = new Uint8Array(1)
        const p = createPropagationMixer('bool', b)
        p.mixIn(0, [0], 0)
        p.mixIn(0, [1], 0)
        p.finalize()
        expect(b[0]).toBe(1)
    })

    it('ColorGeometry4f mixer defaults untouched elements to opaque black (attribute_math.cc:80)', () => {
        const buf = new Float32Array(4)
        createDefaultMixer('float4', buf).finalize()
        expect(Array.from(buf)).toEqual([0, 0, 0, 1])
    })

    it('quaternions mix through the exponential map and default to identity', () => {
        const q = eulerToQuat([0, 0, 0.5])
        const buf = new Float32Array(8)
        const m = createDefaultMixer('quaternion', buf)
        m.mixIn(0, q, 0)
        m.mixIn(0, q, 0)
        m.finalize()
        expect(buf[0]).toBeCloseTo(q[0], 6)
        expect(buf[3]).toBeCloseTo(q[3], 6)
        expect(Array.from(buf.subarray(4))).toEqual([1, 0, 0, 0])
    })

    it('mix2 for ints rounds, for bools thresholds at one half', () => {
        const out = new Int32Array(1)
        mix2('int32', 0.5, [1], 0, [2], 0, out, 0)
        expect(out[0]).toBe(2)
        const ob = new Uint8Array(1)
        mix2('bool', 0.5, [1], 0, [0], 0, ob, 0)
        expect(ob[0]).toBe(1)
    })
})

describe('mesh domain interpolation (mesh_attributes.cc)', () => {
    it('point -> face averages the face corners', () => {
        const mesh = twoQuads()
        const v = GVArray.fromArray('float', new Float32Array([0, 1, 2, 3, 4, 5]))
        const f = adaptMeshDomain(mesh, v, AttrDomain.Point, AttrDomain.Face)!
        expect([f.get(0), f.get(1)]).toEqual([2, 3])
    })

    it('face -> point averages the faces around each vertex', () => {
        const mesh = twoQuads()
        const v = GVArray.fromArray('float', new Float32Array([10, 20]))
        const p = adaptMeshDomain(mesh, v, AttrDomain.Face, AttrDomain.Point)!
        expect(Array.from(p.materialize())).toEqual([10, 15, 20, 10, 15, 20])
    })

    it('booleans: point -> face needs all points, face -> point any face, point -> edge both ends', () => {
        const mesh = twoQuads()
        const pts = GVArray.fromArray('bool', new Uint8Array([1, 1, 0, 1, 1, 1]))
        expect(Array.from(adaptMeshDomain(mesh, pts, AttrDomain.Point, AttrDomain.Face)!.materialize())).toEqual([1, 0])
        const faces = GVArray.fromArray('bool', new Uint8Array([0, 1]))
        expect(Array.from(adaptMeshDomain(mesh, faces, AttrDomain.Face, AttrDomain.Point)!.materialize())).toEqual([0, 1, 1, 0, 1, 1])
        const edges = adaptMeshDomain(mesh, pts, AttrDomain.Point, AttrDomain.Edge)!
        const ev = mesh.edgeVerts
        for (let e = 0; e < mesh.edgesNum; e++) {
            expect(edges.get(e)).toBe(pts.get(ev[e * 2]) && pts.get(ev[e * 2 + 1]) ? 1 : 0)
        }
    })

    it('corner -> point averages the corner of each face around the vertex', () => {
        const mesh = twoQuads()
        const corners = new Float32Array(mesh.cornersNum)
        for (let k = 0; k < corners.length; k++) corners[k] = k
        const p = adaptMeshDomain(mesh, GVArray.fromArray('float', corners), AttrDomain.Corner, AttrDomain.Point)!
        // Vertex 1 is corner 1 of face 0 and corner 4 of face 1.
        expect(p.get(1)).toBe(2.5)
    })

    it('a single value stays single unless loose elements would need the default', () => {
        const mesh = twoQuads()
        const single = GVArray.fromSingle('float', 2, [7])
        const r = adaptMeshDomain(mesh, single, AttrDomain.Face, AttrDomain.Point)!
        expect(r.isSingle).toBe(true)
        expect(r.size).toBe(6)
        const loose = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5], faces: [[0, 1, 2]]})
        const r2 = adaptMeshDomain(loose, GVArray.fromSingle('float', 1, [7]), AttrDomain.Face, AttrDomain.Point)!
        expect(r2.isSingle).toBe(false)
        expect(Array.from(r2.materialize())).toEqual([7, 7, 7, 0])
    })
})

describe('mesh normals (mesh_normals.cc)', () => {
    it('face normals are the normalised Newell normal', () => {
        const n = meshFaceNormals(twoQuads())
        expect(Array.from(n)).toEqual([0, 0, 1, 0, 0, 1])
    })

    it('vertex normals weight face normals by the corner angle (safe_acos_approx)', () => {
        // Corner of a cube: three faces at right angles; the weights are equal.
        const mesh = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
            faces: [[0, 2, 4, 1], [0, 1, 5, 3], [0, 3, 6, 2]],
        })
        const vn = meshVertNormals(mesh)
        const inv = 1 / Math.sqrt(3)
        expect(vn[0]).toBeCloseTo(-inv, 6)
        expect(vn[1]).toBeCloseTo(-inv, 6)
        expect(vn[2]).toBeCloseTo(-inv, 6)
        expect(safeAcosApprox(0)).toBeCloseTo(Math.PI / 2, 4)
    })

    it('corner normals of an all-smooth mesh are the vertex normals', () => {
        const mesh = twoQuads()
        const c = meshNormalsVArray(mesh, AttrDomain.Corner)
        expect(c.size).toBe(8)
        expect(c.get(0, 2)).toBe(1)
    })
})

describe('implicit conversions (type_conversions.cc)', () => {
    it('vector to float is the component mean, float to int truncates, int to bool is "> 0"', () => {
        expect(convertVArray(GVArray.fromSingle('float3', 1, [1, 2, 6]), 'float').single[0]).toBe(3)
        expect(convertVArray(GVArray.fromSingle('float', 1, [-2.7]), 'int32').single[0]).toBe(-2)
        expect(convertVArray(GVArray.fromSingle('int32', 1, [-1]), 'bool').single[0]).toBe(0)
        expect(convertVArray(GVArray.fromSingle('float', 1, [300]), 'int8').single[0]).toBe(127)
        expect(convertVArray(GVArray.fromSingle('float', 1, [0.5]), 'float4').single).toEqual([0.5, 0.5, 0.5, 1])
        expect(isConvertible('float4', 'quaternion')).toBe(false)
    })
})

describe('rotation maths (BLI_math_matrix.hh)', () => {
    it('quaternion <-> expmap and matrix <-> euler round trip', () => {
        const q = eulerToQuat([0.3, -0.2, 1.1])
        const back = quatFromExpmap(quatToExpmap(q))
        for (let k = 0; k < 4; k++) expect(back[k]).toBeCloseTo(q[k], 5)
        const e = mat3ToEuler(quatToMat3(q))
        expect(e[0]).toBeCloseTo(0.3, 5)
        expect(e[1]).toBeCloseTo(-0.2, 5)
        expect(e[2]).toBeCloseTo(1.1, 5)
        const m = mat4FromLocQuatScale([1, 2, 3], q, [2, 2, 2])
        const d = mat4ToLocQuatScaleSafe(m, true)
        expect(d.loc).toEqual([1, 2, 3])
        expect(d.scale[0]).toBeCloseTo(2, 5)
        for (let k = 0; k < 4; k++) expect(d.rot[k]).toBeCloseTo(q[k], 5)
    })
})

describe('GeometrySet copy-on-write', () => {
    it('a copy shares components until one side writes', () => {
        const a = GeometrySet.fromMesh(twoQuads())
        const b = a.copy()
        expect(b.mesh).toBe(a.mesh)
        const m = b.meshForWrite()!
        expect(m).not.toBe(a.mesh)
        m.positions[0] = 9
        expect(a.mesh!.positions[0]).toBe(0)
        // `a` gave up ownership on copy, so its own write clones too.
        expect(a.meshForWrite()).not.toBe(m)
    })

    it('holds point clouds, curves and instances with Blender built-ins', () => {
        const g = new GeometrySet()
        g.setPointCloud(new PointCloud(3))
        g.setCurves(new CurvesGeometry(4, 2))
        const inst = new Instances(2)
        expect(inst.addReference({type: 'object', name: 'A'})).toBe(0)
        expect(inst.addReference({type: 'object', name: 'A'})).toBe(0)
        expect(inst.addReference({type: 'collection', name: 'A'})).toBe(1)
        g.setInstances(inst)
        expect(g.describe()).toBe('points(3) curves(2c 4p) instances(2, 2 refs)')
        expect(g.attributes('curves')!.add('material_index', AttrDomain.Curve, 'int32')).toBe(true)
        expect(g.attributes('instances')!.remove('instance_transform')).toBe(false)
    })
})
