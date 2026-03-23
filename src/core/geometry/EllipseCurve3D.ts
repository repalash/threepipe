import {EllipseCurve, Vector3} from 'three'

/**
 * A 3D version of three.js EllipseCurve that returns Vector3 points.
 * Useful for creating circular/elliptical 3D paths for TubeGeometry and TubeShapeGeometry.
 *
 * Note: EllipseCurve extends Curve<Vector2>, but this override returns Vector3 at runtime.
 * Type casts may be needed when passing to APIs expecting Curve<Vector3>.
 */
export class EllipseCurve3D extends EllipseCurve {
    getPoint(t: number, optionalTarget?: any) {
        return super.getPoint(t, (optionalTarget || new Vector3()) as any)
    }
}
