import {FloatType, HalfFloatType, TextureDataType, UnsignedByteType, WebGLRenderer} from 'three'

export function getTextureDataType(renderer?: WebGLRenderer): TextureDataType {
    if (!renderer) return UnsignedByteType
    const halfFloatSupport = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')
    const floatSupport = renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_texture_float') || renderer.extensions.has('WEBGL_color_buffer_float')
    return halfFloatSupport ? HalfFloatType : floatSupport ? FloatType : UnsignedByteType
}

