/**
 * Parity cases for the simple input nodes: Radius / Curve Tilt / Is Spline Cyclic / Spline Resolution on meshes, point
 * clouds and curves, Instance Rotation / Scale / Transform (rotated, negatively scaled instances), Is Viewport, Self
 * Object, and the Object / Collection / Material / Image ID inputs.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {meshCase, store} from './meshCommon'
import {CaseImage, CaseObject, ParityCase} from './types'

const index = () => n.Index().index
const rock: CaseObject = {name: 'Rock', mesh: 'cube', location: [1, 2, 3], rotation: [0.3, -0.2, 0.9], scale: [1, 2, 0.5]}

export function inputCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>, extra = {}) => cases.push(meshCase(id, description, extra, build))

    add('input-curve-attributes', 'Radius, Curve Tilt, Is Spline Cyclic and Spline Resolution on curves, a point cloud and a mesh', () => {
        const circle = n.CurveCircle({resolution: 5}).curve
        const bez = n.SetSplineResolution({geometry: n.BezierSegment({resolution: 7}).curve, resolution: 3}).geometry
        const curves = n.SetCurveTilt({curve: n.SetCurveRadius({curve: n.JoinGeometry({geometry: [circle, bez]}).geometry, radius: index().mul(0.1)}).curve, tilt: index().mul(0.2)}).curve
        const cloud = n.MeshToPoints({mesh: n.MeshGrid({verticesX: 3, verticesY: 2}).mesh, radius: 0.25}).points
        let g: Socket<'GEOMETRY'> = n.JoinGeometry({geometry: [curves, cloud, n.MeshGrid({verticesX: 2, verticesY: 2}).mesh]}).geometry
        g = store(g, 'POINT', 'r', n.Radius().radius)
        g = store(g, 'POINT', 't', n.CurveTilt().tilt)
        g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'c', value: n.IsSplineCyclic().cyclic}).geometry
        return n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'INT', name: 'res', value: n.SplineResolution().resolution}).geometry
    })
    add('input-instance-transform', 'Instance Rotation, Scale and Transform of rotated, negatively scaled instances', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 4, offset: [1, 0.5, 0]}).mesh, instance: n.MeshCube().mesh,
            rotation: n.CombineXYZ({x: index().mul(0.4), y: 0.3, z: -0.7}).vector, scale: n.CombineXYZ({x: index().sub(1.5), y: 1, z: 0.5}).vector}).instances
        let g = n.StoreNamedAttribute({geometry: inst, domain: 'INSTANCE', dataType: 'QUATERNION', name: 'rot', value: n.InstanceRotation().rotation}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain: 'INSTANCE', dataType: 'FLOAT_VECTOR', name: 'scale', value: n.InstanceScale().scale}).geometry
        return n.StoreNamedAttribute({geometry: g, domain: 'INSTANCE', dataType: 'FLOAT4X4', name: 'm', value: n.InstanceTransform().transform}).geometry
    })
    add('input-viewport-self', 'Is Viewport, and Self Object through Object Info', () => {
        const self = n.ObjectInfo({object: n.SelfObject().selfObject, transformSpace: 'ORIGINAL'})
        let g = store(n.MeshLine({count: 2}).mesh, 'POINT', 'vp', n.IsViewport().isViewport)
        g = store(g, 'POINT', 'loc', self.location)
        return store(g, 'POINT', 'scale', self.scale)
    }, {location: [0.5, -1, 2], scale: [2, 1, 1]})
    const image: CaseImage = {name: 'img', width: 2, height: 2, pixels: [0, 0.25, 0.5, 1, 1, 0.5, 0.25, 1, 0.5, 0.5, 0.5, 0.5, 0.1, 0.2, 0.3, 1]}
    add('input-ids', 'Object, Collection, Material and Image inputs feeding Object Info, Collection Info, Set Material, Image Texture', () => {
        const obj = n.ObjectInfo({object: n.Object({object: {_ref: 'OBJECT', name: 'Rock'}}).object, asInstance: false}).geometry
        const coll = n.RealizeInstances({geometry: n.CollectionInfo({collection: n.Collection({collection: {_ref: 'COLLECTION', name: 'Props'}}).collection}).instances}).geometry
        const mat = n.SetMaterial({geometry: n.JoinGeometry({geometry: [obj, coll]}).geometry, material: n.Material({material: {_ref: 'MATERIAL', name: 'Red'}}).material}).geometry
        return store(mat, 'POINT', 'tex', n.ImageTexture({image: n.Image({image: {_ref: 'IMAGE', name: 'img'}}).image}).color)
    }, {objects: [rock], scene: [{collection: 'Props', objects: [{name: 'Prop', mesh: 'plane', location: [0, 0, 1]}]}], materials: ['Red'], images: [image]})
    return cases
}
