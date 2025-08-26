import {FileLoader, LoadingManager} from 'three'
import {blobToDataURL} from 'ts-browser-helpers'

export class DataUrlLoader extends FileLoader {

    constructor(manager: LoadingManager) {
        super(manager)
        this.responseType = 'blob'
    }

    load(url: string, onLoad?: (response: (any)) => void, onProgress?: (request: ProgressEvent) => void, onError?: (event: unknown) => void): any {
        return super.load(url, (res)=>{
            try {
                onLoad?.(blobToDataURL(res as any as Blob))
            } catch (e: any) {
                onError?.(e)
            }
        }, onProgress, onError)
    }
}
