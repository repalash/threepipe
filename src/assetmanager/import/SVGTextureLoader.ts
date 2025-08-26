import {CanvasTexture, ImageLoader, Loader, LoadingManager, Texture} from 'three'
import {getUrlQueryParam} from 'ts-browser-helpers'

/**
 * Same as TextureLoader but loads SVG images, fixes issues with windows not loading svg files without a defined size.
 * See - https://github.com/mrdoob/three.js/issues/30899
 *
 * todo - create example for test, see sample code in gh issue.
 */
class SVGTextureLoader extends Loader<Texture> {

    constructor(manager?: LoadingManager) {

        super(manager)

    }

    static USE_CANVAS_TEXTURE = getUrlQueryParam('svg-load-disable-canvas') !== 'true'

    load(url: string, onLoad: (texture: Texture) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void): Texture {

        const canvas = SVGTextureLoader.USE_CANVAS_TEXTURE ? document.createElement('canvas') : undefined
        const texture = SVGTextureLoader.USE_CANVAS_TEXTURE ? new CanvasTexture(canvas!) : new Texture()

        const loader = new ImageLoader(this.manager)
        loader.setCrossOrigin(this.crossOrigin)
        loader.setPath(this.path)

        loader.load(url, function(image) {

            if (canvas) {
                SVGTextureLoader.CopyImageToCanvas(canvas, image)
            } else {

                texture.image = image

            }
            texture.needsUpdate = true

            if (onLoad !== undefined) {

                onLoad(texture)

            }

        }, onProgress, onError)

        return texture

    }

    static CopyImageToCanvas(canvas: HTMLCanvasElement, image: HTMLImageElement) {
        // size can be scaled here, this is based on the viewBox aspect ratio and minimum size of 150hx300w
        canvas.width = image.naturalWidth || image.width || 512
        canvas.height = image.naturalHeight || image.height || 512

        const ctx = canvas.getContext('2d')
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        } else {
            console.error('SVGTextureLoader: Failed to get canvas context.')
        }
    }

}


export {SVGTextureLoader}
