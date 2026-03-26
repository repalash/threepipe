import {
    ArcCurve,
    CatmullRomCurve3,
    CubicBezierCurve,
    CubicBezierCurve3,
    Curve,
    CurvePath,
    EllipseCurve,
    LineCurve,
    LineCurve3,
    QuadraticBezierCurve,
    QuadraticBezierCurve3,
    SplineCurve,
    Vector2,
    Vector3,
} from 'three'
import {generateValueConfig, IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {Class} from 'ts-browser-helpers'
import {EllipseCurve3D} from '../../../core/geometry/EllipseCurve3D'
import {CurvePath3} from '../../../three/utils/curve'

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
    | CurvePath<Vector2>
    | CurvePath3

export interface CurveUiEntry {
    ctor?: Class<Curve<any>>,
    getUiConfig: (curve: any) => UiObjectConfig['children']
    /** Maps semantic property names to actual curve property names, used to copy values when switching curve types */
    vals: Record<string, string>
}

/**
 * Registry of curve types with their UI config generators.
 * Used by geometry generators that have curve parameters (TubeGeometryGenerator, LineGeometryGenerator, etc.)
 */
export const curveUiConfigs: Record<string, CurveUiEntry> = {}

// ── 2D Curves ──

curveUiConfigs.LineCurve = {
    ctor: LineCurve,
    vals: {start: 'v1', end: 'v2'},
    getUiConfig: (curve: LineCurve | LineCurve3) => [
        generateValueConfig(curve, 'v1', 'Start Point'),
        generateValueConfig(curve, 'v2', 'End Point'),
    ] as UiObjectConfig['children'],
}

curveUiConfigs.CubicBezierCurve = {
    ctor: CubicBezierCurve,
    vals: {start: 'v0', end: 'v3', control1: 'v1', control2: 'v2'},
    getUiConfig: (curve: CubicBezierCurve | CubicBezierCurve3) => [
        generateValueConfig(curve, 'v0', 'Start Point'),
        generateValueConfig(curve, 'v1', 'Control Point 1'),
        generateValueConfig(curve, 'v2', 'Control Point 2'),
        generateValueConfig(curve, 'v3', 'End Point'),
    ] as UiObjectConfig['children'],
}

curveUiConfigs.QuadraticBezierCurve = {
    ctor: QuadraticBezierCurve,
    vals: {start: 'v0', end: 'v2', control1: 'v1'},
    getUiConfig: (curve: QuadraticBezierCurve | QuadraticBezierCurve3) => [
        generateValueConfig(curve, 'v0', 'Start Point'),
        generateValueConfig(curve, 'v1', 'Control Point'),
        generateValueConfig(curve, 'v2', 'End Point'),
    ] as UiObjectConfig['children'],
}

curveUiConfigs.EllipseCurve = {
    ctor: EllipseCurve,
    vals: {centerX: 'aX', centerY: 'aY', radiusX: 'xRadius', radiusY: 'yRadius', startAngle: 'aStartAngle', endAngle: 'aEndAngle', clockwise: 'aClockwise', rotation: 'aRotation'},
    getUiConfig: (curve: EllipseCurve) => [
        generateValueConfig(curve, 'aX', 'X Center'),
        generateValueConfig(curve, 'aY', 'Y Center'),
        generateValueConfig(curve, 'xRadius', 'X Radius'),
        generateValueConfig(curve, 'yRadius', 'Y Radius'),
        generateValueConfig(curve, 'aStartAngle', 'Start Angle'),
        generateValueConfig(curve, 'aEndAngle', 'End Angle'),
        generateValueConfig(curve, 'aClockwise', 'Clockwise'),
        generateValueConfig(curve, 'aRotation', 'Rotation'),
    ] as UiObjectConfig['children'],
}

curveUiConfigs.ArcCurve = {
    ctor: ArcCurve,
    vals: {centerX: 'aX', centerY: 'aY', radiusX: 'xRadius', radiusY: 'yRadius', startAngle: 'aStartAngle', endAngle: 'aEndAngle', clockwise: 'aClockwise'},
    getUiConfig: (curve: ArcCurve) => {
        const radiusConfig = generateValueConfig(curve, 'xRadius', 'Radius')
        if (radiusConfig) {
            const origOnChange = radiusConfig.onChange as ((...args: any[]) => void) | undefined
            radiusConfig.onChange = (...args: any[]) => {
                curve.yRadius = curve.xRadius // keep circle (ArcCurve = equal radii)
                origOnChange?.(...args)
            }
        }
        return [
            generateValueConfig(curve, 'aX', 'X Center'),
            generateValueConfig(curve, 'aY', 'Y Center'),
            radiusConfig,
            generateValueConfig(curve, 'aStartAngle', 'Start Angle'),
            generateValueConfig(curve, 'aEndAngle', 'End Angle'),
            generateValueConfig(curve, 'aClockwise', 'Clockwise'),
        ] as UiObjectConfig['children']
    },
}

curveUiConfigs.SplineCurve = {
    ctor: SplineCurve,
    vals: {points: 'points'},
    getUiConfig: (curve: SplineCurve) => [
        () => curve.points.map((_, i) => generateValueConfig(curve.points, i.toString(), `Point ${i}`)),
        {
            type: 'button', label: 'Add Point',
            value: () => {
                const points = curve.points
                const prev = points[points.length - 1] || new Vector2(0, 0)
                const prev2 = points[points.length - 2] || new Vector2(1, 1)
                points.push(prev.clone().add(prev.clone().sub(prev2)))
                curve.points = points
                curve.updateArcLengths()
                ;(curve as IUiConfigContainer).uiConfig?.uiRefresh?.(true, 'postFrame')
            },
        },
    ] as UiObjectConfig['children'],
}

// ── 3D Curves ──

curveUiConfigs.LineCurve3 = {
    ...curveUiConfigs.LineCurve,
    ctor: LineCurve3,
}

curveUiConfigs.CubicBezierCurve3 = {
    ...curveUiConfigs.CubicBezierCurve,
    ctor: CubicBezierCurve3,
}

curveUiConfigs.QuadraticBezierCurve3 = {
    ...curveUiConfigs.QuadraticBezierCurve,
    ctor: QuadraticBezierCurve3,
}

curveUiConfigs.CatmullRomCurve3 = {
    ctor: CatmullRomCurve3,
    vals: {points: 'points', closed: 'closed', curveType: 'curveType', tension: 'tension'},
    getUiConfig: (curve: CatmullRomCurve3) => [
        () => curve.points.map((_, i) => generateValueConfig(curve.points, i.toString(), `Point ${i}`)),
        {
            type: 'button', label: 'Add Point',
            value: () => {
                const points = curve.points
                const prev = points[points.length - 1] || new Vector3(0, 0, 0)
                const prev2 = points[points.length - 2] || new Vector3(1, 1, 0)
                points.push(prev.clone().add(prev.clone().sub(prev2)))
                curve.points = points
                curve.updateArcLengths()
                ;(curve as IUiConfigContainer).uiConfig?.uiRefresh?.(true, 'postFrame')
            },
        },
        generateValueConfig(curve, 'closed', 'Closed Loop'),
        {
            type: 'dropdown', property: [curve, 'curveType'], label: 'Curve Type',
            children: ['centripetal', 'chordal', 'catmullrom'].map(value => ({label: value, value})),
        },
        generateValueConfig(curve, 'tension', 'Tension'),
    ] as UiObjectConfig['children'],
}

curveUiConfigs.EllipseCurve3D = {
    ctor: EllipseCurve3D,
    vals: {centerX: 'aX', centerY: 'aY', radiusX: 'xRadius', radiusY: 'yRadius', startAngle: 'aStartAngle', endAngle: 'aEndAngle', clockwise: 'aClockwise', rotation: 'aRotation'},
    getUiConfig: curveUiConfigs.EllipseCurve.getUiConfig, // same props as EllipseCurve
}

// ── CurvePath (composite) ──

curveUiConfigs.CurvePath = {
    ctor: CurvePath as any,
    vals: {},
    getUiConfig: (curve: CurvePath<Vector2> | CurvePath3) => [
        () => curve.curves.map((c, i) => {
            if ((c as IUiConfigContainer).uiConfig) return (c as IUiConfigContainer).uiConfig
            const type = c.type
            const uic = curveUiConfigs[type]
            if (uic) {
                const children = uic.getUiConfig(c as any) || []
                const config = {
                    type: 'folder',
                    label: type.replace(/([A-Z])/g, ' $1').trim(),
                    children: [
                        createCurveTypeDropdown(c as any, (curve1) => {
                            curve.curves[i] = curve1 as any
                            curve.updateArcLengths()
                            ;(curve as IUiConfigContainer).uiConfig?.uiRefresh?.(true, 'postFrame')
                        }),
                        ...children,
                        {
                            type: 'button', label: 'Remove Curve',
                            value: () => {
                                curve.curves.splice(i, 1)
                                curve.updateArcLengths()
                                ;(curve as IUiConfigContainer).uiConfig?.uiRefresh?.(true, 'postFrame')
                                return true
                            },
                        },
                    ],
                } as UiObjectConfig
                ;(c as IUiConfigContainer).uiConfig = config
                return config
            }
            return undefined
        }),
        {
            type: 'button', label: 'Add Curve',
            value: () => {
                const newCurve = curve.type.endsWith('3')
                    ? new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 1, 0))
                    : new LineCurve(new Vector2(0, 0), new Vector2(1, 1))
                curve.add(newCurve as any)
                curve.updateArcLengths()
                ;(curve as IUiConfigContainer).uiConfig?.uiRefresh?.(true, 'postFrame')
                return true
            },
        },
    ] as UiObjectConfig['children'],
}

