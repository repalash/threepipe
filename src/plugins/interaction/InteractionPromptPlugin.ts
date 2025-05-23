import {EventListener2, Spherical, Vector3} from 'three'
import {IEvent, now, objectHasOwn, onChange, serialize} from 'ts-browser-helpers'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiButton, uiFolderContainer, uiInput, uiMonitor, uiToggle} from 'uiconfig.js'
import {OrbitControls3} from '../../three'
import {IScene, ISceneEventMap} from '../../core'

/**
 * Interaction Prompt Plugin
 *
 * A plugin that adds a hand pointer icon over the canvas that moves to prompt the user to interact with the 3d scene.
 * Pointer icon from [google/model-viewer](https://github.com/google/model-viewer)
 *
 * The pointer is automatically shown when some object is in the scene and the camera is not moving.
 * The animation starts after a delay and stops on user interaction. It then restarts after a delay after the user stops interacting
 *
 * The plugin provides several options and functions to configure the automatic behaviour or trigger the animation manually.
 * TODO - create example
 * @category Plugins
 */
@uiFolderContainer('Interaction Prompt')
export class InteractionPromptPlugin extends AViewerPluginSync {
    static readonly PluginType = 'InteractionPromptPlugin'
    @serialize()
    @uiToggle() enabled

    currentSphericalPosition?: Spherical
    animationRunning = false
    cursorEl?: HTMLElement
    // interactionsDisabled = false

    /**
     * Animation duration in ms
     */
    @serialize()
    @uiInput() animationDuration = 2000

    /**
     * Animation distance in pixels
     */
    @serialize()
    @uiInput() animationDistance = 80

    @serialize()
    @uiInput() animationPauseDuration = 6000

    /**
     * Camera Rotation distance in radians.
     */
    @serialize()
    @uiInput() rotationDistance = 0.3

    /**
     * Move the pointer icon up or down.
     * Y offset in the range -1 to 1.
     * 0 is the center of the screen, -1 is the top and 1 is the bottom.
     */
    @serialize()
    @uiInput() yOffset = 0

    /**
     * Autostart after camera stop
     */
    @serialize()
    @uiToggle() autoStart = true

    /**
     * Time in ms to wait before auto start after the camera stops.
     */
    @serialize()
    @uiInput() autoStartDelay = 30000

    /**
     * Auto stop on user interaction pointer down or wheel
     */
    @serialize()
    @uiToggle() autoStop = true

    /**
     * Auto start on scene object load. This requires {@link autoStart} to be true
     */
    @serialize()
    @uiToggle() autoStartOnObjectLoad = true

    @serialize()
    @uiToggle() autoStartOnObjectLoadDelay = 3000

    @uiMonitor() currentTime = 0

    @uiMonitor() lastActionTime = Infinity


    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    // private _xDamper = new Damper(50)

