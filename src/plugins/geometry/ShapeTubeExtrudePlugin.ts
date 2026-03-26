import {
    BufferAttribute,
    BufferGeometry,
    InterleavedBufferAttribute,
    Mesh,
    Shape,
    Vector2,
    Vector3,
} from 'three'
import {uiButton, uiFolderContainer, uiInput, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IMesh, IObject3D} from '../../core/IObject'
import {EllipseCurve3D} from '../../core/geometry/EllipseCurve3D'
import {PickingPlugin} from '../interaction/PickingPlugin'
import {GeometryGeneratorPlugin} from './GeometryGeneratorPlugin'

/**
 * ShapeTubeExtrudePlugin
 *
 * Provides interactive extrusion of flat geometry along a curve path.
 * Takes a selected planar mesh, auto-detects its flat axis, extracts a 2D Shape from
 * the vertices, then extrudes it along a curve using the TubeShape geometry generator.
 *
 * Features:
 * - Extrude any flat geometry along a circle curve
 * - Auto-detect planar axis (X, Y, or Z) and extract 2D shape
 * - Configurable shape/tube segments, shape scale, and material splits
 * - Multi-material support via configurable split positions
 *
 * This could also be used as a sample plugin to create custom interactive geometry plugins.
 * @category Plugins
 */
@uiFolderContainer('Extrude Tube Shapes')
export class ShapeTubeExtrudePlugin extends AViewerPluginSync {
    public static readonly PluginType = 'ShapeTubeExtrudePlugin'
    dependencies = [PickingPlugin, GeometryGeneratorPlugin]
    enabled = true
    toJSON: any = undefined

    @uiSlider('Shape Segments', [1, 100], 1)
        shapeSegments = 32

    @uiSlider('Tube Segments', [1, 100], 1)
        tubularSegments = 32

    @uiSlider('Shape Scale X', [0.01, 10], 0.01)
        shapeScaleX = 1

    @uiSlider('Shape Scale Y', [0.01, 10], 0.01)
        shapeScaleY = 1

    @uiInput('Material Splits')
        materialSplits = '0.3, 0.6'

    @uiToggle('Horizontal Splits')
        horizontalSplits = true

    @uiButton('Extrude Circle Tube')
    public extrudeCircleTube = async() => {
            const picking = this._viewer?.getPlugin(PickingPlugin)
            const object = picking?.getSelectedObject<IMesh>()
            if (!object || !object.geometry) return

            const radius = 1
            const circleCurve = new EllipseCurve3D(0, 0, radius, radius, 0, 2 * Math.PI, false, 0)
            this.extrudeObject(object as any, circleCurve as any)
        }