curveUiConfigs.CurvePath3 = {
    ...curveUiConfigs.CurvePath,
    ctor: CurvePath3 as any,
}

// ── Public API ──

/**
 * Create a curve type dropdown UI config for selecting between curve types.
 * @param curve Current curve instance
 * @param configs Curve UI config registry to use (defaults to full registry)
 * @param onTypeChange Callback when curve type is changed
 */
export function createCurveTypeDropdown(
    curve: Curve<Vector2 | Vector3>,
    onTypeChange: (newCurve: Curve<any>) => void,
    configs: Record<string, CurveUiEntry> = curveUiConfigs,
): UiObjectConfig {
    return {
        type: 'dropdown',
        label: 'Curve Type',
        children: Object.keys(configs).map(key => ({
            label: key.replace(/([A-Z])/g, ' $1').trim(),
            value: key,
        })),
        getValue: () => curve ? (curve as any).type || 'LineCurve3' : 'LineCurve3',
        setValue: (v1: string) => {
            const oldSettings = (curve as any).type ? configs[(curve as any).type] : null
            const settings = configs[v1]
            if (!(curve && settings && (curve as any).type !== v1)) return true
            const ctor = settings.ctor
            if (!ctor) return false

            const newCurve = new ctor()
            // Initialize empty point arrays for spline/catmull-rom types
            if (Array.isArray((newCurve as SplineCurve).points) && (newCurve as SplineCurve).points.length === 0) {
                const p = newCurve.type.endsWith('3') ? new Vector3() : new Vector2()
                const p2 = newCurve.type.endsWith('3') ? new Vector3(1, 1, 1) : new Vector2(1, 1)
                ;(newCurve as any).points.push(p, p2)
            }
            // Initialize empty curves array for CurvePath types
            if (Array.isArray((newCurve as CurvePath<any>).curves) && (newCurve as CurvePath<any>).curves.length === 0) {
                const c = newCurve.type.endsWith('3')
                    ? new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 1, 0))
                    : new LineCurve(new Vector2(0, 0), new Vector2(1, 1))
                ;(newCurve as any).curves.push(c)
            }

            // Copy compatible properties from old curve to new one
            if (oldSettings) {
                const propsC1 = Object.entries(oldSettings.vals)
                    .map(([k, v]) => [k, (curve as any)[v], settings.vals[k]])
                    .filter(([_, v, k2]) => v !== undefined && v !== null && !!k2)

                for (const [, v, k2] of propsC1) {
                    const prev = (newCurve as any)[k2]
                    if (prev === undefined) continue
                    if (typeof prev === 'object' && typeof prev.copy === 'function')
                        (newCurve as any)[k2].copy(v)
                    else if (Array.isArray(prev) && Array.isArray(v))
                        (newCurve as any)[k2] = [...v]
                    else if (typeof prev === 'object' && typeof v === 'object' && v !== null)
                        (newCurve as any)[k2] = {...v}
                    else
                        (newCurve as any)[k2] = v
                }
            }

            onTypeChange(newCurve)
            return true
        },
    }
}

/**
 * Create UI config entries for editing the properties of a curve.
 */
export function createCurvePropertyUi(curve: Curve<Vector2 | Vector3>, configs: Record<string, CurveUiEntry> = curveUiConfigs): UiObjectConfig[] {
    const type = (curve as any).type as string
    const entry = configs[type]
    if (!entry) return []

    const folder: UiObjectConfig = {
        type: 'folder',
        label: type.replace(/([A-Z])/g, ' $1').trim(),
        children: entry.getUiConfig(curve as any) || [],
    }
    ;(curve as IUiConfigContainer).uiConfig = folder
    return [folder]
}