    /**
     * Pointer icon svg
     * Note: This is directly added to the DOM
     */
    @onChange(InteractionPromptPlugin.prototype._pointerIconChanged)
        pointerIcon = `<svg xmlns="http://www.w3.org/2000/svg" style="transform: translate(-50%, -25%);" xmlns:xlink="http://www.w3.org/1999/xlink" width="25" height="36">
    <defs>
        <path id="A" d="M.001.232h24.997V36H.001z"></path>
    </defs>
    <g transform="translate(-11 -4)" fill="none" fill-rule="evenodd">
        <path fill-opacity="0" fill="#fff" d="M0 0h44v44H0z"></path>
        <g transform="translate(11 3)">
            <path d="M8.733 11.165c.04-1.108.766-2.027 1.743-2.307a2.54 2.54 0 0 1 .628-.089c.16 0 .314.017.463.044 1.088.2 1.9 1.092 1.9 2.16v8.88h1.26c2.943-1.39 5-4.45 5-8.025a9.01 9.01 0 0 0-1.9-5.56l-.43-.5c-.765-.838-1.683-1.522-2.712-2-1.057-.49-2.226-.77-3.46-.77s-2.4.278-3.46.77c-1.03.478-1.947 1.162-2.71 2l-.43.5a9.01 9.01 0 0 0-1.9 5.56 9.04 9.04 0 0 0 .094 1.305c.03.21.088.41.13.617l.136.624c.083.286.196.56.305.832l.124.333a8.78 8.78 0 0 0 .509.953l.065.122a8.69 8.69 0 0 0 3.521 3.191l1.11.537v-9.178z" fill-opacity=".5" fill="#e4e4e4"></path>
            <path d="M22.94 26.218l-2.76 7.74c-.172.485-.676.8-1.253.8H12.24c-1.606 0-3.092-.68-3.98-1.82-1.592-2.048-3.647-3.822-6.11-5.27-.095-.055-.15-.137-.152-.23-.004-.1.046-.196.193-.297.56-.393 1.234-.6 1.926-.6a3.43 3.43 0 0 1 .691.069l4.922.994V10.972c0-.663.615-1.203 1.37-1.203s1.373.54 1.373 1.203v9.882h2.953c.273 0 .533.073.757.21l6.257 3.874c.027.017.045.042.07.06.41.296.586.77.426 1.22M4.1 16.614c-.024-.04-.042-.083-.065-.122a8.69 8.69 0 0 1-.509-.953c-.048-.107-.08-.223-.124-.333l-.305-.832c-.058-.202-.09-.416-.136-.624l-.13-.617a9.03 9.03 0 0 1-.094-1.305c0-2.107.714-4.04 1.9-5.56l.43-.5c.764-.84 1.682-1.523 2.71-2 1.058-.49 2.226-.77 3.46-.77s2.402.28 3.46.77c1.03.477 1.947 1.16 2.712 2l.428.5a9 9 0 0 1 1.901 5.559c0 3.577-2.056 6.636-5 8.026h-1.26v-8.882c0-1.067-.822-1.96-1.9-2.16-.15-.028-.304-.044-.463-.044-.22 0-.427.037-.628.09-.977.28-1.703 1.198-1.743 2.306v9.178l-1.11-.537C6.18 19.098 4.96 18 4.1 16.614M22.97 24.09l-6.256-3.874c-.102-.063-.218-.098-.33-.144 2.683-1.8 4.354-4.855 4.354-8.243 0-.486-.037-.964-.104-1.43a9.97 9.97 0 0 0-1.57-4.128l-.295-.408-.066-.092a10.05 10.05 0 0 0-.949-1.078c-.342-.334-.708-.643-1.094-.922-1.155-.834-2.492-1.412-3.94-1.65l-.732-.088-.748-.03a9.29 9.29 0 0 0-1.482.119c-1.447.238-2.786.816-3.94 1.65a9.33 9.33 0 0 0-.813.686 9.59 9.59 0 0 0-.845.877l-.385.437-.36.5-.288.468-.418.778-.04.09c-.593 1.28-.93 2.71-.93 4.222 0 3.832 2.182 7.342 5.56 8.938l1.437.68v4.946L5 25.64a4.44 4.44 0 0 0-.888-.086c-.017 0-.034.003-.05.003-.252.004-.503.033-.75.08a5.08 5.08 0 0 0-.237.056c-.193.046-.382.107-.568.18-.075.03-.15.057-.225.1-.25.114-.494.244-.723.405a1.31 1.31 0 0 0-.566 1.122 1.28 1.28 0 0 0 .645 1.051C4 29.925 5.96 31.614 7.473 33.563a5.06 5.06 0 0 0 .434.491c1.086 1.082 2.656 1.713 4.326 1.715h6.697c.748-.001 1.43-.333 1.858-.872.142-.18.256-.38.336-.602l2.757-7.74c.094-.26.13-.53.112-.794s-.088-.52-.203-.76a2.19 2.19 0 0 0-.821-.91" fill-opacity=".6" fill="#000"></path>
            <path d="M22.444 24.94l-6.257-3.874a1.45 1.45 0 0 0-.757-.211h-2.953v-9.88c0-.663-.616-1.203-1.373-1.203s-1.37.54-1.37 1.203v16.643l-4.922-.994a3.44 3.44 0 0 0-.692-.069 3.35 3.35 0 0 0-1.925.598c-.147.102-.198.198-.194.298.004.094.058.176.153.23 2.462 1.448 4.517 3.22 6.11 5.27.887 1.14 2.373 1.82 3.98 1.82h6.686c.577 0 1.08-.326 1.253-.8l2.76-7.74c.16-.448-.017-.923-.426-1.22-.025-.02-.043-.043-.07-.06z" fill="#fff"></path>
            <g transform="translate(0 .769)">
                <mask id="B" fill="#fff">
                    <use xlink:href="#A"></use>
                </mask>
                <path d="M23.993 24.992a1.96 1.96 0 0 1-.111.794l-2.758 7.74c-.08.22-.194.423-.336.602-.427.54-1.11.87-1.857.872h-6.698c-1.67-.002-3.24-.633-4.326-1.715-.154-.154-.3-.318-.434-.49C5.96 30.846 4 29.157 1.646 27.773c-.385-.225-.626-.618-.645-1.05a1.31 1.31 0 0 1 .566-1.122 4.56 4.56 0 0 1 .723-.405l.225-.1a4.3 4.3 0 0 1 .568-.18l.237-.056c.248-.046.5-.075.75-.08.018 0 .034-.003.05-.003.303-.001.597.027.89.086l3.722.752V20.68l-1.436-.68c-3.377-1.596-5.56-5.106-5.56-8.938 0-1.51.336-2.94.93-4.222.015-.03.025-.06.04-.09.127-.267.268-.525.418-.778.093-.16.186-.316.288-.468.063-.095.133-.186.2-.277L3.773 5c.118-.155.26-.29.385-.437.266-.3.544-.604.845-.877a9.33 9.33 0 0 1 .813-.686C6.97 2.167 8.31 1.59 9.757 1.35a9.27 9.27 0 0 1 1.481-.119 8.82 8.82 0 0 1 .748.031c.247.02.49.05.733.088 1.448.238 2.786.816 3.94 1.65.387.28.752.588 1.094.922a9.94 9.94 0 0 1 .949 1.078l.066.092c.102.133.203.268.295.408a9.97 9.97 0 0 1 1.571 4.128c.066.467.103.945.103 1.43 0 3.388-1.67 6.453-4.353 8.243.11.046.227.08.33.144l6.256 3.874c.37.23.645.55.82.9.115.24.185.498.203.76m.697-1.195c-.265-.55-.677-1.007-1.194-1.326l-5.323-3.297c2.255-2.037 3.564-4.97 3.564-8.114 0-2.19-.637-4.304-1.84-6.114-.126-.188-.26-.37-.4-.552-.645-.848-1.402-1.6-2.252-2.204C15.472.91 13.393.232 11.238.232A10.21 10.21 0 0 0 5.23 2.19c-.848.614-1.606 1.356-2.253 2.205-.136.18-.272.363-.398.55C1.374 6.756.737 8.87.737 11.06c0 4.218 2.407 8.08 6.133 9.842l.863.41v3.092l-2.525-.51c-.356-.07-.717-.106-1.076-.106a5.45 5.45 0 0 0-3.14.996c-.653.46-1.022 1.202-.99 1.983a2.28 2.28 0 0 0 1.138 1.872c2.24 1.318 4.106 2.923 5.543 4.772 1.26 1.62 3.333 2.59 5.55 2.592h6.698c1.42-.001 2.68-.86 3.134-2.138l2.76-7.74c.272-.757.224-1.584-.134-2.325" fill-opacity=".05" fill="#000" mask="url(#B)"></path>
            </g>
        </g>
    </g>
</svg>`

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        // legacy, required for files. remove later? todo use OldPluginType
        {
            if (objectHasOwn(viewer.plugins, 'InteractionPointerPlugin')) {
                delete viewer.plugins.InteractionPointerPlugin
            }

            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const p = this
            Object.defineProperty(viewer.plugins, 'InteractionPointerPlugin', {
                get(): any {
                    console.warn('InteractionPromptPlugin: PluginType renamed from InteractionPointerPlugin to InteractionPromptPlugin. Please update your code/vjson.')
                    return p
                },
                configurable: true, // required to be able to delete
            })
        }

