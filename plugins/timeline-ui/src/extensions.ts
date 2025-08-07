import {CameraViewPlugin, GLTFAnimationPlugin, MaterialConfiguratorBasePlugin} from 'threepipe'
import type {TimelineManager, TimelineTrack, TMExtension} from './TimelineManager'

export function cameraViewsExt(manager: TimelineManager): TMExtension {
    const cameraViews = manager.viewer.getPlugin(CameraViewPlugin)
    const trackType = 'cameraViews'
    const onChange = ()=>{
        manager.setUpdated(CameraViewPlugin.PluginType)
    }
    return {
        uuid: CameraViewPlugin.PluginType,
        setup() {
            if (cameraViews) {
                cameraViews.addEventListener('update', onChange) // any update
                cameraViews.addEventListener('viewAdd', onChange)
                cameraViews.addEventListener('viewDelete', onChange)
                cameraViews.addEventListener('viewUpdate', onChange)
            }
        },
        destroy() {
            if (cameraViews) {
                cameraViews.removeEventListener('update', onChange)
                cameraViews.removeEventListener('viewAdd', onChange)
                cameraViews.removeEventListener('viewDelete', onChange)
                cameraViews.removeEventListener('viewUpdate', onChange)
            }
        },
        update() {
            manager.setTracks(t=>{
                const lastI = t.findIndex(t1 => t1.type === trackType)

                const views = cameraViews?.cameraViews ?? []
                const track = lastI >= 0 ? t[lastI] : {
                    label: 'Camera Views',
                    id: cameraViews,
                    type: trackType,
                    uuid: trackType,
                    items: [],
                } as TimelineTrack
                // const lastItems = track.items || []
                track.items = []

                const viewDuration = cameraViews?.animDuration || 1000
                const pauseTime = cameraViews?.viewPauseTime || 0
                let time = 0
                for (let i = 0; i < views.length; i++) {
                    const view = views[i]
                    const duration = Math.max(2, view.duration * viewDuration) / 1000
                    track.items.push({
                        label: view.name || `View ${i + 1}`,
                        time: time,
                        id: view,
                        uuid: track.uuid + view.uuid, // assuming one view is only adding to the track once at max
                        duration: duration,
                        // setTime(v: number) {
                        //     // if (this.time === v) return
                        //     // const diff = v - this.time
                        //     return
                        // },
                        setDuration(v: number) {
                            const d = v * 1000 / viewDuration
                            if (this.duration === d || d < 0) return
                            // this.duration = d
                            view.duration = d
                        },
                    })
                    time += duration + pauseTime / 1000
                }

                // const i = t.findIndex(t1 => t1.type === track.type)
                if (lastI >= 0) {
                    const newTracks = [...t]
                    if (track.items.length) {
                        newTracks[lastI] = track
                    } else {
                        newTracks.splice(lastI, 1)
                    }
                    return newTracks
                }
                return track.items.length ? [...t, track] : t
            })
        },
    }
}

export function gltfAnimationExt(manager: TimelineManager): TMExtension {
    const gltfAnimation = manager.viewer.getPlugin(GLTFAnimationPlugin)
    const trackType = 'gltfAnimation'
    const onChange = ()=>{
        manager.setUpdated(GLTFAnimationPlugin.PluginType)
    }
    return {
        uuid: GLTFAnimationPlugin.PluginType,
        setup() {
            if (gltfAnimation) {
                gltfAnimation.autoIncrementTime = false
                gltfAnimation.autoplayOnLoadForce = true
                gltfAnimation.stopOnCheckpointEnd = false
                gltfAnimation.autoEnableActions = true
                gltfAnimation.autoUnpauseActions = true
                gltfAnimation.activeActionWeight = 1
                gltfAnimation.inactiveActionWeight = 0
                gltfAnimation.loopAnimations = true // todo force
                gltfAnimation.syncMaxDuration = false // todo force
                gltfAnimation.addEventListener('addAnimation', onChange) // any update
                gltfAnimation.addEventListener('removeAnimation', onChange) // any update
                if (gltfAnimation.animations.length && gltfAnimation.animationState !== 'playing') {
                    gltfAnimation.playAnimation(false)
                }
            }
        },
        destroy() {
            if (gltfAnimation) {
                gltfAnimation.removeEventListener('addAnimation', onChange)
                gltfAnimation.removeEventListener('removeAnimation', onChange)
            }
        },
        update() {
            manager.setTracks(t=>{
                const lastI = t.findIndex(t1 => t1.type === trackType)

                const animations = gltfAnimation?.animations ?? []
                // console.log(animations)
                const actions = animations.flatMap(a=> a.actions || [])
                const track = lastI >= 0 ? t[lastI] : {
                    label: 'glTF Animations',
                    id: gltfAnimation,
                    type: trackType,
                    uuid: trackType,
                    items: [],
                } as TimelineTrack
                // const lastItems = track.items || []
                track.items = []

                for (let i = 0; i < actions.length; i++) {
                    const action = actions[i]
                    const clip = action.getClip()
                    const clipData = action.clipData || {startTime: 0, timeScale: action.timeScale}
                    if (!action.clipData) {
                        manager.viewer.console.warn('gltfAnimationExt: Action has no clipData, make sure to only use GLTFAnimationPlugin to create animations', action)
                    }
                    const sgn = Math.sign(clipData.timeScale)
                    const duration = sgn * clip.duration / clipData.timeScale
                    // if (action._startTime === undefined) {
                    //     console.error('gltfAnimationExt: Minified three.js used')
                    // }
                    const time = clipData.startTime || 0 // action.startTime is non-standard three.js supported by GLTFAnimationPlugin
                    track.items.push({
                        label: clip.name || `Action ${i + 1}`,
                        // time: clip.start || 0,
                        time: time,
                        id: action,
                        uuid: track.uuid + i,
                        duration: duration,
                        setTime(v: number) {
                            this.time = v
                            clipData.startTime = v // action.startTime
                            action.stopWarping()
                            return
                        },
                        setDuration(v: number) {
                            this.duration = v
                            const ts = sgn * clip.duration / v
                            clipData.timeScale = ts
                            action.timeScale = ts
                            action.stopWarping()
                        },
                    })
                }

                // const i = t.findIndex(t1 => t1.type === track.type)
                if (lastI >= 0) {
                    const newTracks = [...t]
                    if (track.items.length) {
                        newTracks[lastI] = track
                    } else {
                        newTracks.splice(lastI, 1)
                    }
                    return newTracks
                }
                return track.items.length ? [...t, track] : t
            })
        },
    }
}

