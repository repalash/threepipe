import {
    AViewerPluginSync,
    ISceneEventMap,
    Object3D,
    onChange, ProgressivePlugin,
    serialize,
    ThreeViewer,
    uiButton,
    uiDropdown,
    uiFolderContainer,
    uiInput,
    uiSlider,
    uiToggle
} from "threepipe"

@uiFolderContainer('Watch Hands Time')
export class WatchHandsPlugin extends AViewerPluginSync {
    static readonly PluginType = 'WatchHandsPlugin'

    @uiToggle()
    @serialize()
    enabled = true

    dependencies = []

    @uiDropdown(undefined, ['x', 'y', 'z'].map(label=>({label})))
    @serialize()
    axis: 'x'|'y'|'z' = 'y'

    @uiToggle()
    @serialize()
    invertAxis = false

    @uiToggle()
    @serialize()
    analog = true

    @uiSlider(undefined, [0, 12], 0.001)
    @serialize()
    hourOffset = 0

    @uiSlider(undefined, [0, 60], 0.001)
    @serialize()
    minuteOffset = 0

    @uiSlider(undefined, [0, 60], 0.001)
    @serialize()
    secondOffset = 0

    @uiInput()
    @serialize()
    hour = '.*hour.*'
    @uiInput()
    @serialize()
    minute = '.*minute.*'
    @uiInput()
    @serialize()
    second = '.*second.*'

    @uiToggle()
    @onChange('refresh')
    @serialize()
    regex = true

    hands: {
        type: 'hour' | 'minute' | 'second'
        object: Object3D
    }[] = []

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.scene.addEventListener('addSceneObject', this._addSceneObject)
        viewer.addEventListener('preFrame', this._preFrame)
    }
    onRemove(viewer: ThreeViewer): void {
        viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        viewer.removeEventListener('preFrame', this._preFrame)
        super.onRemove(viewer)
    }

    private _lastEnabled = true
    private _preFrame = () => {
        if (!this.enabled) {
            if (this._lastEnabled) {
                this._lastEnabled = false
                if (!this.hands.length) return
                for (const h of this.hands) {
                    h.object.rotation.fromArray(h.object.userData.initRotation)
                    h.object.updateMatrixWorld()
                }
                this._viewer?.renderManager.resetShadows()
                this._viewer?.setDirty()
            }
            return
        }
        this._lastEnabled = true
        if (!this.hands.length) return

        const d = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')?.postFrameConvergedRecordingDelta()
        // if (d && d > 0) delta = d
        if (d === 0) return // not converged yet.
        // if d < 0: not recording, do nothing

        // viewer.addEventListener('preFrame', () => {

        // hand_hour - y 0-2*PI
        // hand_minute - y 0-2*PI
        // hand_second - y 3*PI-PI
        const time = new Date()
        const invert = this.invertAxis ? -1 : 1
        const secondHandRotation = invert * (time.getSeconds() + (this.analog ? time.getMilliseconds() / 1000 : 0) - this.secondOffset) * (Math.PI * 2) / 60
        const minuteHandRotation = invert * (time.getMinutes() - this.minuteOffset) * (Math.PI * 2) / 60 + secondHandRotation / 60
        const hourHandRotation = invert * (time.getHours() - this.hourOffset) * (Math.PI * 2) / 12 + minuteHandRotation / 12

        if (this.hands.find(h=>h.type === 'second' && Math.abs(secondHandRotation - h.object.rotation[this.axis]) > 0.001)) {
            for (const hand of this.hands) {
                if (hand.type === 'second') {
                    hand.object.rotation[this.axis] = secondHandRotation
                }
                if (hand.type === 'minute') {
                    hand.object.rotation[this.axis] = minuteHandRotation
                }
                if (hand.type === 'hour') {
                    hand.object.rotation[this.axis] = hourHandRotation
                }
            }
            this._viewer?.renderManager.resetShadows()
            this._viewer?.setDirty()
        }
        // })
    }

    private _addSceneObject = async(e: ISceneEventMap['addSceneObject']): Promise<void> => {
        if (!e.object) return
        this.refresh()
    }

    @uiButton()
    refresh() {
        this.hands = []
        this._viewer?.scene.modelRoot.traverse(o=>{
            let isChild = false
            o.traverseAncestors(oa=>{
                if (isChild) return
                if (this.hands.find(h=>h.object === oa)) isChild = true
            })
            if (isChild) return
            if (o.name.match(this.regex ? new RegExp(this.hour) : this.hour)) {
                if (!o.userData.initRotation) o.userData.initRotation = o.rotation.toArray()
                this.hands.push({type: 'hour', object: o})
            }
            if (o.name.match(this.regex ? new RegExp(this.minute) : this.minute)) {
                if (!o.userData.initRotation) o.userData.initRotation = o.rotation.toArray()
                this.hands.push({type: 'minute', object: o})
            }
            if (o.name.match(this.regex ? new RegExp(this.second) : this.second)) {
                if (!o.userData.initRotation) o.userData.initRotation = o.rotation.toArray()
                this.hands.push({type: 'second', object: o})
            }
        })
    }
}
