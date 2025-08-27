import {createDiv, createStyles, escapeHtml, onChange, serialize, timeout} from 'ts-browser-helpers'
import styles from './LoadingScreenPlugin.css?inline'
import spinner1 from './loaders/spinner1.css?inline'
import {uiButton, uiDropdown, uiFolderContainer, uiInput, uiSlider, uiToggle} from 'uiconfig.js'
import {AAssetManagerProcessStatePlugin} from '../base/AAssetManagerProcessStatePlugin'
import {ThreeViewer} from '../../viewer'

/**
 * Loading Screen Plugin
 *
 * Shows a configurable loading screen overlay over the canvas.
 *
 * @category Plugins
 */
@uiFolderContainer('Loading Screen')
export class LoadingScreenPlugin extends AAssetManagerProcessStatePlugin {
    public static readonly PluginType = 'LoadingScreenPlugin'

    styles = styles

    spinners = [{
        styles: spinner1,
        html: '<span class="loader"></span>',
    }]
    refresh() {
        if (!this._viewer) return
        this._updateMainDiv(this._isPreviewing ? this._previewState : this._viewer.assetManager.processState, false)
    }

    @uiDropdown('Loader', ['Spinner 1'].map((v, i) => ({value: i, label: v})))
    @serialize() loader = 0

    @uiInput('Loading text header')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() loadingTextHeader = 'Loading Files'
    @uiInput('Error text header')
    @serialize() errorTextHeader = 'Error Loading Files'

    @uiToggle('Show file names')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() showFileNames = true

    @uiToggle('Show process states')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() showProcessStates = true

    @uiToggle('Show progress')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() showProgress = true

    @uiToggle('Hide on only errors')
    @serialize() hideOnOnlyErrors = true
    @uiToggle('Hide on files load')
    @serialize() hideOnFilesLoad = true
    @uiToggle('Hide on scene object load')
    @serialize() hideOnSceneObjectLoad = false
    /**
     * Minimize when scene has objects
     * Note: also checks for scene.environment and doesnt minimize when environment is null or undefined
     * @default true
     */
    @uiToggle('Minimize on scene object load')
    @serialize() minimizeOnSceneObjectLoad = true

    @uiToggle('Show when files start loading')
    @serialize() showOnFilesLoading = true
    @uiToggle('Show when scene empty')
    @serialize() showOnSceneEmpty = true

    @uiInput('Hide delay (ms)')
    @serialize() hideDelay = 500

    @uiSlider('Background Opacity', [0, 1])
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() backgroundOpacity = 0.5

    @uiSlider('Background Blur', [0, 100])
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() backgroundBlur = 24

    @uiInput('Background Color')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() background = '#ffffff'

    @uiInput('Text Color')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() textColor = '#222222'

    /**
     * Default logo image shown during loading
     * @default 'https://threepipe.org/logo.svg'
     */
    static LS_DEFAULT_LOGO = 'https://threepipe.org/logo.svg'

    @uiInput('Logo Image')
    @onChange(LoadingScreenPlugin.prototype.refresh)
    @serialize() logoImage = LoadingScreenPlugin.LS_DEFAULT_LOGO

    private _isPreviewing = false
    private _previewState = new Map([['file.glb', {state: 'downloading', progress: 50}], ['environment.hdr', {state: 'adding'}]])

    @uiButton('Toggle preview')
    togglePreview() {
        this.maximize()
        this._isPreviewing = !this._isPreviewing
        this.refresh()
        if (this._isPreviewing)
            this.show()
        else
            this.hideWithDelay()
    }

    loadingElement = createDiv({classList: ['loadingScreenLoadingElement'], addToBody: false})
    filesElement = createDiv({classList: ['loadingScreenFilesElement'], addToBody: false})
    logoElement = createDiv({classList: ['loadingScreenLogoElement'], addToBody: false})

    constructor(container?: HTMLElement) {
        super('LoadingScreen', container)
        // const popupClose = createDiv({
        //     id: 'assetManagerLoadingScreenClose',
        //     addToBody: false,
        //     innerHTML: '&#10005',
        // })
        // popupClose.addEventListener('click', () => {
        //     this._mainDiv.style.display = 'none'
        // })
        // this._mainDiv.appendChild(popupClose)

        this._mainDiv.prepend(this.loadingElement)
        this._mainDiv.prepend(this.logoElement)
        this._mainDiv.appendChild(this.filesElement)
    }

    private _isHidden = false

    get visible() {
        return !this._isHidden
    }

    async hide() {
        this._isHidden = true
        this._mainDiv.style.opacity = '0'
        await timeout(502)
        if (this._isHidden) {
            this._mainDiv.style.display = 'none'
            this._showMainDiv()
        }
    }
    async hideWithDelay() {
        this._isHidden = true
        await timeout(this.hideDelay)
        if (!this._isHidden) return
        return this.hide()
    }
    show() {
        if (!this._isHidden) return
        this._isHidden = false
        this._showMainDiv()
        this._mainDiv.style.display = 'flex'
    }

