import {Cache, Loader, LoadingManager} from 'three'

class VideoLoader extends Loader {

    constructor(manager: LoadingManager) {

        super(manager)

    }

    load(url: string, onLoad: (a: HTMLVideoElement)=>void, _onProgress: (p: ProgressEvent)=>void, onError: (e: any)=>void): HTMLVideoElement {

        if (this.path !== undefined) url = this.path + url

        url = this.manager.resolveURL(url)

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const scope = this

        const cached = Cache.get(url)

        if (cached !== undefined) {

            scope.manager.itemStart(url)

            setTimeout(function() {

                if (onLoad) onLoad(cached)

                scope.manager.itemEnd(url)

            }, 0)

            return cached

        }

        const videoEl = document.createElementNS('http://www.w3.org/1999/xhtml', 'video') as HTMLVideoElement

        function onVideoLoad() {

            videoEl.removeEventListener('loadedmetadata', onVideoLoad, false)
            videoEl.removeEventListener('error', onVideoError, false)

            Cache.add(url, videoEl)

            if (onLoad) onLoad(videoEl)

            scope.manager.itemEnd(url)

        }

        function onVideoError(event: any) {

            videoEl.removeEventListener('loadedmetadata', onVideoLoad, false)
            videoEl.removeEventListener('error', onVideoError, false)

            if (onError) onError(event)

            scope.manager.itemError(url)
            scope.manager.itemEnd(url)

        }

        videoEl.addEventListener('loadedmetadata', onVideoLoad, false)
        videoEl.addEventListener('error', onVideoError, false)

        if (url.substr(0, 5) !== 'data:') {

            if (this.crossOrigin !== undefined) videoEl.crossOrigin = this.crossOrigin

        }

        scope.manager.itemStart(url)

        videoEl.src = url
        videoEl.preload = 'auto'
        videoEl.autoplay = true


        videoEl.setAttribute('webkit-playsinline', 'webkit-playsinline')
        videoEl.setAttribute('playsinline', '')

        return videoEl

    }

}


export {VideoLoader}
