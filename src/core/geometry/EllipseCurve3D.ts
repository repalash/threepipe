import {EllipseCurve, Vector3} from 'three'
import {Serialization} from 'ts-browser-helpers'

/**
 * A 3D version of three.js EllipseCurve that returns Vector3 points.
 * Useful for creating circular/elliptical 3D paths for TubeGeometry and TubeShapeGeometry.
 *
 * Note: EllipseCurve extends Curve<Vector2>, but this override returns Vector3 at runtime.
 * Type casts may be needed when passing to APIs expecting Curve<Vector3>.
 */
export class EllipseCurve3D extends EllipseCurve {
    override readonly type: string | 'EllipseCurve3D'
    constructor(aX?: number, aY?: number, xRadius?: number, yRadius?: number, aStartAngle?: number, aEndAngle?: number, aClockwise?: boolean, aRotation?: number) {
        super(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation)
        this.type = 'EllipseCurve3D'
    }
    getPoint(t: number, optionalTarget?: any) {
        return super.getPoint(t, (optionalTarget || new Vector3()) as any)
    }
    static {
        Serialization.SerializableClasses.set('EllipseCurve3D', EllipseCurve3D)
    }
}
