/**
 * The viewport: hosts `viewer.container` and opens the operator context menu on a right click that
 * did not drag (so right-drag still pans).
 */

import {useEffect, useRef} from 'react'
import {useEditor} from './EditorContext'
import {useContextMenu} from './ContextMenuProvider'

export function Viewport() {
    const {viewer, engine} = useEditor()
    const ref = useRef<HTMLDivElement>(null)
    const contextMenu = useContextMenu()

    useEffect(() => {
        const host = ref.current
        if (!host) return
        if (viewer.container.parentElement !== host) {
            host.appendChild(viewer.container)
            viewer.resize()
        }
        const ro = new ResizeObserver(() => viewer.resize())
        ro.observe(host)
        return () => ro.disconnect()
    }, [viewer])

    useEffect(() => {
        const canvas = viewer.canvas
        let down: {x: number, y: number} | null = null
        const onDown = (e: PointerEvent) => { if (e.button === 2) down = {x: e.clientX, y: e.clientY} }
        const onUp = (e: PointerEvent) => {
            if (e.button !== 2 || !down) return
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
            down = null
            if (moved > 4) return
            const scope = engine.mode === 'edit' ? engine.selectMode : 'object'
            const title = engine.mode === 'edit' ? `${scope} context` : engine.context().selectedObjects[0]?.name || 'Object'
            contextMenu.showOperators({clientX: e.clientX, clientY: e.clientY}, scope, undefined, title)
        }
        const onContext = (e: MouseEvent) => e.preventDefault()
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('contextmenu', onContext)
        return () => {
            canvas.removeEventListener('pointerdown', onDown)
            canvas.removeEventListener('pointerup', onUp)
            canvas.removeEventListener('contextmenu', onContext)
        }
    }, [viewer, engine, contextMenu])

    return <div className="me-viewport" ref={ref} data-viewport />
}
