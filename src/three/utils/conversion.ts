import {Color, DataTexture, LinearSRGBColorSpace, RGBAFormat, UnsignedByteType, Vector4} from 'three'

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
