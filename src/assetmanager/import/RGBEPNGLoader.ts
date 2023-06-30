import {
    DataTexture,
    DataUtils,
    FileLoader,
    FloatType,
    HalfFloatType,
    LinearFilter,
    LoadingManager,
    RGBAFormat,
    SRGBColorSpace,
    TextureDataType,
} from 'three'
import {imageUrlToImageData} from 'ts-browser-helpers'

/**
 * 8bit HDR image in png format
 * not properly working with files from hdrpng.js but used in {@link GLTFViewerConfigExtension}, so a slightly modified version is used here
 */
export class RGBEPNGLoader extends FileLoader {
    type: TextureDataType = HalfFloatType
    constructor(manager?: LoadingManager) {
        super(manager)
    }
    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
        const image = await this.parseAsync(url, onProgress, false)
        const texture = new DataTexture(image.data, image.width, image.height, RGBAFormat, this.type)
        texture.needsUpdate = true
        texture.flipY = true
        texture.colorSpace = SRGBColorSpace
        texture.minFilter = LinearFilter
        texture.magFilter = LinearFilter
        texture.source.data.complete = true
        return texture
    }
    async parseAsync(url: string, onProgress?: (event: ProgressEvent) => void, isFloat16Data = false): Promise<any> {
        let created = false
        if (!url.startsWith('data:') && !url.startsWith('blob:')) {
            this.responseType = 'blob'
            const blob = await super.loadAsync(url, onProgress) as any as Blob
            // url = await blobToDataURL(blob)
            // console.log(url)
            // url = url.replace('application/octet-stream', 'image/png')
            url = URL.createObjectURL(blob)
            created = true
        }
        const imageData = await imageUrlToImageData(url)
        if (created) URL.revokeObjectURL(url)
        let aType: any = Uint8Array
        if (this.type === HalfFloatType) aType = Uint16Array
        else if (this.type === FloatType) aType = Float32Array
        const buffer = rgbeToHalfFloat(imageData.data, 4, aType, isFloat16Data)
        return {data: buffer, width: imageData.width, height: imageData.height}
    }
    setDataType(value: TextureDataType) {
        this.type = value
        return this
    }
}

// adapted from https://github.com/enkimute/hdrpng.js/blob/3a62b3ae2940189777df9f669df5ece3e78d9c16/hdrpng.js#L253
// channels = 4 for RGBA data or 3 for RGB data. res to use with THREE.DataTexture
function rgbeToHalfFloat(buffer: Uint8ClampedArray, channels = 3, type = Uint16Array, float16Data = false): Uint16Array {
    let s
    const l = buffer.byteLength >> 2
    const res = new type(l * channels)
    for (let i = 0;i < l;i++) {
        s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8))
        if (float16Data) {
            res[ i * channels ] = Math.min(buffer[i * 4] * s, 65504)
            res[ i * channels + 1] = Math.min(buffer[i * 4 + 1] * s, 65504)
            res[ i * channels + 2] = Math.min(buffer[i * 4 + 2] * s, 65504)
        } else {
            res[i * channels] = DataUtils.toHalfFloat(Math.min(buffer[i * 4] * s, 65504))
            res[i * channels + 1] = DataUtils.toHalfFloat(Math.min(buffer[i * 4 + 1] * s, 65504))
            res[i * channels + 2] = DataUtils.toHalfFloat(Math.min(buffer[i * 4 + 2] * s, 65504))
        }
        // res[i * channels] = Math.min(15360, buffer[i * 4] * s)
        // res[i * channels + 1] = Math.min(15360, buffer[i * 4 + 1] * s)
        // res[i * channels + 2] = Math.min(15360, buffer[i * 4 + 2] * s)
        if (channels === 4) res[i * channels + 3] = DataUtils.toHalfFloat(1) // alpha is always 1 // todo: handle for uint8 and float32
    }
    return res
}


