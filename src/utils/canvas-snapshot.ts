import {now} from 'ts-browser-helpers'

export interface CanvasSnapshotRect {
    height: number;
    width: number;
    x: number;
    y: number;
    /**
     * Use if canvas.width !== canvas.clientWidth or height and rect is based on client rect
     */
    assumeClientRect?: boolean;
}

export interface CanvasSnapshotOptions {
    getDataUrl?: boolean,
    mimeType?: string,
    quality?: number, // between 0 and 1, only for image/jpeg or image/webp
    rect?: CanvasSnapshotRect,
    scale?: number,
    timeout?: number, // in ms, if not specified, will be based on progressive rendering or 200ms
    displayPixelRatio?: number,
    cloneCanvas?: boolean, // default = true
}

export class CanvasSnapshot {
    public static Debug = false
    public static async GetClonedCanvas(
        canvas: HTMLCanvasElement,
        {
            rect = {x: 0, y: 0, width: canvas.width, height: canvas.height, assumeClientRect: false},
            displayPixelRatio = 1,
            scale = 1,
        }: CanvasSnapshotOptions): Promise<HTMLCanvasElement> {
        // return canvas.toDataURL(mimeType);
        // in Safari, images are flipped when premultipliedAlpha is true in canvas, so it works with 2d context, see: https://github.com/pixijs/pixi.js/blob/dev/packages/extract/src/Extract.ts and https://github.com/pixijs/pixi.js/issues/2951

        const destCanvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement
        destCanvas.width = rect.width * scale * displayPixelRatio
        destCanvas.height = rect.height * scale * displayPixelRatio

        // const iRect = {...rect}

        if (rect.assumeClientRect) {
            rect.x *= canvas.width / (displayPixelRatio * canvas.clientWidth)
            rect.y *= canvas.height / (displayPixelRatio * canvas.clientHeight)
            rect.width *= canvas.width / (displayPixelRatio * canvas.clientWidth)
            rect.height *= canvas.height / (displayPixelRatio * canvas.clientHeight)
        }

        const destCtx = destCanvas.getContext('2d')
        if (!destCtx) {
            console.error('snapshot: cannot create context')
            return destCanvas
        }

        // console.log(canvas.style.background)
        const background = canvas.style.background || canvas.parentElement?.style.background || ''
        if (background.includes('url')) {
            const url = /url\("(.*)"\)/ig.exec(background)?.[1]
            if (url) {
                const img = new Image()
                img.src = url
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve()
                    img.onerror = () => reject()
                    if (img.complete) resolve()
                })
                destCtx.drawImage(img,
                    img.width * rect.x * displayPixelRatio / canvas.width, img.height * rect.y * displayPixelRatio / canvas.height,
                    img.width * rect.width * displayPixelRatio / canvas.width, img.height * rect.height * displayPixelRatio / canvas.height,
                    0, 0,
                    destCanvas.width,
                    destCanvas.height,
                )

            }
        } else {
            destCtx.fillStyle = canvas.style.background || canvas.parentElement?.style.backgroundColor || '#00000000'
            destCtx.fillRect(0, 0, destCanvas.width, destCanvas.height)
        }

        destCtx?.drawImage(
            canvas,
            rect.x * displayPixelRatio, rect.y * displayPixelRatio, rect.width * displayPixelRatio, rect.height * displayPixelRatio,
            0, 0, destCanvas.width, destCanvas.height,
        )

        const debug = this.Debug
        if (debug) {
            // console.log(
            //     destCanvas,
            // )
            document.body.appendChild(destCanvas)
            destCanvas.style.position = 'absolute'
            destCanvas.style.top = '0'
            destCanvas.style.left = '0'
            destCanvas.style.borderWidth = '2px'
            destCanvas.style.borderColor = '#ff00ff'
            setTimeout(() => destCanvas.remove(), 5000)
        }

        return destCanvas
    }

    public static async GetDataUrl(canvas: HTMLCanvasElement, {mimeType = 'image/png', quality, ...options}: CanvasSnapshotOptions): Promise<string> {
        const clone = options.cloneCanvas === false ? canvas : await this.GetClonedCanvas(canvas, options)
        const url = clone.toDataURL(mimeType, quality)
        if (!this.Debug && clone !== canvas) clone.remove()
        return url
    }

    // set one of canvas or context to draw in.
    public static async GetImage(canvas: HTMLCanvasElement, options: CanvasSnapshotOptions = {}): Promise<HTMLImageElement> {
        const imgUrl = await this.GetDataUrl(canvas, options)
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject()
            img.src = imgUrl
        })
    }

    public static async GetBlob(canvas: HTMLCanvasElement, options: CanvasSnapshotOptions = {}): Promise<Blob> {
        const clone = options.cloneCanvas === false ? canvas : await this.GetClonedCanvas(canvas, options)

        const blob = await new Promise<Blob>((resolve, reject) => {
            clone.toBlob((b) => {
                if (b) resolve(b)
                else reject()
            }, options.mimeType ?? 'image/png', options.quality)
        })
        if (!this.Debug && clone !== canvas) clone.remove()

        return blob
    }

    public static async GetFile(canvas: HTMLCanvasElement, filename = 'image.png', options: CanvasSnapshotOptions = {}): Promise<File|string> {
        return options.getDataUrl ? await this.GetDataUrl(canvas, options) : new File([await this.GetBlob(canvas, options)], filename, {
            type: options.mimeType ?? 'image/png',
            lastModified: now(),
        })
    }

}
