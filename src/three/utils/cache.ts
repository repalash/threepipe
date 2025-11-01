import {Cache as threeCache} from 'three'

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
            switch (responseType) {
            case 'arraybuffer':
                return response.arrayBuffer()
            case 'blob':
                return response.blob()
            case 'document':
                return response.text()
                    .then(text => {
                        const parser = new DOMParser()
                        return parser.parseFromString(text, mimeType ?? 'text/html')
                    })
            case 'json':
                return response.json()
            default:
                if (mimeType === undefined) {
                    return response.text()
                } else {
                    // sniff encoding
                    const re = /charset="?([^;"\s]*)"?/i
                    const exec = re.exec(mimeType)
                    const label = exec && exec[1] ? exec[1].toLowerCase() : undefined
                    const decoder = new TextDecoder(label)
                    return response.arrayBuffer().then(ab => decoder.decode(ab))
                }
            }
        })
    }
    threeCache.add = async(url: string, data: BodyInit, responseType?: string) => {
        if (!responseType) return oldCache.add(url, data)
        if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension') || url.startsWith('asset://')) return
        // noinspection JSIgnoredPromiseFromCall
        if (await storage?.match(url)) await storage?.delete(url)
        // todo this can throw - Request scheme 'x' is unsupported, check if scheme is supported
        await storage?.put(url, new Response(data, {status: 200})).catch((e: any)=>{console.warn(e)})
    }
    threeCache.remove = (url: string, responseType?: string) => {
        if (!responseType) return oldCache.remove(url)
        // noinspection JSIgnoredPromiseFromCall
        storage?.delete(url)
    }
}
