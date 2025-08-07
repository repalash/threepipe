import {EventDispatcher, ThreeViewer} from 'threepipe'
import {cameraViewsExt, gltfAnimationExt, matConfExt, videoTextureExt} from './extensions'

export interface TrackItem {
    label: string // Start time in seconds
    uuid: string
    id: any // object mapped
    time: number // Start time in seconds
    duration: number // Duration in seconds

    setTime?(v: number): void
    setDuration?(v: number): void
}
export interface TimelineTrack {
    type?: string,
    label: string,
    uuid: string,
    id: any,
    items: TrackItem[]
}

export interface TMExtension {
    uuid: string
    setup(): void;
    destroy(): void;
    update(): void;
}

export class TimelineManager extends EventDispatcher<{update: {updated: string}, tracksChange: object}> {
    tracks: TimelineTrack[] = []
    setTracks(fn: (current: TimelineTrack[]) => TimelineTrack[]) {
        const newt = fn(this.tracks)
        if (newt !== this.tracks) {
            this.tracks = newt
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
}
