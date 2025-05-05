import {now} from 'ts-browser-helpers'

export interface CanvasSnapshotRect {
    height: number;
    width: number;
    x: number;
    y: number;
    /**
     * Use if canvas.width !== canvas.clientWidth or height and rect is based on client rect
     * @default false
     */
    assumeClientRect?: boolean;
    /**
     * If true, assumes x, y, width, height are normalized to 0-1
     * @default false
     */
    normalized?: boolean;
}

export interface CanvasSnapshotOptions {
    getDataUrl?: boolean,
    mimeType?: string,
    quality?: number, // between 0 and 1, only for image/jpeg or image/webp
    /**
     * Crop Region to take snapshot. If not set, the whole canvas is used.
     */
    rect?: CanvasSnapshotRect,
    scale?: number,
    displayPixelRatio?: number,
    cloneCanvas?: boolean, // default = true if safari, false otherwise. required for safari where canvas is flipped if premultipliedAlpha is true
}

function isSafari() {
    return navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')
}

export class CanvasSnapshot {
    public static Debug = false
    public static async GetClonedCanvas(
        canvas: HTMLCanvasElement,
        {
            rect = {x: 0, y: 0, width: canvas.width, height: canvas.height, assumeClientRect: false, normalized: false},
            displayPixelRatio = 1,
            scale = 1,
        }: CanvasSnapshotOptions): Promise<HTMLCanvasElement> {
        rect = {...rect}

        // return canvas.toDataURL(mimeType);
        // in Safari, images are flipped when premultipliedAlpha is true in canvas, so it works with 2d context, see: https://github.com/pixijs/pixi.js/blob/dev/packages/extract/src/Extract.ts and https://github.com/pixijs/pixi.js/issues/2951

        const destCanvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement

        // const iRect = {...rect}

        if (!rect.normalized) {
            if (rect.assumeClientRect) {
                rect.x = Math.floor(rect.x * canvas.width / (displayPixelRatio * canvas.clientWidth))
                rect.y = Math.floor(rect.y * canvas.height / (displayPixelRatio * canvas.clientHeight))
                rect.width = Math.floor(rect.width * canvas.width / (displayPixelRatio * canvas.clientWidth))
                rect.height = Math.floor(rect.height * canvas.height / (displayPixelRatio * canvas.clientHeight))
            }
        } else {
            rect.x = Math.floor(rect.x * canvas.width)
            rect.y = Math.floor(rect.y * canvas.height)
            rect.width = Math.floor(rect.width * canvas.width)
            rect.height = Math.floor(rect.height * canvas.height)
            if (rect.assumeClientRect) {
                console.warn('CanvasSnapshot: rect.assumeClientRect is ignored when rect is normalized')
            }
        }

        destCanvas.width = Math.floor(rect.width * scale * displayPixelRatio)
        destCanvas.height = Math.floor(rect.height * scale * displayPixelRatio)

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
                    Math.floor(img.width * rect.x * displayPixelRatio / canvas.width), Math.floor(img.height * rect.y * displayPixelRatio / canvas.height),
                    Math.floor(img.width * rect.width * displayPixelRatio / canvas.width), Math.floor(img.height * rect.height * displayPixelRatio / canvas.height),
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
            Math.floor(rect.x * displayPixelRatio), Math.floor(rect.y * displayPixelRatio), Math.floor(rect.width * displayPixelRatio), Math.floor(rect.height * displayPixelRatio),
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
        const doClone = isSafari() || options.cloneCanvas || options.rect || options.scale || options.displayPixelRatio
        if (!doClone && (options.rect || options.scale || options.displayPixelRatio)) console.warn('CanvasSnapshot: rect, scale and displayPixelRatio are ignored when cloneCanvas is false')
        const clone = !doClone ? canvas : await this.GetClonedCanvas(canvas, options)
        // const clone = options.cloneCanvas === false ? canvas : await this.GetClonedCanvas(canvas, options)
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
        const doClone = isSafari() || options.cloneCanvas || options.rect || options.scale || options.displayPixelRatio
        if (!doClone && (options.rect || options.scale || options.displayPixelRatio)) console.warn('rect, scale and displayPixelRatio are ignored when cloneCanvas is false')
        const clone = !doClone ? canvas : await this.GetClonedCanvas(canvas, options)
        // const clone = options.cloneCanvas === false ? canvas : await this.GetClonedCanvas(canvas, options)

        const blob = await new Promise<Blob>((resolve, reject) => {
            clone.toBlob((b) => {
                if (b) resolve(b)
                else reject(new Error('CanvasSnapshot Failed to export blob from canvas'))
            }, options.mimeType ?? 'image/png', options.quality)
        })
        if (!this.Debug && clone !== canvas) clone.remove()

        return blob
    }

    public static async GetFile(canvas: HTMLCanvasElement, filename = 'image', options: CanvasSnapshotOptions = {}): Promise<File|string> {
        const suffix = '.' + (options.mimeType?.split('/')[1]?.toLowerCase() || 'png')
        const fname = !filename.toLowerCase().endsWith(suffix) ? filename + suffix : filename
        return options.getDataUrl ? await this.GetDataUrl(canvas, options) : new File([await this.GetBlob(canvas, options)], fname, {
            type: options.mimeType ?? 'image/png',
            lastModified: now(),
        })
    }

    public static async GetTiledFiles(canvas: HTMLCanvasElement, filePrefix = 'image', tileRows = 2, tileCols = 2, options: CanvasSnapshotOptions = {}): Promise<(File|string)[]> {
        const rect = options.rect ?? {x: 0, y: 0, width: 1, height: 1, assumeClientRect: false, normalized: true}

        // rect.width *= options.displayPixelRatio ?? 1
        // rect.height *= options.displayPixelRatio ?? 1

        const files = []
        for (let i = 0; i < tileCols; i++) {
            for (let j = 0; j < tileRows; j++) {
                const ext = options.mimeType?.split('/')[1] ?? 'png'
                const file = await this.GetFile(canvas, `${filePrefix}_${i}_${j}.${ext}`, {
                    rect: {
                        x: rect.x + i * rect.width / tileCols,
                        y: rect.y + j * rect.height / tileRows,
                        width: rect.width / tileCols,
                        height: rect.height / tileRows,
                        assumeClientRect: rect.assumeClientRect,
                        normalized: rect.normalized,
                    },
                }).catch(e => {
                    console.error(`CanvasSnapshot - Error exporting tiled file ${i}, ${j}`, e)
                    return null
                })
                if (file)
                    files.push(file)
            }
        }
        return files
    }

}
