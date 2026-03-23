import {CatmullRomCurve3, CubicBezierCurve3, Curve, LineCurve3, Vector3} from 'three'
import {generateValueConfig, UiObjectConfig} from 'uiconfig.js'
import {Class} from 'ts-browser-helpers'
import {IUiConfigContainer} from 'uiconfig.js'
import {EllipseCurve3D} from '../../../core/geometry/EllipseCurve3D'

type Supported3DCurve = LineCurve3 | CubicBezierCurve3 | CatmullRomCurve3 | EllipseCurve3D

interface CurveUiEntry {
    ctor?: Class<Supported3DCurve>,
    getUiConfig: (curve: Supported3DCurve) => UiObjectConfig['children']
    vals: Record<string, string>
}

const curveUiConfigs: Record<string, CurveUiEntry> = {
    LineCurve3: {
        ctor: LineCurve3,
        vals: {start: 'v1', end: 'v2'},
        getUiConfig: (curve: LineCurve3) => [
            generateValueConfig(curve, 'v1', 'Start Point'),
            generateValueConfig(curve, 'v2', 'End Point'),
        ] as UiObjectConfig['children'],
    },
    CubicBezierCurve3: {
        ctor: CubicBezierCurve3,
        vals: {start: 'v0', end: 'v3', control1: 'v1', control2: 'v2'},
        getUiConfig: (curve: CubicBezierCurve3) => [
            generateValueConfig(curve, 'v0', 'Start Point'),
            generateValueConfig(curve, 'v1', 'Control Point 1'),
            generateValueConfig(curve, 'v2', 'Control Point 2'),
            generateValueConfig(curve, 'v3', 'End Point'),
        ] as UiObjectConfig['children'],
    },
    CatmullRomCurve3: {
        ctor: CatmullRomCurve3,
        vals: {points: 'points', closed: 'closed', curveType: 'curveType', tension: 'tension'},
        getUiConfig: (curve: CatmullRomCurve3) => [
            () => curve.points.map((_, i) => generateValueConfig(curve.points, i.toString(), `Point ${i}`)),
            {
                type: 'button',
                label: 'Add Point',
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
                type: 'dropdown',
                property: [curve, 'curveType'],
                label: 'Curve Type',
                children: ['centripetal', 'chordal', 'catmullrom'].map(value => ({label: value, value})),
            },
            generateValueConfig(curve, 'tension', 'Tension'),
        ] as UiObjectConfig['children'],
    },
    EllipseCurve3D: {
        ctor: EllipseCurve3D,
        vals: {centerX: 'aX', centerY: 'aY', radiusX: 'xRadius', radiusY: 'yRadius'},
        getUiConfig: (curve: EllipseCurve3D) => [
            generateValueConfig(curve, 'aX', 'X Center'),
            generateValueConfig(curve, 'aY', 'Y Center'),
            generateValueConfig(curve, 'xRadius', 'X Radius'),
            generateValueConfig(curve, 'yRadius', 'Y Radius'),
            generateValueConfig(curve, 'aStartAngle', 'Start Angle'),
            generateValueConfig(curve, 'aEndAngle', 'End Angle'),
            generateValueConfig(curve, 'aClockwise', 'Clockwise'),
            generateValueConfig(curve, 'aRotation', 'Rotation'),
        ] as UiObjectConfig['children'],
    },
}

/**
 * Create a curve type dropdown UI config for selecting between supported 3D curve types.
 */
export function createCurveTypeDropdown(
    curve: Curve<Vector3>,
    onTypeChange: (newCurve: Curve<Vector3>) => void,
): UiObjectConfig {
    return {
        type: 'dropdown',
        label: 'Curve Type',
        children: Object.keys(curveUiConfigs).map(key => ({
            label: key.replace(/([A-Z])/g, ' $1').trim(),
            value: key,
        })),
        getValue: () => curve ? (curve as any).type || 'LineCurve3' : 'LineCurve3',
        setValue: (v1: string) => {
            const settings = curveUiConfigs[v1]
            if (!settings?.ctor || (curve as any).type === v1) return true
            const newCurve = new settings.ctor()
            if (Array.isArray((newCurve as CatmullRomCurve3).points) && (newCurve as CatmullRomCurve3).points.length === 0) {
                (newCurve as CatmullRomCurve3).points.push(new Vector3(0, 0, 0), new Vector3(1, 1, 1))
            }
            onTypeChange(newCurve as any)
            return true
        },
    }
}

/**
 * Create UI config entries for editing the properties of a 3D curve.
 */
export function createCurvePropertyUi(curve: Curve<Vector3>): UiObjectConfig[] {
    const type = (curve as any).type as string
    const entry = curveUiConfigs[type]
    if (!entry) return []

    const folder: UiObjectConfig = {
        type: 'folder',
        label: type.replace(/([A-Z])/g, ' $1').trim(),
        children: entry.getUiConfig(curve as any) || [],
    }
    ;(curve as IUiConfigContainer).uiConfig = folder
    return [folder]
}
