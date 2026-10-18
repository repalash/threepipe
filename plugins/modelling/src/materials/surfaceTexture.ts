import {DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType} from 'threepipe'
import {SurfacePattern, surfaceMaps} from './textures'

const cache = new Map<string, DataTexture>()

/**
 * The tiling normal map for a relief pattern, shared by every material that uses the same pattern, size and seed
 * (one texture in the exported glTF). Repeat wrapping; one tile per UV unit.
 */
export function reliefNormalTexture(pattern: SurfacePattern, size = 256, seed = 1): DataTexture {
    const key = `${pattern}:${size}:${seed}`
    let t = cache.get(key)
    if (t) return t
    const maps = surfaceMaps(pattern, size, seed)
    t = new DataTexture(maps.normal, size, size, RGBAFormat, UnsignedByteType)
    t.name = `relief-${pattern}`
    t.wrapS = t.wrapT = RepeatWrapping
    t.magFilter = LinearFilter
    t.minFilter = LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.colorSpace = NoColorSpace
    t.needsUpdate = true
    cache.set(key, t)
    return t
}
