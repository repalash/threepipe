import {MathUtils, Vector2} from 'threepipe'

export const computeFocalLengths = (width: number, height: number, fov: number, aspect: number, dpr: number) => {
    const fovRad = MathUtils.degToRad(fov)
    const fovXRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
    const fy = dpr * height / (2 * Math.tan(fovRad / 2))
    const fx = dpr * width / (2 * Math.tan(fovXRad / 2))
    return new Vector2(fx, fy)
}
