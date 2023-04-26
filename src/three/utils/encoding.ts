import {
    ColorSpace,
    LinearSRGBColorSpace,
    NoColorSpace,
    RGBAFormat,
    RGBM16ColorSpace,
    SRGBColorSpace,
    Texture,
    UnsignedByteType,
    WebGLRenderTarget,
} from 'three'

export function getEncodingComponents(colorSpace: ColorSpace) {

    switch (colorSpace) {

    case NoColorSpace:
    case LinearSRGBColorSpace:
        return ['Linear', '( value )']
    case SRGBColorSpace:
        return ['sRGB', '( value )']
        // case RGBEEncoding:
        //     return ['RGBE', '( value )']
        // case RGBM7Encoding:
        //     return ['RGBM', '( value, 7.0 )']
    case RGBM16ColorSpace:
        return ['RGBM', '( value, 16.0 )']
        // case RGBDEncoding:
        //     return ['RGBD', '( value, 256.0 )']
        // case GammaEncoding:
        //     return ['Gamma', '( value, float( GAMMA_FACTOR ) )']
        // case LogLuvEncoding:
        //     return ['LogLuv', '( value )']
    default:
        console.warn('utils: Unsupported colorspace:', colorSpace)
        return ['Linear', '( value )']

    }

}

export function getTextureColorSpaceFromMap(map: Texture | WebGLRenderTarget | null | undefined, isWebGL2: boolean): ColorSpace {

    let colorSpace

    if (map && (<Texture>map).isTexture) {

        colorSpace = (<Texture>map).colorSpace

    } else if (map && (<WebGLRenderTarget>map).isWebGLRenderTarget) {

        console.warn('THREE.WebGLPrograms.getTextureColorSpaceFromMap: don\'t use render targets as textures. Use their .texture property instead.')
        colorSpace = (<WebGLRenderTarget>map).texture.colorSpace

    } else {

        colorSpace = LinearSRGBColorSpace

    }

    // See https://github.com/mrdoob/three.js/pull/22952
    // todo: just check if srgb8 is enabled, instead of relying on threejs.

    if (isWebGL2 && map && (<Texture>map).isTexture && (<Texture>map).format === RGBAFormat && (<Texture>map).type === UnsignedByteType && (<Texture>map).colorSpace === SRGBColorSpace) {

        colorSpace = LinearSRGBColorSpace // disable inline decode for sRGB textures in WebGL 2

    }


    return colorSpace

}

export function getTexelDecodingFunction(functionName: string, colorSpace: ColorSpace) {

    const components = getEncodingComponents(colorSpace)
    return 'vec4 ' + functionName + '( vec4 value ) { return ' + components[ 0 ] + 'ToLinear' + components[ 1 ] + '; }'

}

export function getTexelDecoding(mapName: string, map: Texture | WebGLRenderTarget | null | undefined | any, isWebGL2: boolean) {

    return getTexelDecodingFunction(mapName + 'TexelToLinear', getTextureColorSpaceFromMap(map, isWebGL2)) + '\n'

}

export function getTexelDecoding2(mapName: string, colorSpace: ColorSpace) {

    return getTexelDecodingFunction(mapName + 'TexelToLinear', colorSpace) + '\n'

}

export function getTexelEncodingFunction(functionName: string, colorSpace: ColorSpace) {

    const components = getEncodingComponents(colorSpace)
    return 'vec4 ' + functionName + '( vec4 value ) { return LinearTo' + components[ 0 ] + components[ 1 ] + '; }'

}

export function getTexelEncoding(functionName: string, map: Texture | WebGLRenderTarget | null | undefined | any, isWebGL2: boolean) {

    return getTexelEncodingFunction(functionName, getTextureColorSpaceFromMap(map, isWebGL2))

}
