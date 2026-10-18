import {Cache as threeCache} from 'three'

function isEmptyPayload(data: any): boolean {
    if (data == null) return true
    if (data instanceof ArrayBuffer) return data.byteLength === 0
    if (ArrayBuffer.isView(data)) return data.byteLength === 0
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size === 0
    if (typeof data === 'string') return data.length === 0
    return false
}

// same decoding as in three.js FileLoader
async function decodeResponse(response: Response, responseType: string, mimeType?: DOMParserSupportedType): Promise<any> {
    switch (responseType) {
    case 'arraybuffer':
        return response.arrayBuffer()
    case 'blob':
        return response.blob()
    case 'document': {
        const text = await response.text()
        if (!text) return undefined
        const parser = new DOMParser()
        return parser.parseFromString(text, mimeType ?? 'text/html')
    }
    case 'json': {
        const text = await response.text()
        return text ? JSON.parse(text) : undefined
    }
    default:
        if (mimeType === undefined) {
            return response.text()
        } else {
            // sniff encoding
            const re = /charset="?([^;"\s]*)"?/i
            const exec = re.exec(mimeType)
            const label = exec && exec[1] ? exec[1].toLowerCase() : undefined
            const decoder = new TextDecoder(label)
            return decoder.decode(await response.arrayBuffer())
        }
    }
}

export function overrideThreeCache(storage?: Cache | Storage) {
    if ((threeCache as any)._orig) {
        if ((threeCache as any)._storage === storage) return
        Object.assign(threeCache, (threeCache as any)._orig)
        delete (threeCache as any)._orig
        delete (threeCache as any)._storage
    }
    // Nothing to patch without a storage. three.js Cache is used as is, its `get` returns a promise when a responseType is passed, which FileLoader depends on.
    if (!storage) return
    const cache = storage as Cache
    const oldCache = {...threeCache}
    ;(threeCache as any)._orig = oldCache
    ;(threeCache as any)._storage = storage
    threeCache.get = (url: string, responseType?: string, mimeType?: DOMParserSupportedType): Promise<any> | any => {
        if (!responseType) return oldCache.get(url)
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension')) return Promise.resolve(undefined)
        return cache.match(url).then(async response => {
            if (!response) return undefined
            // Guard against corrupted cache entries - 0-byte (saved from a prior failed fetch — e.g. extension
            // interfering, flaky network, aborted download) or undecodable (e.g. truncated json).
            // Without this check, once such a response is persisted to CacheStorage it
            // replays forever, breaking binary loaders (DRACO, GLB, etc.) even after the
            // original issue is gone. On hit, delete the bad entry and fall through to network.
            // Content-Length header isn't reliable on cached Responses created via
            // `new Response(data)` (it's not auto-set), so we validate after decoding.
            let payload: any
            try {
                payload = await decodeResponse(response, responseType, mimeType)
            } catch (e) {
                payload = undefined
            }
            if (isEmptyPayload(payload)) {
                console.warn('[threepipe cache] removing invalid cache entry for', url)
                await cache.delete(url).catch(()=>{/* ignore */})
                return undefined
            }
            return payload
        })
    }
    threeCache.add = async(url: string, data: any, responseType?: string) => {
        if (!responseType) return oldCache.add(url, data)
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension') || url.startsWith('asset://')) return
        // Don't persist empty/corrupted payloads — otherwise a one-off bad fetch
        // (extension interference, aborted download) gets stuck in CacheStorage and
        // replays forever across page reloads.
        if (isEmptyPayload(data)) {
            console.warn('[threepipe cache] skipping empty payload for', url)
            return
        }
        // FileLoader passes the decoded data, which is not a valid Response body for json and document.
        const body: BodyInit = responseType === 'json' ? JSON.stringify(data) :
            responseType === 'document' ? new XMLSerializer().serializeToString(data) : data
        // noinspection JSIgnoredPromiseFromCall
        if (await cache.match(url)) await cache.delete(url)
        // todo this can throw - Request scheme 'x' is unsupported, check if scheme is supported
        await cache.put(url, new Response(body, {status: 200})).catch((e: any)=>{console.warn('[threepipe cache] add failed for', url, e)})
    }
    threeCache.remove = (url: string, responseType?: string) => {
        if (!responseType) return oldCache.remove(url)
        // noinspection JSIgnoredPromiseFromCall
        cache.delete(url)
    }
}
