import {FileLoader} from 'three'
import {ValOrFunc} from 'ts-browser-helpers'

export class SimpleJSONLoader extends FileLoader {
    static SupportedJSONTypes: ValOrFunc<string[]> = []
    static SupportedJSONExtensions: ValOrFunc<string[]> = []

    async parseAsync(data: Record<string, any>): Promise<any> {
        // todo use ThreeSerialization here? or in a subclass? it needs loadConfigResources as well.
        return data
    }
    load(url: string, onLoad?: (response: (any)) => void, onProgress?: (request: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): any {
        return super.load(url, (res)=>{
            try {
                if (typeof res === 'string') {
                    this.parseAsync(JSON.parse(res)).then(onLoad)
                } else {
                    throw new Error('Invalid JSON')
                }
            } catch (e: any) {
                onError?.(e)
            }
        }, onProgress, onError)
    }
}

