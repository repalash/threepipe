/**
 * Resizable pane layout: left toolbar | centre (viewport over an optional bottom pane) | right pane
 * split vertically into outliner and properties.
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/components/WindowPanesLayout.tsx`
 * (react-resizable-panels, persisted sizes, collapsible side panes, `Shift+Space` to hide everything).
 * The slots are React nodes rather than tab lists; the viewport overlays are rendered by the caller.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react'
import {ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {PanelFlap} from './IconButton'

export interface WindowPanesLayoutProps {
    left: React.ReactNode
    center: React.ReactNode
    /** Rendered inside the centre pane, over the viewport (absolute children). */
    centerOverlay?: React.ReactNode
    rightTop: React.ReactNode
    rightBottom: React.ReactNode
    bottom?: React.ReactNode
    storageKey?: string
}

export function WindowPanesLayout({left, center, centerOverlay, rightTop, rightBottom, bottom, storageKey = 'meEditor'}: WindowPanesLayoutProps) {
    const rightRef = useRef<ImperativePanelHandle>(null)
    const bottomRef = useRef<ImperativePanelHandle>(null)
    const [, forceUpdate] = useState(0)
    const triggerUpdate = useCallback(() => forceUpdate(v => v + 1), [])
    const [isExpanded, setIsExpanded] = useState(false)

    const toggle = (ref: React.RefObject<ImperativePanelHandle | null>) => {
        const p = ref.current
        if (!p) return
        if (p.isCollapsed()) p.expand()
        else p.collapse()
    }

    const toggleExpand = useCallback(() => {
        if (isExpanded) {
            rightRef.current?.expand()
            bottomRef.current?.expand()
        } else {
            rightRef.current?.collapse()
            bottomRef.current?.collapse()
        }
        setIsExpanded(!isExpanded)
    }, [isExpanded])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
            if (event.shiftKey && event.code === 'Space') {
                event.preventDefault()
                toggleExpand()
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [toggleExpand])

    return <PanelGroup className="me-panes" direction="horizontal" autoSaveId={storageKey + 'Root'}>
        <div className="me-toolbar-pane">{left}</div>
        <Panel id="center-panel" order={0} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId={storageKey + 'Center'}>
                <Panel id="center-top-panel" order={0} className="me-center-pane">
                    {center}
                    {centerOverlay}
                    <PanelFlap isCollapsed={rightRef.current?.isCollapsed() ?? false} onClick={() => toggle(rightRef)} position="right" />
                    {bottom && <PanelFlap isCollapsed={bottomRef.current?.isCollapsed() ?? false} onClick={() => toggle(bottomRef)} position="bottom" />}
                </Panel>
                {bottom && <>
                    <PanelResizeHandle className="me-separator" />
                    <Panel ref={bottomRef} defaultSize={25} collapsible minSize={10} maxSize={60} id="center-bottom-panel" order={1}
                        onCollapse={triggerUpdate} onExpand={triggerUpdate} className="me-bottom-pane">
                        {bottom}
                    </Panel>
                </>}
            </PanelGroup>
        </Panel>
        <PanelResizeHandle className="me-separator" />
        <Panel ref={rightRef} defaultSize={22} collapsible minSize={14} maxSize={50} id="right-panel" order={1}
            onCollapse={triggerUpdate} onExpand={triggerUpdate} className="me-right-pane">
            <PanelGroup direction="vertical" autoSaveId={storageKey + 'Right'}>
                <Panel id="right-top-panel" order={0} defaultSize={35} minSize={10} className="me-outliner-pane">{rightTop}</Panel>
                <PanelResizeHandle className="me-separator" />
                <Panel id="right-bottom-panel" order={1} minSize={15} className="me-properties-pane">{rightBottom}</Panel>
            </PanelGroup>
        </Panel>
    </PanelGroup>
}
