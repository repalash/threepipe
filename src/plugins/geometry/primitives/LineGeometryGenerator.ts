import {Curve, Line, LineCurve3, Vector2, Vector3} from 'three'
import {Class} from 'ts-browser-helpers'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {IGeometry} from '../../../core/IGeometry'
import {IMaterial} from '../../../core/IMaterial'
import {IObject3D} from '../../../core/IObject'
import {BufferGeometry2} from '../../../core/geometry/BufferGeometry2'
import {LineGeometry2} from '../../../core/geometry/LineGeometry2'
import {LineMaterial2} from '../../../core/material/LineMaterial2'
import {UnlitLineMaterial} from '../../../core/material/UnlitLineMaterial'
import {MeshLine} from '../../../core/object/MeshLine'
import {AGeometryGenerator} from '../AGeometryGenerator'
import {createCurvePropertyUi, createCurveTypeDropdown, type SupportedCurveTypes} from '../helpers/CurveUiHelper'

export interface LineGeometryGeneratorParams {
    curve?: SupportedCurveTypes | Curve<Vector2> | Curve<Vector3>
    segments?: number
    closePath?: boolean
}

export class LineGeometryGenerator extends AGeometryGenerator<LineGeometryGeneratorParams> {

    constructor(type = 'line', defaultParams?: Partial<LineGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: LineGeometryGeneratorParams = {
        curve: new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 1, 0)),
        segments: 50,
        closePath: false,
    }

    static UseMeshLines = true

    defaultMeshClass: ()=>Class<IObject3D> = ()=> LineGeometryGenerator.UseMeshLines ? MeshLine : Line as any
    defaultMaterialClass: ()=>Class<IMaterial> = ()=> LineGeometryGenerator.UseMeshLines ? LineMaterial2 : UnlitLineMaterial
    defaultGeometryClass: ()=>Class<IGeometry> = ()=> LineGeometryGenerator.UseMeshLines ? LineGeometry2 : BufferGeometry2

    protected _generateData(params: LineGeometryGeneratorParams) {
        const positions: number[] = []

        let curve = params.curve
        if (!curve && this.defaultParams.curve) {
            curve = this.defaultParams.curve
        }

        if (!curve) {
            throw new Error('No curve specified for line generation')
        }

        const segments = Math.max(2, params.segments || 50)
        const closePath = params.closePath || false

        curve.updateArcLengths()
        const points = curve.getSpacedPoints(segments - 1)

        if (points.length !== segments) {
            console.error(`LineGeometryGenerator: Curve points length (${points.length}) does not match segments (${segments}).`)
        }

        for (const point of points) {
            if ('z' in point) {
                positions.push(point.x, point.y, point.z)
            } else {
                positions.push(point.x, point.y, 0)
            }
        }

        if (closePath && points.length > 0) {
            const firstPoint = points[0]
            if ('z' in firstPoint) {
                positions.push(firstPoint.x, firstPoint.y, firstPoint.z)
            } else {
                positions.push(firstPoint.x, firstPoint.y, 0)
            }
        }

        return {
            vertices: positions,
            normals: [],
            uvs: [],
            positions,
        }
    }

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        const ui = super.createUiConfig(geometry)
        const curveFolder = ui.find(u => (u.label as any) === 'curve' && u.type === 'folder')
        const curve = (geometry.userData.generationParams as LineGeometryGeneratorParams)?.curve
        if (!curve) return []

        if ((curve as IUiConfigContainer)?.uiConfig) {
            const ind = curveFolder ? ui.indexOf(curveFolder) : -1
            if (ind >= 0) {
                ui.splice(ind, 1, (curve as IUiConfigContainer).uiConfig!)
            } else {
                ui.push((curve as IUiConfigContainer).uiConfig!)
            }
        } else if (curveFolder) {
            const propUi = createCurvePropertyUi(curve)
            if (propUi.length > 0) {
                const ind = ui.indexOf(curveFolder)
                ui.splice(ind, 1, ...propUi)
            }
        }

        const onTypeChange = (newCurve: SupportedCurveTypes) => {
            (geometry.userData.generationParams as LineGeometryGeneratorParams).curve = newCurve
            ;(geometry.userData as any).__generationParamsUiType = '' // invalidate ui
            this.generate(geometry)
        }
        const curveTypeDropdown = createCurveTypeDropdown(curve, onTypeChange)
        return [curveTypeDropdown, ...ui]
    }
}
