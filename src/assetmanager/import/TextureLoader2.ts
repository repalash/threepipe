import {FileLoader, Texture, TextureLoader} from 'three'

const rasterMimeByExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tif: 'image/tiff', tiff: 'image/tiff',
    ico: 'image/x-icon',
}

function mimeTypeFromUrl(url: string): string | undefined {
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
    return ext ? rasterMimeByExt[ext] : undefined
}

/**
 * Opt-in subclass of three.js {@link TextureLoader} that preserves the raw compressed
 * source bytes of a loaded raster image on `texture.source._sourceImgBuffer`.
 *
 * **Why**: three.js's default `TextureLoader` → `ImageLoader` → `<img>.src = url` flow
 * lets the browser decode and discards the original bytes. On GLB export, three.js's
 * `GLTFExporter.processImage` then has to re-encode via `canvas.drawImage` +
 * `canvas.toBlob('image/jpeg')`, which is non-deterministic across Chromium/GL
 * backends (libjpeg version, GPU readback rounding), quality-lossy
 * (JPEG→decode→re-encode), and slow (GPU readback per texture).
 *
 * **When enabled** (via static {@link SAVE_SOURCE_BLOBS} or per-instance
 * {@link saveSourceBlobs}): the image is fetched as an `ArrayBuffer` via
 * {@link FileLoader} first — bytes are retained, routed through threepipe's cache
 * (so our CacheStorage + empty-payload guard apply) — then wrapped in a Blob and
 * decoded via a blob-URL `<img>`. The bytes land on
 * `texture.source._sourceImgBuffer` and `texture.userData.mimeType`, where
 * `GLTFWriter2.processTexture`'s fast path reads them to skip the canvas re-encode
 * on export.
 *
 * **Defaults off** because the retained bytes are an extra memory copy per texture
 * (typical 100 KB–2 MB each). Turn on only when exports matter (editors, authoring
 * tools) and scenes are modest.
 *
 * **Matches three.js behavior** when disabled — falls through to `super.load` with
 * zero side effects.
 *
 * **Not yet handled**:
 * - Textures loaded inside a GLB/GLTF via three.js's `GLTFLoader` (it has its own
 *   image pipeline that bypasses this loader). See
 *   `issues/open/gltfloader2-preserve-texture-source-bytes.md`.
 * - Mutation invalidation: if texture pixels are modified at runtime after load,
 *   `_sourceImgBuffer` becomes stale. Consumers should clear it explicitly.
 */
export class TextureLoader2 extends TextureLoader {
    /** Global opt-in. Set to `true` before loading to preserve source bytes on every new texture. */
    public static SAVE_SOURCE_BLOBS = false

    /** Per-instance override (takes precedence over {@link SAVE_SOURCE_BLOBS}). */
    public saveSourceBlobs?: boolean

    readonly isTextureLoader2 = true

    load(
        url: string,
        onLoad?: (texture: Texture) => void,
        onProgress?: (event: ProgressEvent) => void,
        onError?: (err: unknown) => void,
    ): Texture {
        const enabled = this.saveSourceBlobs ?? TextureLoader2.SAVE_SOURCE_BLOBS
        // Skip capture for non-http(s) URL schemes — bytes aren't retrievable/useful
        const captureUrl = enabled && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('chrome-extension:')
        const mime = captureUrl ? mimeTypeFromUrl(url) : undefined
        if (!mime) return super.load(url, onLoad, onProgress, onError)

        // Avoid double loading-manager tracking — we use FileLoader (one itemStart/End),
        // then decode directly via `<img>` without going through ImageLoader.
        const texture = new Texture()

        const fileLoader = new FileLoader(this.manager)
        fileLoader.setPath(this.path)
        fileLoader.setResponseType('arraybuffer')
        fileLoader.setCrossOrigin(this.crossOrigin)
        fileLoader.setWithCredentials(this.withCredentials)

        fileLoader.load(url, (buffer: any) => {
            const bytes = buffer as ArrayBuffer
            if (!bytes || bytes.byteLength === 0) {
                const err = new Error('TextureLoader2: empty buffer for ' + url)
                console.error(err.message)
                if (onError) onError(err)
                return
            }

            const blob = new Blob([bytes], {type: mime})
            const blobUrl = URL.createObjectURL(blob)
            const image: HTMLImageElement = document.createElement('img')
            if (this.crossOrigin !== undefined) image.crossOrigin = this.crossOrigin
            image.onload = () => {
                URL.revokeObjectURL(blobUrl)
                texture.image = image
                texture.needsUpdate = true
                ;(texture.source as any)._sourceImgBuffer = bytes
                texture.userData.mimeType = mime
                if (!url.startsWith('blob:')) texture.userData.rootPath = (this.path || '') + url
                if (onLoad) onLoad(texture)
            }
            image.onerror = (ev) => {
                URL.revokeObjectURL(blobUrl)
                console.error('TextureLoader2: decode failed for', url)
                if (onError) onError(ev)
            }
            image.src = blobUrl
        }, onProgress, onError as any)

        return texture
    }
}
