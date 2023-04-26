import {Cache as threeCache} from 'three'

export function overrideThreeCache(storage: Cache | Storage) {
    const oldCache = {...threeCache}
    threeCache.get = (url: string, responseType?: string, mimeType?: DOMParserSupportedType): Promise<any> | any => {
        if (!responseType) return oldCache.get(url)
        if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension')) return Promise.resolve(undefined)
        return (storage as Cache).match(url).then(response => {
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
        if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension')) return
        // noinspection JSIgnoredPromiseFromCall
        if (await storage.match(url)) await storage.delete(url)
        await storage.put(url, new Response(data, {status: 200}))
    }
    threeCache.remove = (url: string, responseType?: string) => {
        if (!responseType) return oldCache.remove(url)
        // noinspection JSIgnoredPromiseFromCall
        storage.delete(url)
    }
}