        this.lastActionTime = Infinity
        viewer.addEventListener('preFrame', this._preFrame)

        viewer.container.addEventListener('pointerdown', this._pointerDown, true) // true is for capturing, this is required to enable orbit controls. https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#capture
        viewer.container.addEventListener('wheel', this._pointerDown, true)

        viewer.scene.addEventListener('addSceneObject', this._addSceneObject)
        viewer.scene.addEventListener('mainCameraUpdate', this._mainCameraUpdate)
        this._initializeCursor()
    }

    onRemove(viewer: ThreeViewer) {
        this.stopAnimation()
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.container.removeEventListener('pointerdown', this._pointerDown, true)
        viewer.container.removeEventListener('wheel', this._pointerDown, true)
        viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        viewer.scene.removeEventListener('mainCameraUpdate', this._mainCameraUpdate)
        if (this.cursorEl) {
            this.cursorEl.remove()
        }
        return super.onRemove(viewer)
    }

    private _mainCameraUpdate = (e: any)=>{
        if (this.isDisabled()) return
        if (e.change === 'deserialize' && this.animationRunning) {
            this.stopAnimation({reset: false}) // reset is false so that the new camera position is not reset
            this.startAnimation()
        } else {
            this.lastActionTime = now()
        }
    }
    private _addSceneObject: EventListener2<'addSceneObject', ISceneEventMap, IScene> = ()=>{
        if (this.autoStartOnObjectLoad) {
            this.lastActionTime = now() - this.autoStartDelay + this.autoStartOnObjectLoadDelay
        }
    }

    protected _pointerIconChanged() {
        if (!this.cursorEl) return
        this.cursorEl.innerHTML = this.pointerIcon
    }

    private _initializeCursor() {
        this.cursorEl = document.createElement('div')
        this.cursorEl.style.position = 'absolute'
        this.cursorEl.style.top = '0'
        this.cursorEl.style.left = '0'
        this.cursorEl.style.width = '10px'
        this.cursorEl.style.height = '10px'
        this.cursorEl.style.opacity = '0'
        // this.cursorEl.style.transition = 'opacity 0.25s ease-in-out'
        // this.cursorEl.innerHTML = this.pointerIcon
        this._pointerIconChanged()
        this._viewer!.container.appendChild(this.cursorEl)
    }

    @serialize()
        onlyOnOrbitControls = true

    private _orbitWarning = false

    @uiButton() startAnimation = () => {
        if (!this._viewer || !this.cursorEl || this.isDisabled()) return
        if ((this._viewer.scene.mainCamera.controls as OrbitControls3)?.type !== 'OrbitControls' && this.onlyOnOrbitControls) {
            if (!this._orbitWarning) console.warn('InteractionPromptPlugin requires OrbitControls, to run anyway, set onlyOnOrbitControls to false')
            this._orbitWarning = true
            return
        }
        if (this._viewer.scene.modelRoot.children.length === 0) return
        this.currentSphericalPosition = new Spherical().setFromVector3(new Vector3().subVectors(
            this._viewer.scene.mainCamera.position,
            this._viewer.scene.mainCamera.target
        ))
        this.cursorEl.style.opacity = '1'
        this.currentTime = 0
        this.animationRunning = true
        this._viewer.scene.mainCamera.setInteractions(false, InteractionPromptPlugin.PluginType)
        // if (this._viewer.scene.mainCamera.interactionsEnabled) {
        //     this.interactionsDisabled = true
        //     this._viewer.scene.mainCamera.interactionsEnabled = false
        // }
    }

    @uiButton() stopAnimation = async({reset = true}: {reset?: boolean} = {}) => {
        if (!this._viewer || !this.cursorEl) return // dont check for enabled here.
        this.animationRunning = false
        this.cursorEl.style.opacity = '0'
        if (this.currentSphericalPosition && reset) {
            this._viewer.scene.mainCamera.position.setFromSpherical(this.currentSphericalPosition).add(this._viewer.scene.mainCamera.target)
            this._viewer.scene.mainCamera.setDirty()
            this.currentSphericalPosition = undefined
        }
        this._viewer.scene.mainCamera.setInteractions(true, InteractionPromptPlugin.PluginType)
        // if (this.interactionsDisabled) {
        //     this._viewer.scene.mainCamera.interactionsEnabled = true
        //     this.interactionsDisabled = false
        // }
        return this._viewer.doOnce('postFrame')
    }

    private _pointerDown = () => {
        if (this.isDisabled()) return
        if (this.autoStop) this.stopAnimation({reset: false}) // todo dont reset only on pointer drag, not down
        this.lastActionTime = now()
    }
    private _x = 0
    private _preFrame = async(ev: IEvent<any>) => {
        if (!this._viewer || !this.cursorEl) return
        if (this.isDisabled() && this.animationRunning) {
            this.stopAnimation()
        }
        if (this.isDisabled()) return

        if (!this.animationRunning && this.autoStart && this.lastActionTime + this.autoStartDelay < now())
            this.startAnimation()

        if (!this.animationRunning) return

        if (this.currentTime <= this.animationDuration) {
            this.cursorEl.style.opacity = '1'
            // this.currentTime = this._xDamper.update(this.currentTime, this.currentTime + ev.deltaTime, 50, 0)
            const x = this.currentTime / this.animationDuration
            this._x = Math.sin(Math.PI * 2 * x) // this._xDamper.update( this._x,newX , ev.deltaTime , 1)
            if (x < 0.25 || x > 0.75) {
                this._x *= this._x * Math.sign(this._x)
            }
        } else {
            this.cursorEl.style.opacity = '0'
            this._x = 0
        }
        if (this.currentTime <= this.animationDuration + 50) { // because of precision issues. we need _x to be 0
            const sphericalPosition = this.currentSphericalPosition!.clone()
            sphericalPosition.theta += this._x * this.rotationDistance
            this._viewer.scene.mainCamera.position.setFromSpherical(sphericalPosition).add(this._viewer.scene.mainCamera.target)
            this._viewer.scene.mainCamera.setDirty()
        }

        const canvasBounds = this._viewer.container.getBoundingClientRect()

        const cursorX = canvasBounds.width / 2 + -this._x * Math.min(this.animationDistance, canvasBounds.width / 4)
        const cursorY = canvasBounds.height / 2 + this.yOffset * canvasBounds.height / 2
        this.cursorEl.style.transform = `translate(${Math.floor(cursorX)}px, ${Math.floor(cursorY)}px)`

        this.currentTime += ev.deltaTime

        if (this.currentTime > this.animationDuration + this.animationPauseDuration) {
            this.currentTime = 0
        }
    }
}
