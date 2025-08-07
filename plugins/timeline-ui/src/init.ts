import {ThreeViewer} from 'threepipe'
import {TimelineManager} from './TimelineManager'
import {createRoot} from 'react-dom/client'
import {createElement} from 'react'
import {Timeline} from './timeline'

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
    root.style.pointerEvents = 'none'
    root.style.background = 'transparent'
    document.documentElement.style.overscrollBehavior = 'contain' // to prevent accidental back/forward

    const manager = new TimelineManager(viewer)

    createRoot(root).render(createElement(Timeline, {manager}))
}
