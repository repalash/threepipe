import {AnimationObjectPlugin, CameraViewPlugin, GLTFAnimationPlugin, MaterialConfiguratorBasePlugin} from 'threepipe'
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
                        // setTime(v: number, last = true) {
                        //     // if (this.time === v) return
                        //     // const diff = v - this.time
                        //     return
                        // },
                        setDuration(v: number, last = true) {
                            const d = v * 1000 / viewDuration
                            if (this.duration === d || d < 0) return
                            this.duration = d
                            // view.duration = d
                            manager.setValue([view, 'duration'], d, last, view)
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
                    const time = clipData.startTime || 0
                    track.items.push({
                        label: clip.name || `Action ${i + 1}`,
                        // time: clip.start || 0,
                        time: time,
                        id: action,
                        uuid: track.uuid + i,
                        duration: duration,
                        setTime(v: number, last = true) {
                            this.time = v
                            manager.setValue([clipData, 'startTime'], v, last, clipData, onChange)
                            return
                        },
                        setDuration(v: number, last = true) {
                            this.duration = v
                            const ts = sgn * clip.duration / v
                            manager.setValue([clipData, 'timeScale'], ts, last, clipData, onChange)
                            action.stopWarping()
                        },
                        setTimeDuration(t1: number, d: number, last = true) {
                            this.time = t1
                            this.duration = d
                            const ts = sgn * clip.duration / d
                            manager.setValues([[clipData, 'startTime'], [clipData, 'timeScale']], [0, 1], [t1, ts], last, clipData, onChange)
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
                // create timeline, todo move to the plugin
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
                for (const item of tm) {
                    const mat = typeof item.index === 'number' ? variation.materials[item.index] : variation.materials.find(m => m.uuid === item.index)
                    const uuid = track.uuid + item.index
                    track.items.push({
                        label: mat?.name || 'unnamed',
                        time: item.time,
                        id: item,
                        uuid: uuid,
                        duration: item.duration ?? 0.5, // default 0.5 secs

                        setTime(v: number, last = true) {
                            this.time = v
                            manager.setValue([item, 'time'], v, last, uuid + 'time', onChange)
                        },
                        setDuration(v: number, last = true) {
                            this.duration = v
                            manager.setValue([item, 'duration'], v, last, uuid + 'duration', onChange)
                        },
                        setTimeDuration(t: number, d: number, last = true) {
                            this.time = t
                            this.duration = d
                            manager.setValues([[item, 'time'], [item, 'duration']], [0, 0.5], [t, d], last, uuid + 'time_duration', onChange)
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

                        setTime(v: number, last = true) {
                            if (!vid.userData.timeline) return
                            this.time = v
                            manager.setValue([vid.userData.timeline, 'delay'], v, last, vid.userData.timeline, onChange)
                        },
                        setDuration(v: number, last = true) {
                            if (!vid.userData.timeline) return
                            this.duration = v
                            manager.setValue([vid.userData.timeline, 'scale'], duration / v, last, vid.userData.timeline, onChange)
                        },
                        setTimeDuration(t: number, d: number, last = true) {
                            if (!vid.userData.timeline) return
                            this.time = t
                            this.duration = d
                            manager.setValues([[vid.userData.timeline, 'delay'], [vid.userData.timeline, 'scale']], [0, 1], [t, duration / d], last, vid.userData.timeline, onChange)
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

export function animationObjectExt(manager: TimelineManager): TMExtension {
    const animationObjectPlugin = manager.viewer.getPlugin(AnimationObjectPlugin)!
    const onChange = ()=>{
        manager.setUpdated(AnimationObjectPlugin.PluginType)
    }
    return {
        uuid: AnimationObjectPlugin.PluginType,
        setup() {
            if (animationObjectPlugin) {
                // animationObjectPlugin.addEventListener('animationAdd', onChange)
                // animationObjectPlugin.addEventListener('animationRemove', onChange)
                // animationObjectPlugin.addEventListener('animationUpdate', onChange)
                animationObjectPlugin.addEventListener('rebuildTimeline', onChange)
            }
        },
        destroy() {
            if (animationObjectPlugin) {
                // animationObjectPlugin.removeEventListener('animationAdd', onChange)
                // animationObjectPlugin.removeEventListener('animationRemove', onChange)
                // animationObjectPlugin.removeEventListener('animationUpdate', onChange)
                animationObjectPlugin.removeEventListener('rebuildTimeline', onChange)
            }
        },
        update() {
            const anims = animationObjectPlugin?.getTimeline() ?? []
            const tracks1 = [] as TimelineTrack[]
            for (let i = 0; i < 1; i++) {
                const track = {
                    type: 'animationObject',
                    label: 'Animation Object',
                    id: animationObjectPlugin,
                    uuid: 'animationObject',
                    items: [],
                    order: 999,
                } as TimelineTrack
                for (let i1 = 0; i1 < anims.length; i1++) {
                    const [anim] = anims[i1]
                    const uuid = track.uuid + anim.uuid
                    // v = d + (d + k) * r
                    const getDuration = ()=>anim.duration + (anim.duration + anim.repeatDelay) * anim.repeat
                    // (v - rk) / (1 + r) = d
                    const setDuration = (v: number)=>{
                        return (v - anim.repeatDelay * anim.repeat) / (anim.repeat + 1)
                    }
                    track.items.push({
                        label: anim.name ? anim.name : `Animation ${i1 + 1}`,
                        time: anim.delay / 1000,
                        id: anim,
                        uuid: uuid,
                        duration: getDuration() / 1000,
                        setTime(v: number, last = true) {
                            this.time = v
                            manager.setValue([anim, 'delay'], v * 1000, last, uuid + 'delay', onChange)
                        },
                        setDuration(v: number, last = true) {
                            this.duration = v
                            manager.setValue([anim, 'duration'], 1000 * setDuration(v), last, uuid + 'duration', onChange)
                        },
                        setTimeDuration(t: number, d: number, last = true) {
                            this.time = t
                            this.duration = d
                            manager.setValues([[anim, 'delay'], [anim, 'duration']], [0, 0.5], [t * 1000, 1000 * setDuration(d)], last, uuid + 'delay_duration', onChange)
                        },
                        offsets: anim.offsets,
                    })
                }
                if (track.items.length)
                    tracks1.push(track)
            }

            manager.setTracksMerge(tracks1, 'animationObject')
        },
    }
}
