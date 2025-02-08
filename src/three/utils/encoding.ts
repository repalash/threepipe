import {ColorSpace, LinearSRGBColorSpace, NoColorSpace, RGBM16ColorSpace, SRGBColorSpace} from 'three'

// three.js WebGLProgram.js
export function getTexelDecodingFunction(functionName: string, colorSpace: ColorSpace) {

    let fn
    switch (colorSpace) {

    case NoColorSpace:
    case LinearSRGBColorSpace:
        fn = ''
        break
    case SRGBColorSpace:
        // fn = 'sRGBToLinear' // todo required?
        fn = ''
        break
    case RGBM16ColorSpace:
        fn = 'RGBM16ToLinear'
        break
    default:
        console.warn('THREE.WebGLProgram: Unsupported color space:', colorSpace)
        fn = ''
        break

    }

    // return `vec4 ${functionName}( vec4 value ) { return ${components[ 0 ]}ToLinear${components[ 1 ]}; }`;
    // return `vec4 ${functionName}( vec4 value ) { return ${fn} ( value ); }`
    return `#define ${functionName}( value ) ${fn} ( value )`

}

export function getTexelDecoding(mapName: string, colorSpace?: ColorSpace) {

    return getTexelDecodingFunction(mapName + 'TexelToLinear', colorSpace ?? LinearSRGBColorSpace) + '\n'

}