    protected _showMainDiv() {
        // this._mainDiv.style.opacity = this.opacity.toString()
        this._mainDiv.style.opacity = '1'
    }
    @uiButton('Minimize')
    minimize() {
        this._mainDiv.classList.add('minimizedLoadingScreen')
        if (!this.showFileNames) this.loadingElement.style.display = 'block'
    }
    @uiButton('Maximize')
    maximize() {
        this._mainDiv.classList.remove('minimizedLoadingScreen')
        this.loadingElement.style.display = ''
    }

    private _temp = document.createElement('template')
    private _setHTML(elem: HTMLElement, html:string) {
        this._temp.innerHTML = html
        // Compare the parsed content instead of raw strings, as browsers might change html after setting.
        if (this._temp.innerHTML.trim() !== elem.innerHTML.trim()) elem.innerHTML = html
    }

    protected _updateMainDiv(processState: Map<string, {state: string, progress?: number|undefined}>, updateVisibility = true) {
        if (!this._viewer) return
        if (!this._contentDiv) return
        if (!this.enabled) {
            this._mainDiv.style.display = 'none'
            return
        }
        if (this.showFileNames) {
            let text = ''
            processState.forEach((v, k) => {
                text += (this.showProcessStates ? `<span class="loadingScreenProcessState">${escapeHtml(v.state)}</span>: ` : '') +
                    escapeHtml((k || '').split('/').pop() || '') +
                    (this.showProgress && v.progress ? ' - ' + (v.progress.toFixed(0) + '%') : '') +
                    '<br>'
            })
            this._setHTML(this.filesElement, text)
        } else {
            this._setHTML(this.filesElement, '')
        }
        const errors = [...processState.values()].filter(v => v.state === 'error')
        if (errors.length > 0 && errors.length === processState.size && !this.hideOnOnlyErrors) {
            this._setHTML(this._contentDiv, escapeHtml(this.errorTextHeader))
        } else {
            this._setHTML(this._contentDiv, escapeHtml(this.loadingTextHeader))
        }
        this._setHTML(this.loadingElement, this.spinners[this.loader].html)
        this._mainDiv.style.setProperty('--b-opacity', this.backgroundOpacity.toString())
        this._mainDiv.style.setProperty('--b-background', this.background)
        ;(this._mainDiv.style as any).backdropFilter = `blur(${this.backgroundBlur}px)`
        this._mainDiv.style.color = this.textColor
        this._setHTML(this.logoElement, this.logoImage ? `<img class="loadingScreenLogoImage" src=${JSON.stringify(this.logoImage)}/>` : '')
        if (updateVisibility) {
            this._updateVisibility(processState, errors.length)
        }
    }

    protected _updateVisibility(processState: Map<string, {state: string, progress?: number|undefined}>, errors: number) {
        if (!this._viewer) return false
        if (this.hideOnFilesLoad && (processState.size === 0 ||
            errors === processState.size && this.hideOnOnlyErrors) && !this._isHidden) {
            this.hideDelay ? this.hideWithDelay() : this.hide()
            return true
        } else if (processState.size > 0 && this.showOnFilesLoading && this._isHidden) {
            const sceneObjects = this._viewer.scene.modelRoot.children
            if (sceneObjects.length > 0 && this.minimizeOnSceneObjectLoad && this._viewer.scene.environment) this.minimize()
            else this.maximize()
            this.show()
            return true
        }
        return false
    }

    // disables showOnSceneEmpty
    isEditor = false

    private _sceneUpdate = (e: any) => {
        if (!this._viewer) return
        if (!e.hierarchyChanged) return
        const sceneObjects = this._viewer.scene.modelRoot.children
        if (sceneObjects.length === 0 && this.showOnSceneEmpty && !this.isEditor) {
            this.show()
        }
        if (sceneObjects.length > 0) {
            // case - objects loaded, clear current scene, load loaded objects
            // load - process state 0, hide with delay. clear scene shows loading screen, loading current object doesnt change process state...
            const processState = this._viewer.assetManager.processState
            const errors = [...processState.values()].filter(v => v.state === 'error')
            if (!this._updateVisibility(processState, errors.length)) {
                if (this.hideOnSceneObjectLoad)
                    this.hideWithDelay()
                else if (this.minimizeOnSceneObjectLoad && this._viewer.scene.environment)
                    timeout(this.hideDelay + 300).then(() => this.minimize())
            }
        } else if (this.minimizeOnSceneObjectLoad)
            this.maximize()
    }

    stylesheet?: HTMLStyleElement
    stylesheetLoader?: HTMLStyleElement[]
    onAdded(viewer: ThreeViewer) {
        this.stylesheet = createStyles(this.styles, viewer.container)
        this.stylesheetLoader = this.spinners.map(s => createStyles(s.styles, viewer.container))

        viewer.scene.addEventListener('sceneUpdate', this._sceneUpdate)
        super.onAdded(viewer)
    }
    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('sceneUpdate', this._sceneUpdate)
        this.stylesheet?.remove()
        this.stylesheet = undefined
        this.stylesheetLoader?.forEach(s => s.remove())
        this.stylesheetLoader = undefined
        return super.onRemove(viewer)
    }
}

