import {
    ColorSpace,
    DataTexture,
    DataUtils,
    FloatType,
    HalfFloatType,
    LinearSRGBColorSpace,
    Texture, TextureImageData,
    TextureDataType,
    UnsignedByteType,
    WebGLRenderer,
} from 'three'
import {canvasFlipY, LinearToSRGB} from 'ts-browser-helpers'

export function getTextureDataType(renderer?: WebGLRenderer): TextureDataType {
    if (!renderer) return UnsignedByteType
    const halfFloatSupport = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')
    const floatSupport = renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_texture_float') || renderer.extensions.has('WEBGL_color_buffer_float')
    return halfFloatSupport ? HalfFloatType : floatSupport ? FloatType : UnsignedByteType
}

export function textureDataToImageData(imgData: TextureImageData | ImageData | {data: Float32Array|Uint16Array|Uint8Array, width: number, height: number}, colorSpace?: ColorSpace, outData?: ImageData) {
    const data = outData?.data ?? new Uint8ClampedArray(imgData.height * imgData.width * 4)
    const isFloat32 = imgData.data instanceof Float32Array
    const isUint16 = imgData.data instanceof Uint16Array

    for (let i = 0; i < data.length; i++) {

        if (isFloat32) { // Float32
            data[i] = imgData.data[i] * 255
        } else if (isUint16) { // Uint16 (half float)
            data[i] = DataUtils.fromHalfFloat(imgData.data[i]) * 255
        } else { // Uint8
            data[i] = imgData.data[i]
        }

        if (colorSpace === LinearSRGBColorSpace) {
            data[i] = LinearToSRGB(data[i] / 255.0) * 255
        }
        // todo: rgbm?

    }
    return outData ?? new ImageData(data, imgData.width, imgData.height)
}

/**
 *
 * @param texture
 * @param maxWidth
 * @param flipY
 * @param canvas
 */
export function textureToCanvas(texture: Texture|DataTexture, maxWidth: number, flipY = false) {
    let img
    if ((texture as DataTexture).isDataTexture) img = textureDataToImageData(texture.image, texture.colorSpace)
    else img = texture.image
    return texImageToCanvas(img, maxWidth, flipY)
}

export function texImageToCanvas(image: TexImageSource, maxWidth: number, flipY = false) {
    let width, height
    if (!window.VideoFrame) window.VideoFrame = HTMLVideoElement as any
    if (image instanceof window.VideoFrame) {
        width = image.displayWidth
        height = image.displayHeight
    } else {
        width = image.width || (image as HTMLVideoElement).videoWidth || (image as HTMLImageElement).naturalWidth || 1
        height = image.height || (image as HTMLVideoElement).videoHeight || (image as HTMLImageElement).naturalHeight || 1
    }
    if (window.VideoFrame as any === HTMLVideoElement) delete (window as any).VideoFrame
    const canvas = document.createElement('canvas')
    // resize it to the size of our image
    canvas.width = Math.min(maxWidth, width)
    canvas.height = Math.floor(1.0 + canvas.width * height / width)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
        console.error('textureToDataUrl: could not get canvas context')
        return canvas
    }

    if (flipY === true) {

        ctx.translate(0, canvas.height)
        ctx.scale(1, -1)

    }

    let needsFlipY = false
    if ((image as ImageData).data !== undefined) { // THREE.DataTexture
        const imageData = image as ImageData

        if (width !== canvas.width || height !== canvas.height) {
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = width
            tempCanvas.height = height
            const tempCtx = tempCanvas.getContext('2d')
            if (!tempCtx) {
                console.error('textureToDataUrl: could not get temp canvas context')
                ctx.putImageData(imageData, 0, 0)
            } else {
                tempCtx.putImageData(imageData, 0, 0) // for resize
                ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height)
            }
        } else {
            ctx.putImageData(imageData, 0, 0)
            if (flipY) needsFlipY = true // because of putImageData
        }

    } else {
        ctx.drawImage(image as any, 0, 0, canvas.width, canvas.height)
    }
    return !needsFlipY ? canvas : canvasFlipY(canvas)
}

export function textureToDataUrl(texture: Texture|DataTexture, maxWidth: number, flipY: boolean, mimeType?: string, quality?: number) {
    return textureToCanvas(texture, maxWidth, flipY).toDataURL(mimeType, quality)
}
export async function textureToBlob(texture: Texture|DataTexture, maxWidth: number, flipY: boolean, mimeType?: string, quality?: number) {
    const canvas = textureToCanvas(texture, maxWidth, flipY)
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob)
            else reject(new Error('Failed to create blob'))
        }, mimeType, quality)
    })
}
