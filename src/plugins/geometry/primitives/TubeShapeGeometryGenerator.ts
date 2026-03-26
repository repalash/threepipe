import {BufferAttribute, Curve, Float32BufferAttribute, Shape, Vector2, Vector3} from 'three'
import {AGeometryGenerator} from '../AGeometryGenerator'
import {IGeometry} from '../../../core/IGeometry'
import {UiObjectConfig} from 'uiconfig.js'
import {TubeShapeGeometry} from '../../../core/geometry/TubeShapeGeometry'
import {EllipseCurve3D} from '../../../core/geometry/EllipseCurve3D'
import {createShapeFromPreset, reverseShapeWinding} from '../helpers/ShapePresets'
import {createCurvePropertyUi, createCurveTypeDropdown} from '../helpers/CurveUiHelper'

export interface TubeShapeGeometryGeneratorParams {
    // Path
    path: Curve<Vector3>
    // Shape cross-section
    shapeType: 'rectangle' | 'circle' | 'polygon' | 'custom'
    shape?: Shape
    width: number
    height: number
    circleRadius: number
    circleSegments: number
    sides: number
    polygonRadius: number
    // Tube params
    shapeSegments: number
    tubularSegments: number
    closed: boolean
    shapeScaleX: number
    shapeScaleY: number
    primary: 'shape' | 'path'
    materialSplits: string
}

/**
 * Generates a tube geometry with arbitrary shape cross-section along a 3D curve path.
 * Uses the custom TubeShapeGeometry internally, which supports non-circular cross-sections,
 * shape scaling, and multi-material splits.
 */
export class TubeShapeGeometryGenerator extends AGeometryGenerator<TubeShapeGeometryGeneratorParams> {

    constructor(type = 'tubeShape', defaultParams?: Partial<TubeShapeGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: TubeShapeGeometryGeneratorParams = {
        path: new EllipseCurve3D(0, 0, 2, 2, 0, 2 * Math.PI, false, 0) as any,
        shapeType: 'rectangle',
        width: 0.5,
        height: 0.3,
        circleRadius: 0.2,
        circleSegments: 16,
        sides: 6,
        polygonRadius: 0.2,
        shapeSegments: 16,
        tubularSegments: 64,
        closed: false,
        shapeScaleX: 1,
        shapeScaleY: 1,
        primary: 'shape',
        materialSplits: '',
    }

    protected _generateData(params: TubeShapeGeometryGeneratorParams) {
        const presetShape = params.shapeType === 'custom' && params.shape
            ? params.shape
            : createShapeFromPreset(params.shapeType, params)
        // TubeShapeGeometry expects CW winding for outward-facing normals
        const shape = reverseShapeWinding(presetShape)

        const tubeShapeGeom = new TubeShapeGeometry(
            shape,
            params.path,
            params.shapeSegments,
            params.tubularSegments,
            params.closed,
            new Vector2(params.shapeScaleX, params.shapeScaleY),
            params.primary,
        )

        // Handle material splits
        if (params.materialSplits) {
            const splits = params.materialSplits.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
            if (splits.length > 0) {
                tubeShapeGeom.createSplits(splits)
            }
        }

        const positionAttr = tubeShapeGeom.getAttribute('position') as Float32BufferAttribute
        const normalAttr = tubeShapeGeom.getAttribute('normal') as Float32BufferAttribute
        const uvAttr = tubeShapeGeom.getAttribute('uv') as Float32BufferAttribute
        const indexArr = tubeShapeGeom.index ? Array.from(tubeShapeGeom.index.array) : []

        const result: {
            indices: number[] | BufferAttribute
            vertices: Float32BufferAttribute
            normals: Float32BufferAttribute
            uvs: Float32BufferAttribute
            groups?: {start: number, count: number, materialIndex?: number}[]
        } = {
            indices: indexArr,
            vertices: positionAttr,
            normals: normalAttr,
            uvs: uvAttr,
        }

        if (tubeShapeGeom.groups.length > 0) {
            result.groups = tubeShapeGeom.groups.map(g => ({
                start: g.start,
                count: g.count,
                materialIndex: g.materialIndex,
            }))
        }

        tubeShapeGeom.dispose()
        return result
    }

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        const params = geometry.userData.generationParams as unknown as TubeShapeGeometryGeneratorParams
        if (!params) return []

        const allUi = super.createUiConfig(geometry)
        // Remove auto-generated entries for complex params
        const filtered = allUi.filter(u => {
            const label = u.label as string
            return label !== 'path' && label !== 'shape'
        })

        // Add visibility callbacks for shape-type-specific params
        for (const ui of filtered) {
            const label = ui.label as string
            if (label === 'width' || label === 'height') {
                ui.hidden = () => params.shapeType !== 'rectangle'
            } else if (label === 'circleRadius' || label === 'circleSegments') {
                ui.hidden = () => params.shapeType !== 'circle'
            } else if (label === 'sides' || label === 'polygonRadius') {
                ui.hidden = () => params.shapeType !== 'polygon'
            }
        }

        // Curve UI
        const onTypeChange = (newCurve: Curve<Vector3>) => {
            params.path = newCurve
            ;(geometry.userData as any).__generationParamsUiType = ''
            this.generate(geometry)
        }

        return [
            createCurveTypeDropdown(params.path, onTypeChange),
            ...createCurvePropertyUi(params.path),
            ...filtered,
        ]
    }
}
