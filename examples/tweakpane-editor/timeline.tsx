import {CameraView, CameraViewPlugin, MaterialConfiguratorBasePlugin, Object3DManager, ThreeViewer} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import './timeline.css'

interface TrackItem {
    label: string // Start time in seconds
    uuid: any
    id: any // object mapped
    time: number // Start time in seconds
    duration: number // Duration in seconds

    setTime?(v: number): void
    setDuration?(v: number): void
}
interface TimelineTrack {
    type?: string,
    label: string,
    uuid: string,
    id: any,
    items: TrackItem[]
}

function TimelineCard({item, trackHeight, cardHeight, timeToPixels, isActive, pixelsToTime, selectedItem, setSelectedItem}) {
    const left: number = timeToPixels(item.time)
    const width: number = timeToPixels(item.duration)

    const isSelected = selectedItem && selectedItem === item.uuid

    const setLeft = (v: number) => {
        const t = pixelsToTime(v)
        if (item.time === t || !item.setTime) return
        item.setTime(t, false)
    }
    const setWidth = (v: number) => {
        const d = pixelsToTime(v)
        if (item.duration === d || !item.setDuration) return
        item.setDuration(d)
    }

    const handlePointerDown = (type: 'left' | 'right' | 'center') => (e: React.PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const startX = e.clientX
        const origLeft = timeToPixels(item.time)
        const origWidth = timeToPixels(item.duration)

        const onPointerMove = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX
            if (type === 'right') {
                const newWidth = Math.max(1, origWidth + dx)
                setWidth(newWidth)
            } else if (type === 'left') {
                if (item.setDuration) {
                    const newLeft = Math.min(origLeft + origWidth - 1, origLeft + dx)
                    const newWidth = Math.max(1, origWidth - dx)
                    setLeft(newLeft)
                    setWidth(newWidth)
                } else {
                    const newLeft = Math.max(0, origLeft + dx)
                    setLeft(newLeft)
                }
            } else if (type === 'center') {
                const newLeft = Math.max(0, origLeft + dx)
                setLeft(newLeft)
            }
        }

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }

    const handleWidth = 6

    return (
        <div
            className={`timeline-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
            style={{
                left: `${left}px`,
                top: `${(trackHeight - cardHeight) / 2}px`,
                width: `${width}px`,
                height: `${cardHeight}px`,
            }}
            onClick={(e) => {
                e.stopPropagation()
                if (isSelected) {
                    // setSelectedItem(null)
                } else {
                    // console.log('set selected')
                    setSelectedItem(item.uuid)
                }
            }}
            onPointerDown={isSelected && item.setTime ? handlePointerDown('center') : undefined}
        >
            {/* left handle */}
            {item.setTime && isSelected && <div
                className={`timeline-card-handle left ${isActive || isSelected ? 'active' : ''}`}
                style={{
                    minWidth: `${handleWidth}px`,
                    width: `${handleWidth}px`,
                }}
                onPointerDown={handlePointerDown('left')}
            />}

            {/* label */}
            <span className="timeline-card-label">
                {item.label || 'unnamed'}
            </span>

            {/* right handle */}
            {item.setDuration && isSelected && <div
                className={`timeline-card-handle right ${isActive || isSelected ? 'active' : ''}`}
                style={{
                    minWidth: `${handleWidth}px`,
                    width: `${handleWidth}px`,
                }}
                onPointerDown={handlePointerDown('right')}
            />}
        </div>
    )
}


function TimelineTrack({track, trackIndex, trackHeight, cardHeight, currentTime, timeToPixels, pixelsToTime, selectedItem, setSelectedItem}) {
    return (
        <div
            className="timeline-track"
            style={{
                height: `${trackHeight}px`,
            }}
        >
            {track.items.map((item, itemIndex) => {
                const isActive = currentTime >= item.time && currentTime <= item.time + item.duration

                return (
                    <TimelineCard
                        key={item.uuid ?? itemIndex}
                        item={item}
                        trackHeight={trackHeight}
                        cardHeight={cardHeight}
                        timeToPixels={timeToPixels}
                        isActive={isActive}
                        pixelsToTime={pixelsToTime}
                        selectedItem={selectedItem}
                        setSelectedItem={setSelectedItem}
                    />
                )
            })}
        </div>
    )
}

const cardHeight = 24
const rulerHeight = 20
const timelineGap = 8

// Time Ruler Component
function TimeRuler({maxTime, timeToPixels}) {
    return (
        <div
            className="timeline-ruler"
            style={{
                height: `${rulerHeight}px`,
            }}
        >
            {Array.from({length: Math.ceil(maxTime) + 1}, (_, i) =>
                <div
                    key={i}
                    className="timeline-ruler-mark"
                    style={{
                        left: `${timeToPixels(i)}px`,
                    }}
                >
                    {i}s
                </div>
            )}
        </div>
    )
}

// Current Time Indicator Component
function TimeIndicator({currentTime, timeToPixels}) {
    return (
        <div
            className="timeline-indicator"
            style={{
                left: `${timeToPixels(currentTime)}px`,
            }}
        >
            <div className="timeline-indicator-head" />
        </div>
    )
}

// Track Labels Component
function TrackLabels({tracks, trackHeight}: {tracks: TimelineTrack[], trackHeight: number}) {
    return (
        <div
            className="timeline-track-labels"
            style={{
                paddingTop: `${rulerHeight + timelineGap / 2}px`, // ruler height
            }}
        >
            {tracks.map((track, index) =>
                <div
                    key={track.uuid ?? index}
                    className="timeline-track-label"
                    style={{
                        height: `${trackHeight}px`,
                    }}
                >
                    {track.label || 'Unnamed Track'}
                </div>
            )}
        </div>
    )
}

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = (time % 60).toFixed(1)
    return `${minutes}:${seconds.padStart(4, '0')}`
}

// Timeline Controls Component
function TimelineControls({isPlaying, currentTime, onPlayPause, onReset, onClose}) {
    const currentTimeStr = formatTime(currentTime)

    return (
        <div className="timeline-controls">
            <span className="timeline-controls-title">Timeline</span>
            <div className="timeline-controls-buttons">
                <button
                    className="timeline-controls-button timeline-reset-button"
                    onClick={onReset}
                    title="Reset"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
                    </svg>
                </button>
                <button
                    className={`timeline-controls-button timeline-play-button ${isPlaying ? 'active' : ''}`}
                    onClick={onPlayPause}
                    title={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ?
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                        </svg>
                        :
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                        </svg>
                    }
                </button>
                <span className="timeline-time-display"
                    title={`Current time: ${currentTimeStr}`}
                >
                    {currentTimeStr}
                </span>
                <button
                    className="timeline-controls-button timeline-close-button"
                    onClick={onClose}
                    title="Close Timeline"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    )
}

// Timeline Content Component
function TimelineContent({tracks, currentTime, maxTime, timelineWidth, trackHeight, cardHeight, onTimelineClick, selectedItem, setSelectedItem}) {
    const timeToPixels = (time: number) => time / maxTime * timelineWidth
    const pixelsToTime = (pixels: number) => pixels / timelineWidth * maxTime

    return (
        <div
            className="timeline-content"
            // onPointerDown={onTimelineClick}
            // onPointerMove={onTimelineClick}
            style={{
                width: `${timelineWidth}px`,
            }}
            id={'timeline-content'}
        >
            <TimeRuler maxTime={maxTime} timeToPixels={timeToPixels} />

            {/* Vertical grid lines */}
            <div className="timeline-grid">
                {Array.from({length: Math.ceil(maxTime) + 1}, (_, i) =>
                    <div
                        key={i}
                        className="timeline-grid-line"
                        style={{
                            left: `${timeToPixels(i)}px`,
                        }}
                    />
                )}
            </div>

            <div
                className="timeline-tracks-container"
                style={{
                    width: `${timelineWidth}px`,
                    padding: `${timelineGap / 2}px 0`,
                }}
                onClick={()=> {
                    // console.log('unselect')
                    setSelectedItem(null)
                }}
            >
                {tracks.map((track, trackIndex) =>
                    <TimelineTrack
                        key={track.uuid ?? trackIndex}
                        track={track}
                        trackIndex={trackIndex}
                        trackHeight={trackHeight}
                        cardHeight={cardHeight}
                        currentTime={currentTime}
                        timeToPixels={timeToPixels}
                        pixelsToTime={pixelsToTime}
                        selectedItem={selectedItem}
                        setSelectedItem={setSelectedItem}
                    />
                )}

                <TimeIndicator currentTime={currentTime} timeToPixels={timeToPixels} />
            </div>
        </div>
    )
}

// Main Timeline Component
function Timeline({viewer}: {viewer: ThreeViewer}) {
    const [currentTime, _setCurrentTime] = React.useState(0)
    const [isPlaying, _setIsPlaying] = React.useState(false)
    const [tracks, setTracks] = React.useState<TimelineTrack[]>([])
    const [selectedItem, setSelectedItem] = React.useState<string | null>(null) // uuid

    const maxTime = 20
    const [timelineWidth, setTimelineWidth] = React.useState(1500)
    const trackHeight = cardHeight + timelineGap

    const timelineWidthRef = React.useRef(timelineWidth)

    // Keep ref updated
    React.useEffect(() => {
        timelineWidthRef.current = timelineWidth
    }, [timelineWidth])



    const setTracksMerge = React.useCallback((tracks1: TimelineTrack[], type: string)=>{
        setTracks(t=>{
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
    }, [setTracks])

    // region timeline

    const timeline = viewer.timeline

    React.useEffect(() => {
        const l = ()=>{
            _setIsPlaying(timeline.running)
            if (timeline.time > maxTime) {
                // console.warn('Timeline time exceeded maxTime, resetting to 0')
                _setCurrentTime(0)
                timeline.setTime(0, false)
            } else {
                _setCurrentTime(timeline.time)
            }
        }

        timeline.addEventListener('start', l)
        timeline.addEventListener('stop', l)
        timeline.addEventListener('reset', l)
        timeline.addEventListener('update', l)
        return () => {
            timeline.removeEventListener('start', l)
            timeline.removeEventListener('stop', l)
            timeline.removeEventListener('reset', l)
            timeline.removeEventListener('update', l)
        }
    }, [timeline])

    const setCurrentTime = React.useCallback((time: number) => {
        _setCurrentTime(time)
        // viewer.timeline.time
        if (viewer.timeline.time !== time) {
            viewer.timeline.setTime(time, true)
        }
    }, [currentTime, _setCurrentTime])

    const handlePlayPause = React.useCallback(() => {
        if (timeline.running) timeline.stop()
        else timeline.start()
        _setIsPlaying(!timeline.running)
    }, [timeline])

    // endregion timeline

    // region camera views

    const cameraViews = viewer.getPlugin(CameraViewPlugin)!
    const [cameraViewsVersion, setCameraViewsVersion] = React.useState(0)

    React.useEffect(() => {
        const l = ()=>{
            setCameraViewsVersion(v=>v + 1)
        }

        cameraViews.addEventListener('update', l) // any update
        cameraViews.addEventListener('viewAdd', l)
        cameraViews.addEventListener('viewDelete', l)
        cameraViews.addEventListener('viewUpdate', l)
        return () => {
            cameraViews.removeEventListener('update', l)
            cameraViews.removeEventListener('viewAdd', l)
            cameraViews.removeEventListener('viewDelete', l)
            cameraViews.removeEventListener('viewUpdate', l)
        }
    }, [cameraViews])

    React.useEffect(() => {
        const trackType = 'cameraViews'
        // console.log(track)
        setTracks(t=>{
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
                newTracks[lastI] = track
                return newTracks
            }
            return [...t, track]
        })
    }, [cameraViews, cameraViewsVersion])
    // endregion camera views

    // region material configurator

    const matConf = viewer.getPlugin(MaterialConfiguratorBasePlugin)!
    const [matConfVersion, setMatConfVersion] = React.useState(0)

    React.useEffect(() => {
        const l = ()=>{
            setMatConfVersion(v=>v + 1)
        }

        matConf.addEventListener('refreshUi', l)
        return () => {
            matConf.removeEventListener('refreshUi', l)
        }
    }, [matConf])

    React.useEffect(() => {
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

        setTracksMerge(tracks1, 'matConf')
    }, [matConf, matConfVersion])

    // endregion material configurator

    // region video

    const objectManager = viewer.object3dManager!
    const [videoListVersion, setVideoListVersion] = React.useState(0)

    React.useEffect(() => {
        const l = ()=>{
            setVideoListVersion(v=>v + 1)
        }

        objectManager.addEventListener('videoAdd', l)
        objectManager.addEventListener('videoRemove', l)
        return () => {
            objectManager.removeEventListener('videoAdd', l)
            objectManager.removeEventListener('videoRemove', l)
        }
    }, [matConf])

    React.useEffect(() => {
        const vids = objectManager.getVideos()
        const tracks1 = [] as TimelineTrack[]
        for (let i = 0; i < 1; i++) {
            // const variation = vars[i]
            const track = {
                type: 'videoList',
                label: 'Videos',
                id: 'videoList',
                uuid: 'videoList' + i,
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
                console.log(duration)
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

            tracks1.push(track)

            break
        }

        setTracksMerge(tracks1, 'videoList')
        // console.log(track)

    }, [objectManager, videoListVersion])

    // endregion video

    const pixelsToTime = (pixels: number) => pixels / timelineWidth * maxTime

    const handleTimelineClick = (e: React.PointerEvent) => {
        if (e.type === 'pointermove' && e.buttons !== 1) return // Only handle mouse down events
        // const ct = e.currentTarget as HTMLDivElement
        const ct = document.getElementById('timeline-content')
        if (!ct) return
        const rect = ct.getBoundingClientRect()
        const x = e.clientX - rect.left
        const newTime = Math.max(0, Math.min(maxTime, pixelsToTime(x)))
        setCurrentTime(newTime)
    }

    React.useEffect(()=>{
        window.addEventListener('wheel', (e)=>{
            if (Math.abs(e.deltaY) < 0.001 || !e.ctrlKey) return
            // check if target in timeline content
            const timelineContent = document.getElementById('timeline-content')
            if (timelineContent && timelineContent.contains(e.target as Node)) {
                e.preventDefault()

                // Find the scrollable container
                const scrollContainer = timelineContent.parentElement
                if (!scrollContainer) return

                // Get mouse position relative to the timeline content
                const timelineRect = timelineContent.getBoundingClientRect()
                const mouseX = e.clientX - timelineRect.left + scrollContainer.scrollLeft

                // Calculate the time value under the mouse cursor before zooming
                const timeUnderMouse = mouseX / timelineWidthRef.current * maxTime

                // Calculate new width
                const delta = e.deltaY > 0 ? -1 : 1
                const newWidth = Math.max(500, timelineWidthRef.current + delta * 10)

                // Calculate what the new mouse position should be to maintain the same time under cursor
                const newMouseX = timeUnderMouse / maxTime * newWidth

                // Calculate the required scroll adjustment
                const scrollAdjustment = newMouseX - mouseX

                // Update timeline width
                setTimelineWidth(newWidth)
                timelineWidthRef.current = newWidth

                // Adjust scroll position to maintain the time value under the mouse cursor
                // Use requestAnimationFrame to ensure the DOM has updated with the new width
                requestAnimationFrame(() => {
                    scrollContainer.scrollLeft += scrollAdjustment
                })
            }
        }, {passive: false})
    }, [])

    return (
        <div
            style={{
                boxSizing: 'border-box',
                position: 'absolute',
                bottom: 0,
                left: 0,
                backgroundColor: 'var(--tp-base-background-color)',
                padding: '0',
                borderRadius: 'var(--tp-element-border-radius)',
                pointerEvents: 'auto',
                width: 'calc(100% - 40px)',
                margin: '20px',
                height: 'auto',
                color: 'var(--tp-container-foreground-color)',
                fontFamily: 'var(--tp-font-family)',
                overflow: 'hidden',
                border: '1px solid var(--tp-container-border-color)',
                boxShadow: '0 4px 8px var(--tp-base-shadow-color)',
            }}
            onPointerDown={handleTimelineClick}
            onPointerMove={handleTimelineClick}
        >
            <TimelineControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                onPlayPause={handlePlayPause}
                onReset={() => {
                    setCurrentTime(0)
                    viewer.timeline.setTime(0, true)
                }}
                onClose={() => {
                    const root = document.getElementById('timeline-root')
                    if (root) {
                        root.remove()
                    }
                }}
            />

            <div style={{
                display: 'flex',
                height: 'auto',
                width: '100%',
            }}>
                <TrackLabels tracks={tracks} trackHeight={trackHeight} />

                <div
                    style={{
                        display: 'flex',
                        height: 'auto',
                        width: '100%',
                        flex: '1 1 50%',
                        overscrollBehavior: 'contain',
                        overflowX: 'scroll',
                        overflowY: 'hidden',
                        userSelect: 'none',
                    }}>
                    <TimelineContent
                        tracks={tracks}
                        currentTime={currentTime}
                        maxTime={maxTime}
                        timelineWidth={timelineWidth}
                        trackHeight={trackHeight}
                        cardHeight={cardHeight}
                        // onTimelineClick={handleTimelineClick}
                        selectedItem={selectedItem}
                        setSelectedItem={setSelectedItem}
                    />
                </div>
            </div>
        </div>
    )
}

export async function initTimeline(viewer: ThreeViewer) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.style.position = 'absolute'
    root.style.top = '0'
    root.style.left = '0'
    root.style.width = '100%'
    root.style.height = '100%'
    root.style.zIndex = '1000'
    root.id = 'timeline-root'
    root.style.pointerEvents = 'none' // Disable pointer events to allow interaction with the viewer
    root.style.background = 'transparent' // Optional: semi-transparent background

    createRoot(root).render(
        <Timeline viewer={viewer}
        />
    )
}

// init()
