import {Color, Vector4} from 'three'
// todo: move these to ts-browser-helpers maybe

// reference: http://iwasbeingirony.blogspot.ca/2010/06/difference-between-rgbm-and-rgbd.html
export function vRGBMToLinear(value: Vector4, maxRange: number): Vector4 {
    value.multiplyScalar(value.w * maxRange)
    value.w = 1.0
    return value
}

export function cRGBMToLinear(value: Vector4, maxRange: number): Color {
    vRGBMToLinear(value, maxRange)
    return new Color(value.x, value.y, value.z)
}

export function vLinearToRGBM(value: Vector4, maxRange: number): Vector4 {
    const maxRGB = Math.max(value.x, Math.max(value.y, value.z))
    let M = Math.max(Math.min(maxRGB / maxRange, 1.0), 0.0)
    M = Math.ceil(M * 255.0) / 255.0
    value.divideScalar(M * maxRange)
    value.w = M
    return value
}
export function cLinearToRGBM(value: Color, maxRange: number): Vector4 {
    return vLinearToRGBM(new Vector4(value.r, value.g, value.b, 1.0), maxRange)
}