export function matConfExt(manager: TimelineManager): TMExtension {
    const matConf = manager.viewer.getPlugin(MaterialConfiguratorBasePlugin)!
    const onChange = ()=>{
        manager.setUpdated(MaterialConfiguratorBasePlugin.PluginType)
    }
    return {
        uuid: MaterialConfiguratorBasePlugin.PluginType,
        setup() {
            if (matConf) {
                matConf.addEventListener('refreshUi', onChange)
            }
        },
        destroy() {
            if (matConf) {
                matConf.removeEventListener('refreshUi', onChange)
            }
        },
        update() {
            const vars = matConf?.variations ?? []
            const tracks1 = [] as TimelineTrack[]
            for (let i = 0; i < vars.length; i++) {
                const variation = vars[i]
                const track = {
                    type: 'matConf',
                    label: variation.title ? `${variation.title} (Material)` : `Material ${i + 1}`,
                    id: variation,
                    uuid: 'matConf' + (variation.uuid ?? i),
                    items: [],
                } as TimelineTrack
                let tm = variation.timeline
                if (!tm) {
                    tm = []
                    const duration = 0.5
                    const pauseTime = 3
                    let time = 0
                    for (const item of variation.materials) {
                        tm.push({
                            time: time,
                            index: item.uuid,
                            duration: duration,
                        })
                        time += duration + pauseTime
                    }
                    variation.timeline = tm
                }
                for (let i1 = 0; i1 < tm.length; i1++) {
                    const item = tm[i1]
                    const mat = typeof item.index === 'number' ? variation.materials[item.index] : variation.materials.find(m=>m.uuid === item.index)
                    track.items.push({
                        label: mat?.name || 'unnamed',
                        time: item.time,
                        id: item,
                        uuid: track.uuid + i1,
                        duration: item.duration ?? 0.5, // default 0.5 secs

                        setTime(v: number) {
                            item.time = v
                            this.time = v
                        },
                        setDuration(v: number) {
                            item.duration = v
                            this.duration = v
                        },
                    })
                }
                tracks1.push(track)
            }

            manager.setTracksMerge(tracks1, 'matConf')
        },
    }
}

export function videoTextureExt(manager: TimelineManager): TMExtension {
    const objectManager = manager.viewer.object3dManager
    const trackType = 'videoList'
    const onChange = ()=>{
        manager.setUpdated(trackType)
    }
    return {
        uuid: trackType,
        setup() {
            objectManager.addEventListener('videoAdd', onChange)
            objectManager.addEventListener('videoRemove', onChange)
        },
        destroy() {
            objectManager.removeEventListener('videoAdd', onChange)
            objectManager.removeEventListener('videoRemove', onChange)
        },
        update() {
            const vids = objectManager.getVideos()
            const tracks1 = [] as TimelineTrack[]
            for (let i = 0; i < 1; i++) {
                // const variation = vars[i]
                const track = {
                    type: trackType,
                    label: 'Videos',
                    id: trackType,
                    uuid: trackType + i,
                    items: [],
                } as TimelineTrack

                for (let i1 = 0; i1 < vids.length; i1++) {
                    const vid = vids[i1]
                    if (!vid) continue
                    if (!vid.userData.timeline) {
                        vid.userData.timeline = {
                            enabled: true,
                            delay: 0,
                            scale: 1,
                            start: 0,
                            end: 0,
                        }
                    }
                    const {delay, scale, start, end} = vid.userData.timeline || {}
                    const duration = ((vid.image as HTMLVideoElement)?.duration || 1) - ((start || 0) + (end || 0))
                    // console.log(duration)
                    const tDuration = duration / (scale || 1)
                    // td = (d - (start + end))/scale
                    // d - (start + end) = d1 * scale
                    track.items.push({
                        label: vid.name || `Video ${i1 + 1}`,
                        time: delay || 0,
                        id: vid,
                        uuid: track.uuid + i1,
                        duration: tDuration,

                        setTime(v: number) {
                            if (!vid.userData.timeline) return
                            vid.userData.timeline.delay = v
                            this.time = v
                        },
                        setDuration(v: number) {
                            if (!vid.userData.timeline) return
                            vid.userData.timeline.scale = duration / v
                            this.duration = v
                        },
                    })
                }

                if (track.items.length)
                    tracks1.push(track)

                break
            }

            manager.setTracksMerge(tracks1, trackType)
            // console.log(track)
        },
    }
}

