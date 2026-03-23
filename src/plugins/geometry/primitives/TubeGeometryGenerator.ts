import {Curve, Float32BufferAttribute, TubeGeometry, Vector3} from 'three'
import {AGeometryGenerator} from '../AGeometryGenerator'
import {IGeometry} from '../../../core/IGeometry'
import {UiObjectConfig} from 'uiconfig.js'
import {EllipseCurve3D} from '../../../core/geometry/EllipseCurve3D'
import {createCurvePropertyUi, createCurveTypeDropdown} from '../helpers/CurveUiHelper'

export interface TubeGeometryGeneratorParams {
    path: Curve<Vector3>
    tubularSegments: number
    radius: number
    radialSegments: number
    closed: boolean
}

/**
 * Generates a tube geometry with circular cross-section along a 3D curve path.
 * Uses three.js TubeGeometry internally.
 */
export class TubeGeometryGenerator extends AGeometryGenerator<TubeGeometryGeneratorParams> {

    constructor(type = 'tube', defaultParams?: Partial<TubeGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: TubeGeometryGeneratorParams = {
        path: new EllipseCurve3D(0, 0, 1, 1, 0, 2 * Math.PI, false, 0) as any,
        tubularSegments: 64,
        radius: 0.1,
        radialSegments: 8,
        closed: false,
    }

    protected _generateData(params: TubeGeometryGeneratorParams) {
        const tubeGeom = new TubeGeometry(
            params.path,
            params.tubularSegments,
            params.radius,
            params.radialSegments,
            params.closed,
        )

        const positionAttr = tubeGeom.getAttribute('position') as Float32BufferAttribute
        const normalAttr = tubeGeom.getAttribute('normal') as Float32BufferAttribute
        const uvAttr = tubeGeom.getAttribute('uv') as Float32BufferAttribute
        const indexArr = tubeGeom.index ? Array.from(tubeGeom.index.array) : []

        const result = {
            indices: indexArr,
            vertices: positionAttr,
            normals: normalAttr,
            uvs: uvAttr,
        }

        tubeGeom.dispose()
        return result
    }

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        const params = geometry.userData.generationParams as unknown as TubeGeometryGeneratorParams
        if (!params) return []

        const scalarUi = super.createUiConfig(geometry)
        // Remove the auto-generated 'path' folder (not useful for curve objects)
        const filtered = scalarUi.filter(u => (u.label as any) !== 'path')

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
