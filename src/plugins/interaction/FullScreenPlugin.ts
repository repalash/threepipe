import {uiButton, uiFolderContainer} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync} from '../../viewer'

export interface FullScreenPluginEventMap extends AViewerPluginEventMap{
    enter: object
    exit: object
}

/**
 * Full Screen Plugin
 *
 * A simple plugin that provides functions to {@link enter}, {@link exit}, {@link toggle} full screen mode and check if the viewer is in full screen mode with {@link isFullScreen}.
 *
 * Implementation from:
 * https://stackoverflow.com/questions/50568474/how-to-enter-fullscreen-in-three-js
 *
 * @todo: try out some lib like https://github.com/sindresorhus/screenfull for proper cross browser support
 * @category Plugins
 */
@uiFolderContainer('Full Screen')
export class FullScreenPlugin extends AViewerPluginSync<FullScreenPluginEventMap> {
    public static readonly PluginType = 'FullScreenPlugin'

    toJSON: any = undefined

    enabled = true

    constructor() {
        super()
        this.enter = this.enter.bind(this)
        this.exit = this.exit.bind(this)
    }

    private _lastSize = ['100%', '100%']
    private _lastFsElement: any = null

    private _fsChangeHandler = (_: Event) => {
        if (this.isFullScreen()) {
            /* Run code when going to fs mode */
            this.dispatchEvent({type: 'enter'})

        } else {
            /* Run code when going back from fs mode */
            const elem = this._lastFsElement || this._viewer?.canvas
            if (elem) {
                elem.style.width = this._lastSize[0]
                elem.style.height = this._lastSize[1]
            }

            document.removeEventListener('webkitfullscreenchange', this._fsChangeHandler, false)
            document.removeEventListener('mozfullscreenchange', this._fsChangeHandler, false)
            document.removeEventListener('fullscreenchange', this._fsChangeHandler, false)
            document.removeEventListener('MSFullscreenChange', this._fsChangeHandler, false)

            this.dispatchEvent({type: 'exit'})
        }
    }

    @uiButton('Enter FullScreen', {sendArgs: false})
    async enter(element?: HTMLElement): Promise<void> {
        if (this.isFullScreen()) return

        const elem = element || this._viewer?.canvas as any

        if (!elem) return

        this._lastFsElement = elem

        if (document.addEventListener) {
            document.addEventListener('webkitfullscreenchange', this._fsChangeHandler, false)
            document.addEventListener('mozfullscreenchange', this._fsChangeHandler, false)
            document.addEventListener('fullscreenchange', this._fsChangeHandler, false)
            document.addEventListener('MSFullscreenChange', this._fsChangeHandler, false)
        }

        this._lastSize = [elem.style.width, elem.style.height]
        elem.style.width = '100%'
        elem.style.height = '100%'

        if (elem.requestFullscreen) {
            return elem.requestFullscreen()
        } else if (elem.mozRequestFullScreen) { /* Firefox */
            return elem.mozRequestFullScreen()
        } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
            return elem.webkitRequestFullscreen()
        } else if (elem.msRequestFullscreen) { /* IE/Edge */
            return elem.msRequestFullscreen()
        }
    }
    @uiButton('Exit FullScreen', {sendArgs: false})
    async exit(): Promise<void> {
        if (document.exitFullscreen) {
            return document.exitFullscreen()
        } else if ((document as any).mozCancelFullScreen) { /* Firefox */
            return (document as any).mozCancelFullScreen()
        } else if ((document as any).webkitExitFullscreen) { /* Chrome, Safari and Opera */
            return (document as any).webkitExitFullscreen()
        } else if ((document as any).msExitFullscreen) { /* IE/Edge */
            return (document as any).msExitFullscreen()
        }
    }
    @uiButton('Toggle FullScreen', {sendArgs: false})
    async toggle(element?: HTMLElement): Promise<void> {
        if (this.isFullScreen()) {
            return this.exit()
        } else {
            return this.enter(element)
        }
    }

    isFullScreen() {
        return (document as any).webkitIsFullScreen ||
            (document as any).mozFullScreen ||
            (document as any).msFullscreenElement !== undefined
    }
}
