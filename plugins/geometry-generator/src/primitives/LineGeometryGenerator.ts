import {AGeometryGenerator} from '../AGeometryGenerator'
import {
    ArcCurve,
    BufferGeometry2,
    CatmullRomCurve3,
    Class,
    CubicBezierCurve,
    CubicBezierCurve3,
    Curve,
    EllipseCurve,
    generateValueConfig,
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
    Vector2,
    Vector3,
    IUiConfigContainer, UiObjectConfig,
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
    curve?: SupportedCurveTypes | Curve<Vector2> | Curve<Vector3>
    segments?: number
    closePath?: boolean
}

export class LineGeometryGenerator extends AGeometryGenerator<LineGeometryGeneratorParams> {

    constructor(type = 'line', defaultParams?: Partial<LineGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
        this.setupUiConfigs()
    }

    defaultParams: LineGeometryGeneratorParams = {
        curve: new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 1, 0)),
        segments: 50,
        closePath: false,
    }

    // for fat lines, some bugs right now like bounding box, shadows and depth when using this.
    static UseMeshLines = false

    defaultMeshClass: ()=>Class<IObject3D> = ()=> LineGeometryGenerator.UseMeshLines ? MeshLine : Line as any
    defaultMaterialClass: ()=>Class<IMaterial> = ()=> LineGeometryGenerator.UseMeshLines ? LineMaterial2 : UnlitLineMaterial
    defaultGeometryClass: ()=>Class<IGeometry> = ()=> LineGeometryGenerator.UseMeshLines ? LineGeometry2 : BufferGeometry2

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

        const points = curve.getPoints(segments - 1)

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
            // indices: [],
            normals: [],
            uvs: [],
            //  todo groups (not supported in instanced mesh(fat lines))
            positions,
        }
    }

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        const ui = super.createUiConfig(geometry)
        const curveFolder = ui.find(u => (u.label as any) === 'curve' && u.type === 'folder')
        // console.log(curveFolder, geometry.userData.generationParams?.curve)
        const curve = (geometry.userData.generationParams as LineGeometryGeneratorParams)?.curve
        if ((curve as IUiConfigContainer)?.uiConfig) {
            // replace curvefolder
            const ind = curveFolder ? ui.indexOf(curveFolder) : -1
            if (ind >= 0) {
                ui.splice(ind, 1, (curve as IUiConfigContainer).uiConfig!)
            } else {
                ui.push((curve as IUiConfigContainer).uiConfig!)
            }
        } else if (curveFolder && curve) {
            curveFolder.children = []
            const uic = this.curveUiConfigs[curve.type]
            curveFolder.label = curve.type.replace(/([A-Z])/g, ' $1').trim() // Convert camelCase to spaced words
            if (uic) {
                const children = uic.getUiConfig(curve as any)
                curveFolder.children.push(...children || [])
            }
            (curve as IUiConfigContainer).uiConfig = curveFolder
        }
        return [{
            type: 'dropdown',
            label: 'Curve Type',
            children: Object.keys(this.curveUiConfigs).map(key => ({
                label: key.replace(/([A-Z])/g, ' $1').trim(), // Convert camelCase to spaced words
                value: key,
            })),
            getValue: ()=>{
                const curve1 = (geometry.userData.generationParams as LineGeometryGeneratorParams).curve
                return curve1 ? curve1.type : 'LineCurve'
            },
            setValue: (v1: string)=>{
                const curve1 = (geometry.userData.generationParams as LineGeometryGeneratorParams).curve
                const oldSettings = curve1?.type ? this.curveUiConfigs[curve1.type] : null
                const settings = this.curveUiConfigs[v1]
                if (curve1 && settings && curve1.type !== v1) {
                    const ctor = settings.ctor
                    if (ctor) {
                        const curve2 = new ctor()
                        ;(geometry.userData.generationParams as LineGeometryGeneratorParams).curve = curve2

                        // copy properties in curve that are same/similar
                        if (oldSettings) {
                            const propsC1 = Object.entries(oldSettings.vals)
                                .map(([k, v]) => [k, (curve1 as any)[v], settings.vals[k]])
                                .filter(([_, v, k2]) => v !== undefined && v !== null && !!k2)

                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            for (const [_, v, k2] of propsC1) {
                                const prev = (curve2 as any)[k2]
                                if (prev !== undefined) {
                                    if (typeof prev === 'object' && typeof prev.copy === 'function')
                                        (curve2 as any)[k2].copy(v) // vectors
                                    else if (Array.isArray(prev) && Array.isArray(v))
                                        (curve2 as any)[k2] = [...v] // copy array
                                    else if (typeof prev === 'object' && typeof v === 'object' && v !== null)
                                        (curve2 as any)[k2] = {...v} // copy obj
                                    else
                                        (curve2 as any)[k2] = v
                                }
                            }
                        }

                        (geometry.userData as any).__generationParamsUiType = '' // invalidate ui, see updateUi in AGeometryGenerator.ts
                        this.generate(geometry)
                        return true
                    }
                    return false
                }
                return true
            },
        }, ...ui]
    }

    curveUiConfigs: Record<string, {
        ctor?: Class<SupportedCurveTypes>,
        getUiConfig: (curve: SupportedCurveTypes) => UiObjectConfig['children']
        vals: Record<string, string> // to copy common/similar properties from old curve to new one when changing types
    }> = {}

    setupUiConfigs() {
        this.curveUiConfigs.LineCurve = {
            ctor: LineCurve,
            vals: {
                start: 'v1',
                end: 'v2',
            },
            getUiConfig: (curve: LineCurve|LineCurve3)=>{
                return [
                    generateValueConfig(curve, 'v1', 'Start Point'),
                    generateValueConfig(curve, 'v2', 'End Point'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.LineCurve3 = {
            ...this.curveUiConfigs.LineCurve,
            ctor: LineCurve3,
        }
        this.curveUiConfigs.CubicBezierCurve = {
            ctor: CubicBezierCurve,
            vals: {
                start: 'v0',
                end: 'v3',
                control1: 'v1',
                control2: 'v2',
            },
            getUiConfig: (curve: CubicBezierCurve|CubicBezierCurve3)=>{
                return [
                    generateValueConfig(curve, 'v0', 'Start Point'),
                    generateValueConfig(curve, 'v1', 'Control Point 1'),
                    generateValueConfig(curve, 'v2', 'Control Point 2'),
                    generateValueConfig(curve, 'v3', 'End Point'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.CubicBezierCurve3 = {
            ...this.curveUiConfigs.CubicBezierCurve,
            ctor: CubicBezierCurve3,
        }
        this.curveUiConfigs.EllipseCurve = {
            ctor: EllipseCurve,
            vals: {
                centerX: 'aX',
                centerY: 'aY',
                radiusX: 'xRadius',
                radiusY: 'yRadius',
                startAngle: 'aStartAngle',
                endAngle: 'aEndAngle',
                clockwise: 'aClockwise',
                rotation: 'aRotation',
            },
            getUiConfig: (curve: EllipseCurve)=>{
                return [
                    generateValueConfig(curve, 'aX', 'X Center'),
                    generateValueConfig(curve, 'aY', 'Y Center'),
                    generateValueConfig(curve, 'xRadius', 'X Radius'),
                    generateValueConfig(curve, 'yRadius', 'Y Radius'),
                    generateValueConfig(curve, 'aStartAngle', 'Start Angle'),
                    generateValueConfig(curve, 'aEndAngle', 'End Angle'),
                    generateValueConfig(curve, 'aClockwise', 'Clockwise'),
                    generateValueConfig(curve, 'aRotation', 'Rotation'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.ArcCurve = {
            ctor: ArcCurve,
            vals: {
                centerX: 'aX',
                centerY: 'aY',
                radiusX: 'aRadius',
                startAngle: 'aStartAngle',
                endAngle: 'aEndAngle',
                clockwise: 'aClockwise',
            },
            getUiConfig: (curve: ArcCurve)=>{
                return [
                    generateValueConfig(curve, 'aX', 'X Center'),
                    generateValueConfig(curve, 'aY', 'Y Center'),
                    generateValueConfig(curve, 'aRadius', 'Radius'),
                    generateValueConfig(curve, 'aStartAngle', 'Start Angle'),
                    generateValueConfig(curve, 'aEndAngle', 'End Angle'),
                    generateValueConfig(curve, 'aClockwise', 'Clockwise'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.QuadraticBezierCurve = {
            ctor: QuadraticBezierCurve,
            vals: {
                start: 'v0',
                end: 'v2',
                control1: 'v1',
            },
            getUiConfig: (curve: QuadraticBezierCurve|QuadraticBezierCurve3)=>{
                return [
                    generateValueConfig(curve, 'v0', 'Start Point'),
                    generateValueConfig(curve, 'v1', 'Control Point'),
                    generateValueConfig(curve, 'v2', 'End Point'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.QuadraticBezierCurve3 = {
            ...this.curveUiConfigs.QuadraticBezierCurve,
            ctor: QuadraticBezierCurve3,
        }
        this.curveUiConfigs.CatmullRomCurve3 = {
            ctor: CatmullRomCurve3,
            vals: {
                points: 'points',
                closed: 'closed',
                curveType: 'curveType',
                tension: 'tension',
            },
            getUiConfig: (curve: CatmullRomCurve3) => {
                return [
                    generateValueConfig(curve, 'points', 'Control Points'),
                    {
                        type: 'button',
                        label: 'Add Point',
                        value: () => {
                            const points = curve.points as Vector3[]
                            points.push(new Vector3(0, 0, 0))
                            curve.points = points
                            curve.updateArcLengths()
                        },
                    },
                    generateValueConfig(curve, 'closed', 'Closed Loop'),
                    {
                        type: 'dropdown',
                        property: [curve, 'curveType'],
                        label: 'Curve Type',
                        children: ['centripetal', 'chordal', 'catmullrom'].map(value => ({label:value, value})),
                    },
                    generateValueConfig(curve, 'tension', 'Tension'),
                ] as UiObjectConfig['children']
            },
        }
        this.curveUiConfigs.SplineCurve = {
            ctor: SplineCurve,
            vals: {
                points: 'points',
            },
            getUiConfig: (curve: SplineCurve) => {
                return [
                    generateValueConfig(curve, 'points', 'Control Points'),
                    {
                        type: 'button',
                        label: 'Add Point',
                        value: () => {
                            const points = curve.points
                            points.push(new Vector2(0, 0))
                            curve.points = points
                            curve.updateArcLengths()
                        },
                    },
                ] as UiObjectConfig['children']
            },
        }
    }
}
