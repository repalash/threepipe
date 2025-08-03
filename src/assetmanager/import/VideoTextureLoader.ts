import {LinearFilter, Loader, LoadingManager, RGBAFormat, SRGBColorSpace, VideoTexture} from 'three'
import {VideoLoader} from './VideoLoader'

export class VideoTextureLoader extends Loader {

    constructor(manager: LoadingManager) {

        super(manager)

    }

    load(url: string, onLoad: (a: VideoTexture)=>void, onProgress: (p: ProgressEvent)=>void, onError: (e: any)=>void): VideoTexture {

        const loader = new VideoLoader(this.manager)
        loader.setCrossOrigin(this.crossOrigin)
        loader.setPath(this.path)

        let videoTexture: VideoTexture|undefined
        // noinspection JSVoidFunctionReturnValueUsed
        const vid = loader.load(url, function(video) {

            if (!videoTexture) videoTexture = new VideoTexture(video)

            videoTexture.format = RGBAFormat
            videoTexture.minFilter = LinearFilter
            videoTexture.magFilter = LinearFilter
            videoTexture.colorSpace = SRGBColorSpace // todo depends on the video
            videoTexture.needsUpdate = true
            // video.play()

            if (onLoad !== undefined) {

                onLoad(videoTexture)

            }

        }, onProgress, onError) as any

        if (!videoTexture && vid)
            videoTexture = new VideoTexture(vid)

        return videoTexture!

    }

}
