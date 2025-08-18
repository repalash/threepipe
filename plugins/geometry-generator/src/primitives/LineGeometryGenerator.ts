import {AGeometryGenerator} from '../AGeometryGenerator'
import {
    ArcCurve,
    BufferGeometry2,
    CatmullRomCurve3,
    Class,
    CubicBezierCurve,
    CubicBezierCurve3,
    EllipseCurve,
    IGeometry,
    IMaterial,
    IObject3D,
    Line,
    LineCurve,
    LineCurve3,
    LineGeometry2,
    LineMaterial2,
    MeshLine,
    QuadraticBezierCurve,
    QuadraticBezierCurve3,
    SplineCurve,
    UnlitLineMaterial,
    Vector3,
} from 'threepipe'

export type SupportedCurveTypes =
    | LineCurve
    | LineCurve3
    | CubicBezierCurve
    | CubicBezierCurve3
    | EllipseCurve
    | ArcCurve
    | QuadraticBezierCurve
    | QuadraticBezierCurve3
    | CatmullRomCurve3
    | SplineCurve

export interface LineGeometryGeneratorParams {
    curve?: SupportedCurveTypes
    segments?: number
    closePath?: boolean
}

export class LineGeometryGenerator extends AGeometryGenerator<LineGeometryGeneratorParams> {

    constructor(type = 'line', defaultParams?: Partial<LineGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: LineGeometryGeneratorParams = {
        curve: new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 0, 0)),
        segments: 50,
        closePath: false,
    }

    // for fat lines, some bugs right now like bounding box, shadows and depth when using this.
    static UseMeshLines = false

    defaultMeshClass: Class<IObject3D> = LineGeometryGenerator.UseMeshLines ? MeshLine : Line as any
    defaultMaterialClass?: Class<IMaterial> = LineGeometryGenerator.UseMeshLines ? LineMaterial2 : UnlitLineMaterial
    defaultGeometryClass?: Class<IGeometry> = LineGeometryGenerator.UseMeshLines ? LineGeometry2 : BufferGeometry2

    protected _generateData(params: LineGeometryGeneratorParams) {
        const positions: number[] = []

        // Get the curve - either from direct reference or from JSON
        let curve = params.curve
        // if (!curve && params.curveJSON) {
        //     curve = this._curveFromJSON(params.curveJSON) || undefined
        // }
        if (!curve && this.defaultParams.curve) {
            curve = this.defaultParams.curve
        }

        if (!curve) {
            throw new Error('No curve specified for line generation')
        }

        const segments = Math.max(2, params.segments || 50)
        const closePath = params.closePath || false

        // Generate points along the curve
        const points = curve.getPoints(segments - 1)

        // Convert points to positions array
        for (const point of points) {
            if ('z' in point) {
                // 3D point (Vector3)
                positions.push(point.x, point.y, point.z)
            } else {
                // 2D point (Vector2) - add z=0
                positions.push(point.x, point.y, 0)
            }
        }

        // Close the path if requested
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
            // indices: [],
            normals: [],
            uvs: [],
            //  todo groups
            positions,
        }
    }

}
