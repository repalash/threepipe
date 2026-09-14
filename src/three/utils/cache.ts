import {Cache as threeCache} from 'three'

function isEmptyPayload(data: any): boolean {
    if (data == null) return true
    if (data instanceof ArrayBuffer) return data.byteLength === 0
    if (ArrayBuffer.isView(data)) return data.byteLength === 0
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size === 0
    if (typeof data === 'string') return data.length === 0
    return false
}

export function overrideThreeCache(storage?: Cache | Storage) {
    if ((threeCache as any)._orig) {
        if ((threeCache as any)._storage) {
            if ((threeCache as any)._storage === storage) return
            Object.assign(threeCache, (threeCache as any)._orig)
            delete (threeCache as any)._orig
            delete (threeCache as any)._storage
        }
    }
    const oldCache = {...threeCache}
    ;(threeCache as any)._orig = oldCache
    ;(threeCache as any)._storage = storage
    threeCache.get = (url: string, responseType?: string, mimeType?: DOMParserSupportedType): Promise<any> | any => {
        if (!responseType) return oldCache.get(url)
        if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension')) return Promise.resolve(undefined)
        return (storage as Cache|undefined)?.match(url).then(async response => {
            if (!response) return undefined
            // Guard against corrupted 0-byte cache entries (saved from a prior
            // failed fetch — e.g. extension interfering, flaky network, aborted download).
            // Without this check, once an empty response is persisted to CacheStorage it
            // replays forever, breaking binary loaders (DRACO, GLB, etc.) even after the
            // original issue is gone. On hit, delete the bad entry and fall through to network.
            // Content-Length header isn't reliable on cached Responses created via
            // `new Response(data)` (it's not auto-set), so we validate after decoding below.
            const checkEmpty = async(payload: any) => {
                if (isEmptyPayload(payload)) {
                    console.warn('[threepipe cache] removing empty cache entry for', url)
                    await (storage as Cache|undefined)?.delete(url).catch(()=>{/* ignore */})
                    return undefined
                }
                return payload
            }
            switch (responseType) {
            case 'arraybuffer':
                return checkEmpty(await response.arrayBuffer())
            case 'blob':
                return checkEmpty(await response.blob())
            case 'document':
                return response.text()
                    .then(async text => {
                        const empty = await checkEmpty(text)
                        if (empty === undefined) return undefined
                        const parser = new DOMParser()
                        return parser.parseFromString(text, mimeType ?? 'text/html')
                    })
            case 'json':
                return response.json()
            default:
                if (mimeType === undefined) {
                    return checkEmpty(await response.text())
                } else {
                    // sniff encoding
                    const re = /charset="?([^;"\s]*)"?/i
                    const exec = re.exec(mimeType)
                    const label = exec && exec[1] ? exec[1].toLowerCase() : undefined
                    const decoder = new TextDecoder(label)
                    return response.arrayBuffer().then(async ab => checkEmpty(decoder.decode(ab)))
                }
            }
        })
    }
    threeCache.add = async(url: string, data: BodyInit, responseType?: string) => {
        if (!responseType) return oldCache.add(url, data)
        if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension') || url.startsWith('asset://')) return
        // Don't persist empty/corrupted payloads — otherwise a one-off bad fetch
        // (extension interference, aborted download) gets stuck in CacheStorage and
        // replays forever across page reloads.
        if (isEmptyPayload(data)) {
            console.warn('[threepipe cache] skipping empty payload for', url)
            return
        }
        // noinspection JSIgnoredPromiseFromCall
        if (await storage?.match(url)) await storage?.delete(url)
        // todo this can throw - Request scheme 'x' is unsupported, check if scheme is supported
        await storage?.put(url, new Response(data, {status: 200}))
            .then(() => console.log('[threepipe cache] added', url))
            .catch((e: any)=>{console.warn('[threepipe cache] add failed for', url, e)})
    }
    threeCache.remove = (url: string, responseType?: string) => {
        if (!responseType) return oldCache.remove(url)
        // noinspection JSIgnoredPromiseFromCall
        storage?.delete(url)
    }
}
