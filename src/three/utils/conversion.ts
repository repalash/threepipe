import {Color, DataTexture, DataUtils, LinearSRGBColorSpace, RGBAFormat, UnsignedByteType, Vector4} from 'three'

export function dataTextureFromColor(color: Color) {
    const dataTexture = new DataTexture(new Uint8Array([Math.floor(color.r * 255), Math.floor(color.g * 255), Math.floor(color.b * 255), 255]), 1, 1, RGBAFormat, UnsignedByteType)
    dataTexture.needsUpdate = true
    dataTexture.colorSpace = LinearSRGBColorSpace
    return dataTexture
}

export function dataTextureFromVec4(color: Vector4) {
    const dataTexture = new DataTexture(new Uint8Array([Math.floor(color.x * 255), Math.floor(color.y * 255), Math.floor(color.z * 255), Math.floor(color.w * 255)]), 1, 1, RGBAFormat, UnsignedByteType)
    dataTexture.needsUpdate = true
    return dataTexture
}

/**
 * Convert half float buffer to rgbe
 * adapted from https://github.com/enkimute/hdrpng.js/blob/3a62b3ae2940189777df9f669df5ece3e78d9c16/hdrpng.js#L235
 * channels = 4 for RGBA data or 3 for RGB data. buffer from THREE.DataTexture
 * @param buffer
 * @param channels
 * @param res
 */
export function halfFloatToRgbe(buffer: Uint16Array, channels = 3, res?: Uint8ClampedArray): Uint8ClampedArray {
    let r, g, b, v, s
    const l = buffer.byteLength / (channels * 2) | 0
    res = res || new Uint8ClampedArray(l * 4)
    for (let i = 0;i < l;i++) {
        r = DataUtils.fromHalfFloat(buffer[i * channels]) * 65504
        g = DataUtils.fromHalfFloat(buffer[i * channels + 1]) * 65504
        b = DataUtils.fromHalfFloat(buffer[i * channels + 2]) * 65504
        v = Math.max(Math.max(r, g), b)
        const e = Math.ceil(Math.log2(v)); s = Math.pow(2, e - 8)
        res[i * 4] = r / s | 0
        res[i * 4 + 1] = g / s | 0
        res[i * 4 + 2] = b / s | 0
        res[i * 4 + 3] = e + 128
    }
    return res
}
