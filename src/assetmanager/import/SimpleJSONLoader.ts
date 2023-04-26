import {FileLoader} from 'three'

export class SimpleJSONLoader extends FileLoader {
    load(url: string, onLoad?: (response: (any)) => void, onProgress?: (request: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): any {
        return super.load(url, (res)=>{
            try {
                if (typeof res === 'string') {
                    onLoad?.(JSON.parse(res))
                } else {
                    throw new Error('Invalid JSON')
                }
            } catch (e: any) {
                onError?.(e)
            }
        }, onProgress, onError)
    }
}

