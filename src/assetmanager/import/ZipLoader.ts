import {FileLoader} from 'three'
import {unzipSync} from 'three/examples/jsm/libs/fflate.module.js'

export class ZipLoader extends FileLoader {

    load(url: string, onLoad?: (t: any) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): void {
        this.setResponseType('arraybuffer')
        return super.load(url, (buffer: any)=>{
            // const files = blob.arrayBuffer().then(buff => )
            const files = unzipSync(new Uint8Array(buffer))
            const map = new Map<string, File>(Object.entries(files).map(([path, fileBuffer]) => {
                return [path, new File([fileBuffer as any], path)]
            }))
            onLoad?.(map)
        }, onProgress, onError)
    }

}
