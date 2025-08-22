import React from 'react'
import {TimelineManager, TimelineTrack, TrackItem} from './TimelineManager'

const cardHeight = 24
const rulerHeight = 20
const timelineGap = 8
const trackHeight = cardHeight + timelineGap

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = (time % 60).toFixed(1)
    return `${minutes}:${seconds.padStart(4, '0')}`
}

interface TimelineProps{
    tracks: TimelineTrack[]
    currentTime: number
    maxTime: number
    endTime: number
    timelineWidth: number
    selectedItem: string | null
    setSelectedItem: (item: string | null) => void
    timeToPixels: (time: number) => number
    pixelsToTime: (pixels: number) => number
    resetOnEnd: boolean
    stopOnEnd: boolean
}

function TimelineCard({item, timeToPixels, isActive, pixelsToTime, selectedItem, setSelectedItem}: Pick<TimelineProps, 'timeToPixels' | 'pixelsToTime' | 'selectedItem' | 'setSelectedItem'> & {
    item: TrackItem
    isActive: boolean
}) {
    const left: number = timeToPixels(item.time)
    const width: number = timeToPixels(item.duration)

    const isSelected = selectedItem && selectedItem === item.uuid

    const setLeft = item.setTime ? (v: number, last = false) => {
        const t = pixelsToTime(v)
        if (item.time === t && !last || !item.setTime) return
        item.setTime(t, last)
    } : null
    const setWidth = item.setDuration ? (v: number, last = false) => {
        const d = pixelsToTime(v)
        if (item.duration === d && !last || !item.setDuration) return
        item.setDuration(d, last)
    } : null
    const setLeftWidth = item.setTimeDuration ? (l: number, w: number, last = false) => {
        const t = pixelsToTime(l)
        const d = pixelsToTime(w)
        if (item.duration === d && item.time === t && !last || !item.setTimeDuration) return
        item.setTimeDuration(t, d, last)
    } : null

    const handlePointerDown = (type: 'left' | 'right' | 'center') => (e: React.PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const startX = e.clientX
        const origLeft = timeToPixels(item.time)
        const origWidth = timeToPixels(item.duration)

        const onPointerMove = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX
            const last = moveEvent.type === 'pointerup'
            if (type === 'right' && setWidth) {
                const newWidth = Math.max(1, origWidth + dx)
                setWidth(newWidth, last)
            } else if (type === 'left') {
                if (setWidth || setLeftWidth) {
                    const newLeft = Math.min(origLeft + origWidth - 1, origLeft + dx)
                    const newWidth = Math.max(1, origWidth - dx)
                    if (setLeftWidth) {
                        setLeftWidth(newLeft, newWidth, last)
                    } else if (setLeft && setWidth) {
                        setLeft(newLeft, last)
                        setWidth(newWidth, last)
                    }
                } else if (setLeft) {
                    const newLeft = Math.max(0, origLeft + dx)
                    setLeft(newLeft, last)
                }
            } else if (type === 'center' && setLeft) {
                const newLeft = Math.max(0, origLeft + dx)
                setLeft(newLeft, last)
            }
        }

        const onPointerUp = (ev: PointerEvent) => {
            onPointerMove(ev)
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
            onPointerDown={isSelected && setLeft ? handlePointerDown('center') : undefined}
        >
            {/* left handle */}
            {setLeft && isSelected && <div
                className={`timeline-card-handle left ${isActive || isSelected ? 'active' : ''}`}
                style={{
                    minWidth: `${handleWidth}px`,
                    width: `${handleWidth}px`,
                }}
                onPointerDown={handlePointerDown('left')}
            />}

            {/* keyframes */}
            {item.offsets && item.offsets.map((offset, index) =>
                <div
                    key={index}
                    className="timeline-card-keyframe"
                    style={{
                        left: `${offset * width}px`,
                    }}
                />
            )}

            {/* label */}
            <span className="timeline-card-label">
                {item.label || 'unnamed'}
            </span>

            {/* right handle */}
            {setWidth && isSelected && <div
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

function TimelineTrackFC({
    track, trackIndex: _trackIndex,
    currentTime, timeToPixels, pixelsToTime, selectedItem, setSelectedItem,
}: {track: TimelineTrack, trackIndex: number} & Pick<TimelineProps, 'currentTime' | 'timeToPixels' | 'pixelsToTime' | 'selectedItem' | 'setSelectedItem'>) {

    // Sort items so that the selected card is rendered last (on top)
    const sortedItems = React.useMemo(() => {
        if (!selectedItem) return track.items
        const items = [...track.items]
        const idx = items.findIndex(item => item.uuid === selectedItem)
        if (idx === -1) return items
        const [selected] = items.splice(idx, 1)
        items.push(selected)
        return items
    }, [track.items, selectedItem])

    return (
        <div
            className="timeline-track"
            style={{
                height: `${trackHeight}px`,
            }}
        >
            {sortedItems.map((item, itemIndex) => {
                const isActive = currentTime >= item.time && currentTime <= item.time + item.duration

                return (
                    <TimelineCard
                        key={item.uuid ?? itemIndex}
                        item={item}
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

// Time Ruler Component
function TimeRuler({maxTime, timeToPixels}: Pick<TimelineProps, 'maxTime'|'timeToPixels'>) {
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
function TimeIndicator({currentTime, endTime, timeToPixels, resetOnEnd, stopOnEnd}: Pick<TimelineProps, 'currentTime'|'endTime'|'timeToPixels'|'resetOnEnd'|'stopOnEnd'>) {
    return (
        <>
            {/* End Time */}
            {(resetOnEnd || stopOnEnd) &&
            <div
                className="timeline-indicator timeline-indicator-end"
                style={{
                    left: `${timeToPixels(endTime)}px`,
                }}
            >
                <div className="timeline-indicator-head timeline-indicator-head-max">
                    <span className="timeline-indicator-label">{(endTime % 60).toFixed(1).padStart(4, '0')}</span>
                </div>
            </div>
            }
            {/* Current Time */}
            <div
                className="timeline-indicator timeline-indicator-current"
                style={{
                    left: `${timeToPixels(currentTime)}px`,
                }}
            >
                <div className="timeline-indicator-head timeline-indicator-head-current">
                    <span className="timeline-indicator-label">{(currentTime % 60).toFixed(1).padStart(4, '0')}</span>
                </div>
            </div>
        </>
    )
}

// Track Labels Component
function TrackLabels({tracks}: {tracks: TimelineTrack[]}) {
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

// Timeline Controls Component
function TimelineControls({isPlaying, currentTime, onPlayPause, onReset, onClose, resetOnEnd, toggleResetOnEnd}: {
    isPlaying: boolean
    currentTime: number
    onPlayPause: () => void
    onReset: () => void
    onClose: () => void
    resetOnEnd: boolean
    toggleResetOnEnd: () => void
}) {
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
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                    </svg>
                </button>
                <button
                    className={`timeline-controls-button timeline-loop-button ${resetOnEnd ? 'active' : ''}`}
                    onClick={toggleResetOnEnd}
                    title={resetOnEnd ? 'Disable Looping' : 'Enable Looping'}
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
function TimelineContent({tracks, currentTime, maxTime, endTime, timelineWidth, setSelectedItem, timeToPixels, pixelsToTime, selectedItem, resetOnEnd, stopOnEnd}: TimelineProps) {
    return (
        <div
            className="timeline-content"
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
                    <TimelineTrackFC
                        key={track.uuid ?? trackIndex}
                        track={track}
                        trackIndex={trackIndex}
                        currentTime={currentTime}
                        timeToPixels={timeToPixels}
                        pixelsToTime={pixelsToTime}
                        selectedItem={selectedItem}
                        setSelectedItem={setSelectedItem}
                    />
                )}

            </div>

            <TimeIndicator
                currentTime={currentTime}
                endTime={endTime}
                timeToPixels={timeToPixels}
                resetOnEnd={resetOnEnd}
                stopOnEnd={stopOnEnd}
            />
        </div>
    )
}

// Main Timeline Component
export function Timeline({manager, closeTimeline}: {manager: TimelineManager, closeTimeline?: ()=>void}) {
    const viewer = manager.viewer
    const [isPlaying, setIsPlaying0] = React.useState(false)

    const [managerUpdated, setManagerUpdated] = React.useState(0)
    const [tracks, setTracks0] = React.useState<TimelineTrack[]>(manager.tracks)

    React.useEffect(() => {
        const l = () => {
            setManagerUpdated(v=>v + 1)
        }
        const lt = ()=>{
            setTracks0(manager.tracks)
        }
        manager.addEventListener('update', l)
        manager.addEventListener('tracksChange', lt)
        return () => {
            manager.removeEventListener('update', l)
            manager.removeEventListener('tracksChange', lt)
        }
    }, [manager])
    React.useEffect(() => {
        manager.update()
    }, [manager, managerUpdated])

    const [selectedItem, setSelectedItem0] = React.useState<string | null>(manager.selectedItemId) // uuid

    // const maxTime = 20
    const [currentTime, setCurrentTime0] = React.useState(0)
    const [endTime, setEndTime0] = React.useState(viewer.timeline.endTime)
    const [resetOnEnd, setResetOnEnd0] = React.useState(viewer.timeline.resetOnEnd)
    const [stopOnEnd, setStopOnEnd0] = React.useState(viewer.timeline.stopOnEnd)
    const maxTimeRef = React.useRef(Math.max(20, viewer.timeline.endTime || 20))
    const timelineWidthRef = React.useRef(maxTimeRef.current * 60)
    const [maxTime, setMaxTime0] = React.useState(maxTimeRef.current)
    const [timelineWidth, setTimelineWidth0] = React.useState(timelineWidthRef.current)

    React.useEffect(() => {
        timelineWidthRef.current = timelineWidth
        maxTimeRef.current = maxTime
    }, [timelineWidth, maxTime])

    const pixelsToTime = React.useCallback((pixels: number) => pixels / timelineWidthRef.current * maxTimeRef.current, [timelineWidthRef, maxTimeRef])
    const timeToPixels = React.useCallback((time: number) => time / maxTimeRef.current * timelineWidthRef.current, [timelineWidthRef, maxTimeRef])

    const setMaxTime = React.useCallback((time: number) => {
        setMaxTime0(time)
        maxTimeRef.current = time
        setTimelineWidth0(Math.max(timelineWidthRef.current, timeToPixels(time)))
    }, [timeToPixels])

    React.useEffect(()=>{
        const l1 = ()=> {
            const time = viewer.timeline.endTime
            if (time > maxTimeRef.current - 0.25) {
                setMaxTime(time + 0.25)
            }
            setEndTime0(time)
        }
        const l2 = ()=> setResetOnEnd0(viewer.timeline.resetOnEnd)
        const l3 = ()=> setStopOnEnd0(viewer.timeline.stopOnEnd)
        viewer.timeline.addEventListener('endTimeChanged', l1)
        viewer.timeline.addEventListener('resetOnEndChanged', l2)
        viewer.timeline.addEventListener('stopOnEndChanged', l3)
        return () => {
            viewer.timeline.removeEventListener('endTimeChanged', l1)
            viewer.timeline.removeEventListener('resetOnEndChanged', l2)
            viewer.timeline.removeEventListener('stopOnEndChanged', l3)
        }
    }, [viewer.timeline])

    const setSelectedItem = React.useCallback((item: string | null) => {
        const itemid = item || ''
        if (manager.selectedItemId !== itemid) {
            manager.setValue([manager, 'selectedItemId'], itemid, true, 'viewer_timeline_ui_selectedItemId')
        }
        return itemid
    }, [manager])
    React.useEffect(()=>{
        const l1 = () => {
            setSelectedItem0(manager.selectedItemId || null)
        }
        manager.addEventListener('selectedItemChanged', l1)
        return () => {
            manager.removeEventListener('selectedItemChanged', l1)
        }
    }, [manager])

    const setCurrentTime = React.useCallback((time: number|undefined, last = true) => {
        setCurrentTime0(t=>{
            // viewer.timeline.time
            time = time ?? t
            if (viewer.timeline.time !== time || last) {
                viewer.timeline.time = time // not tracking undo here
                // manager.setValue([viewer.timeline, 'time'], time, last, 'viewer_timeline_time')
            }
            return time
        })
    }, [viewer.timeline, setCurrentTime0])

    // Update endTime in both state and viewer
    const setEndTime = React.useCallback((time: number | undefined, last = true) => {
        time = time ?? viewer.timeline.endTime
        if (viewer.timeline.endTime !== time || last) {
            manager.setValue([viewer.timeline, 'endTime'], time, last, 'viewer_timeline_endTime')
        }
    }, [viewer.timeline])

    const toggleResetOnEnd = React.useCallback(() => {
        const v = !viewer.timeline.resetOnEnd
        manager.setValue([viewer.timeline, 'resetOnEnd'], v, true, 'viewer_timeline_resetOnEnd')
    }, [viewer.timeline])

    // const toggleStopOnEnd = React.useCallback(() => {
    //     const v = !viewer.timeline.stopOnEnd
    //     manager.setValue([viewer.timeline, 'stopOnEnd'], v, true, 'viewer_timeline_stopOnEnd')
    // }, [viewer.timeline])

    React.useEffect(() => {
        const duration = tracks.reduce((max, track) => {
            const trackMax = track.items.reduce((maxItem, item) => Math.max(maxItem, item.time + item.duration), 0)
            return Math.max(max, trackMax)
        }, 0)
        if (duration > maxTimeRef.current - 2) {
            setMaxTime(duration + 2)
        }
        // return duration
    }, [tracks])

    // region timeline

    const timeline = viewer.timeline

    React.useEffect(() => {
        const l = ()=>{
            setIsPlaying0(timeline.running)
            if (timeline.time > maxTimeRef.current) {
                // console.warn('Timeline time exceeded maxTime, resetting to 0')
                setCurrentTime0(0)
                timeline.setTime(0, false)
            } else {
                setCurrentTime0(timeline.time)
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

    const handlePlayPause = React.useCallback(() => {
        if (timeline.running) timeline.stop()
        else timeline.start()
        setIsPlaying0(!timeline.running)
    }, [timeline])

    // endregion timeline

    // region mouse events

    // Handle mouse pointer drag on timeline
    React.useEffect(()=>{
        const root = document.getElementById('timeline-root')
        if (!root) return
        let isPointerDown = false
        let isDraggingEndTime = false
        const handleTimelinePointer = (e: PointerEvent) => {
            if (e.type === 'pointerup' || e.type === 'pointermove' && e.buttons !== 1) {
                if (isPointerDown) {
                    if (isDraggingEndTime) {
                        setEndTime(undefined, true)
                    } else {
                        setCurrentTime(undefined, true)
                    }
                }
                isPointerDown = false
                isDraggingEndTime = false
                window.removeEventListener('pointerup', handleTimelinePointer)
                window.removeEventListener('pointermove', handleTimelinePointer)
                return
            }

            const target = e.target as HTMLDivElement
            if (e.type === 'pointerdown' && (
                target.closest('.timeline-controls-buttons') ||
                target.closest('.timeline-controls-title') ||
                target.closest('.timeline-track-labels'))) return

            if (e.type === 'pointerdown') {
                // Check if we're clicking on the end time indicator
                isDraggingEndTime = !!target.closest('.timeline-indicator-end')
                isPointerDown = true
                window.addEventListener('pointerup', handleTimelinePointer)
                window.addEventListener('pointermove', handleTimelinePointer)
            }
            if (!isPointerDown) return

            const ct = document.getElementById('timeline-content')
            if (!ct) return
            const rect = ct.getBoundingClientRect()
            const x = e.clientX - rect.left
            const newTime = Math.max(0, Math.min(maxTimeRef.current, pixelsToTime(x)))

            if (isDraggingEndTime) {
                setEndTime(newTime, false)
            } else {
                setCurrentTime(newTime, false)
            }
        }
        root.addEventListener('pointerdown', handleTimelinePointer)
        return () => {
            root.removeEventListener('pointerdown', handleTimelinePointer)
            window.removeEventListener('pointerup', handleTimelinePointer)
            window.removeEventListener('pointermove', handleTimelinePointer)
        }
    }, [])

    // Handle mouse wheel zoom
    React.useEffect(()=>{
        const l = (e: WheelEvent)=>{
            if (Math.abs(e.deltaY) < 0.001 || !e.ctrlKey) return
            // check if target in timeline content
            const timelineContent = document.getElementById('timeline-content')
            if (timelineContent && timelineContent.contains(e.target as Node)) {
                e.preventDefault()

                // Find the scrollable container
                const scrollContainer = timelineContent.parentElement
                if (!scrollContainer) return

                const timelineRect = timelineContent.getBoundingClientRect()
                const mouseX = e.clientX - timelineRect.left// + scrollContainer.scrollLeft

                // Calculate new width
                const delta = e.deltaY > 0 ? -1 : 1
                const newWidth = Math.max(500, timelineWidthRef.current + delta * 20)

                // (x - l + s) / w = c
                // (x - l + s + k) / nw = c
                // (x - l + s + k) = (x - l + s) * nw / w
                // k = ((x - l + s) * nw / w) - (x - l + s)
                // k = (x - l + s) * (nw / w - 1)
                const scrollAdjustment = mouseX * (newWidth / timelineWidthRef.current - 1)

                setTimelineWidth0(newWidth)
                timelineWidthRef.current = newWidth

                // Adjust scroll position to maintain the time value under the mouse cursor
                // Use requestAnimationFrame to ensure the DOM has updated with the new width
                requestAnimationFrame(() => {
                    scrollContainer.scrollLeft += scrollAdjustment
                })
            }
        }
        window.addEventListener('wheel', l, {passive: false})
        return () => {
            window.removeEventListener('wheel', l)
        }
    }, [])

    // endregion mouse events

    return (
        <div
            className="timeline-root-container"
        >
            <TimelineControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                onPlayPause={handlePlayPause}
                resetOnEnd={resetOnEnd}
                toggleResetOnEnd={toggleResetOnEnd}
                onReset={() => {
                    setCurrentTime(0)
                    viewer.timeline.setTime(0, true)
                }}
                onClose={closeTimeline || (() => {
                    const root = document.getElementById('timeline-root')
                    if (root) {
                        root.remove()
                    }
                })}
            />

            <div className="timeline-main-row">
                <TrackLabels tracks={tracks} />

                <div
                    className="timeline-scroll-container"
                >
                    <TimelineContent
                        tracks={tracks}
                        currentTime={currentTime}
                        maxTime={maxTime}
                        endTime={endTime}
                        timelineWidth={timelineWidth}
                        timeToPixels={timeToPixels}
                        pixelsToTime={pixelsToTime}
                        selectedItem={selectedItem}
                        resetOnEnd={resetOnEnd}
                        stopOnEnd={stopOnEnd}
                        setSelectedItem={setSelectedItem}
                    />
                </div>
            </div>
        </div>
    )
}

// init()