    /**
     * Extrude a mesh's geometry along a curve path.
     * The mesh must be a flat/planar geometry (aligned to one axis).
     */
    public extrudeObject(
        object: Mesh,
        curve: any,
        shapeSegments = this.shapeSegments,
        tubularSegments = this.tubularSegments,
        shapeScaleX = this.shapeScaleX,
        shapeScaleY = this.shapeScaleY,
        materialSplits = this.materialSplits,
        horizontalSplits = this.horizontalSplits,
    ) {
        if (!this._viewer) return

        // If the object itself is an extruded result, find its source
        if (object.userData._extrudeSource) {
            const src = object.userData._extrudeSource
            const source = object.parent?.children.find(o => src === o.uuid) as Mesh
            if (!source) {
                console.warn('Could not find extrude source with uuid', src)
                return
            }
            object = source
        }

        // Remove previous extrusion result if any
        if (object.userData.extrudedObject) {
            const oldUuid = object.userData.extrudedObject
            const oldObj = object.parent?.children.find(o => oldUuid === o.uuid) as IObject3D | undefined
            if (oldObj) {
                oldObj.dispose?.(true)
            }
            delete object.userData.extrudedObject
        }

        const geometry = object.geometry
        if (!geometry) {
            console.warn('ShapeTubeExtrudePlugin: No geometry to extrude')
            return
        }

        let shape: Shape
        try {
            shape = ShapeTubeExtrudePlugin.ConvertGeometryToFlatShape(geometry)
        } catch (e: any) {
            console.warn('ShapeTubeExtrudePlugin:', typeof e === 'string' ? e : e?.message)
            return
        }

        const generator = this._viewer.getPlugin(GeometryGeneratorPlugin)
        if (!generator) return

        const splits = materialSplits ? materialSplits.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)).join(', ') : ''

        const mesh = generator.generateObject('tubeShape', {
            path: curve,
            shapeType: 'custom' as any,
            shape,
            shapeSegments,
            tubularSegments,
            closed: true,
            shapeScaleX,
            shapeScaleY,
            primary: horizontalSplits ? 'shape' : 'path',
            materialSplits: splits,
        })

        mesh.userData._extrudeSource = object.uuid
        mesh.userData.isExtrudedTube = true
        mesh.name = object.name + '_extruded'

        object.visible = false
        object.userData.extrudedObject = mesh.uuid

        if (object.parent) {
            object.parent.add(mesh)
        } else {
            this._viewer.scene.addObject(mesh)
        }
    }

    /**
     * Programmatic helper to extrude a shape along a curve.
     */
    static ExtrudeShape(
        viewer: ThreeViewer,
        shape: Shape,
        curve: any,
        shapeSegments = 32,
        tubularSegments = 64,
        shapeScaleX = 1,
        shapeScaleY = 1,
        materialSplits = '',
        horizontalSplits = true,
    ): IMesh | undefined {
        const generator = viewer.getPlugin(GeometryGeneratorPlugin)
        if (!generator) return undefined

        return generator.generateObject('tubeShape', {
            path: curve,
            shapeType: 'custom' as any,
            shape,
            shapeSegments,
            tubularSegments,
            closed: true,
            shapeScaleX,
            shapeScaleY,
            primary: horizontalSplits ? 'shape' : 'path',
            materialSplits,
        })
    }

    /**
     * Convert a planar 3D geometry to a 2D Shape by auto-detecting the flat axis.
     * The geometry must be aligned to one of the principal axes (X, Y, or Z bounding box extent near zero).
     *
     * @param geometry - The geometry to convert (must be planar/flat)
     * @param sort - Whether to sort points starting from the leftmost point
     * @returns A 2D Shape suitable for extrusion
     * @throws If geometry has no position attribute, is too large (>500 vertices), or is not axis-aligned planar
     */
    static ConvertGeometryToFlatShape(geometry: BufferGeometry, sort = true): Shape {
        if (geometry.userData.__planarShape) return geometry.userData.__planarShape

        const position: BufferAttribute | InterleavedBufferAttribute = geometry.attributes.position as any
        if (!position) throw new Error('No position attribute')
        if (position.count > 500) throw new Error('Too many vertices to extrude (max 500)')

        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const bbox = geometry.boundingBox!.getSize(new Vector3())
        const axis = bbox.x < 0.001 ? 'x' : bbox.y < 0.001 ? 'y' : bbox.z < 0.001 ? 'z' : null
        if (!axis) throw new Error('Geometry is not axis-aligned planar')

        let points: Vector2[] = []
        for (let i = 0; i < position.count; i++) {
            const v = new Vector2()
            if (axis === 'x') v.set(position.getY(i), position.getZ(i))
            else if (axis === 'y') v.set(position.getX(i), position.getZ(i))
            else v.set(position.getX(i), position.getY(i))
            points.push(v)
        }

        if (sort) {
            let minPoint = 0
            for (let i = 0; i < points.length; i++) {
                if (points[i].x < points[minPoint].x) minPoint = i
                else if (points[i].x === points[minPoint].x && points[i].y < points[minPoint].y) minPoint = i
            }
            if (minPoint !== 0) points = points.slice(minPoint).concat(points.slice(0, minPoint))
        }

        const shape = new Shape(points)
        geometry.userData.__planarShape = shape
        return shape
    }
}
