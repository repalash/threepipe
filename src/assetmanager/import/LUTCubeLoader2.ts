import {LUTCubeLoader, LUTCubeResult} from 'three/examples/jsm/loaders/LUTCubeLoader.js'
import {Data3DTexture, MathUtils, Vector3} from 'three'
import {IJSONSerializable} from 'ts-browser-helpers'
import {serializable} from '../../utils/browser-helpers'
import {serializeTextureInExtras} from '../../utils/serialization'

/**
 * Wrapper around {@link LUTCubeResult} that makes a loaded `.cube` LUT serializable
 * through threepipe's asset manager / viewer-config pipeline.
 *
 * Sets `__needsSourceBuffer = true` on itself (top-level, not userData — bytes don't
 * belong in userData). `AssetImporter.processImported` sees this and caches the raw
 * `.cube` bytes on `this.__sourceBuffer`. Currently only populated for File/Blob
 * loads; URL-loaded LUTs serialize via `userData.rootPath` fallback.
 */
@serializable('LUTCubeTextureWrapper')
export class LUTCubeTextureWrapper implements LUTCubeResult, IJSONSerializable {
    readonly domainMax: Vector3
    readonly domainMin: Vector3
    readonly size: number
    readonly texture3D: Data3DTexture
    readonly title: string
    readonly userData: any = {}
    readonly uuid: string
    readonly type = 'LUTCubeTextureWrapper'
    readonly assetType = 'lutTexture'

    /** Asks AssetImporter to cache source bytes on `this.__sourceBuffer` after load */
    __needsSourceBuffer?: boolean
    __sourceBuffer?: ArrayBuffer

    constructor({
        domainMax,
        domainMin,
        size,
        texture3D,
        title,
    }: LUTCubeResult) {
        this.domainMax = domainMax
        this.domainMin = domainMin
        this.size = size
        this.texture3D = texture3D
        this.title = title
        this.uuid = MathUtils.generateUUID()
        this.__needsSourceBuffer = true
    }

    fromJSON(_data: any, _meta?: any): this {
        console.error('LUTCubeTextureWrapper.fromJSON: not implemented — restore .cube assets via AssetImporter.importSingle (loadConfigResources path) instead')
        return this
    }

    toJSON(meta?: any): any {
        return serializeTextureInExtras(this as any, meta, this.texture3D.name)
    }

    dispose() {
        this.texture3D.dispose()
    }
}

/**
 * Loader for `.cube` LUT files — wraps three.js's {@link LUTCubeLoader} and
 * returns a {@link LUTCubeTextureWrapper} so the result is serializable.
 */
export class LUTCubeLoader2 extends LUTCubeLoader {
    parse(data: string): LUTCubeResult {
        const res = super.parse(data)
        return new LUTCubeTextureWrapper(res)
    }
}
