import {
    createBindingsProxy,
    EventDispatcher,
    onChangeDispatchEvent,
    OnChangeDispatchEventType,
    safeSetProperty,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {animationObjectExt, cameraViewsExt, gltfAnimationExt, matConfExt, videoTextureExt} from './extensions'

export interface TrackItem {
    label: string // Start time in seconds
    uuid: string
    id: any // object mapped
    time: number // Start time in seconds
    duration: number // Duration in seconds
    offsets?: number[] // keyframes in range 0-1. between time and time + duration
    setTime?(v: number, last?: boolean): void
    setDuration?(v: number, last?: boolean): void
    setTimeDuration?(t: number, d?: number, last?: boolean): void
}
export interface TimelineTrack {
    type?: string,
    label: string,
    uuid: string,
    id: any,
    items: TrackItem[]
    order?: number
}

export interface TMExtension {
    uuid: string
    setup(): void;
    destroy(): void;
    update(): void;
}

export class TimelineManager extends EventDispatcher<{update: {updated: string}, tracksChange: object, selectedItemChanged: OnChangeDispatchEventType<string>}> {
    tracks: TimelineTrack[] = []
    readonly undo?: UndoManagerPlugin
    setTracks(fn: (current: TimelineTrack[]) => TimelineTrack[]) {
        const newt = fn(this.tracks)
        if (newt !== this.tracks) {
            this.tracks = newt.sort((a, b) => {
                return (a.order || 0) - (b.order || 0)
            })
            this.dispatchEvent({type: 'tracksChange'})
        }
    }
    setTracksMerge(tracks1: TimelineTrack[], type: string) {
        this.setTracks(t=>{
            const newTracks = [...t]
            const inds: number[] = []
            for (const timelineTrack of tracks1) {
                const i = t.findIndex(t1 => t1.type === timelineTrack.type && t1.uuid === timelineTrack.uuid)
                if (i >= 0) {
                    newTracks[i] = timelineTrack
                    inds.push(i)
                } else {
                    inds.push(newTracks.push(timelineTrack) - 1) // add new track and get its index
                }
            }
            return newTracks.filter((t1, i)=>{
                return inds.includes(i) || t1.type !== type // keep only the tracks that are in the new tracks or not video tracks
            })
        })
    }

    private _extensions: Record<string, TMExtension> = {}

    constructor(public readonly viewer: ThreeViewer) {
        super()
        this.setup()
        this.addExtension(gltfAnimationExt(this))
        this.addExtension(cameraViewsExt(this))
        this.addExtension(matConfExt(this))
        this.addExtension(videoTextureExt(this))
        this.addExtension(animationObjectExt(this))
        // todo subscribe to plugin change
        this.undo = viewer.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')
    }

    addExtension(ext: TMExtension) {
        if (this._extensions[ext.uuid]) {
            this.viewer.console.warn(`TimelineManager: Extension with uuid ${ext.uuid} already exists`)
            return
        }
        this._extensions[ext.uuid] = ext
        ext.setup()
        this.setUpdated(ext.uuid)
    }

    private _updated = new Set<string>()
    setUpdated = (updated: string) => {
        if (updated && !this._updated.has(updated)) {
            this._updated.add(updated)
        }
        this.dispatchEvent({type: 'update', updated})
    }

    update = ()=>{
        if (this._updated.size) {
            for (const upd of [...this._updated]) {
                const ext = this._extensions[upd]
                if (ext) ext.update()
            }
            this._updated.clear()
        }
    }
    setup() {
        this.tracks = []

        // this.viewer.addEventListener('postFrame', this._postFrame)
        Object.values(this._extensions).forEach(e=>e.setup())
    }
    destroy() {

        Object.values(this._extensions).forEach(e=>e.destroy())

        // this.viewer.removeEventListener('postFrame', this._postFrame)

        this.tracks = []
        this._updated.clear()
        this._extensions = {}
    }

    setValue(binding: [any, keyof any], v: any, last: boolean, uid: any, onUndoRedo?: ()=>void) {
        if (this.undo) {
            return this.undo.setValue(binding, v, {last}, uid, undefined, true, onUndoRedo)
        } else if (binding[0]) {
            return safeSetProperty(binding[0], binding[1], v, true, true)
        }
    }
    setValues(bindings: [any, keyof any][], defs: any[], v: any[], last: boolean, uid: any, onUndoRedo?: ()=>void) {
        const proxy = createBindingsProxy(bindings, defs)
        return this.setValue([proxy, 'value'], v, last, uid, onUndoRedo)
    }

    @onChangeDispatchEvent('selectedItemChanged')
        selectedItemId: string
}
