/**
 * The three start hints, one at a time, each pinned to the thing it is about:
 *
 * 1. "Click to select" - on the first object in the viewport;
 * 2. "Tab or double-click to edit" - on the Edit mode button (the key is the active preset's);
 * 3. "Drag a handle to move" - on the Move tool in the toolbar.
 *
 * Each one disappears once the user has done the thing - selected something, entered edit mode,
 * moved something (a Move/Rotate/Scale step on the history) - whichever order it happens in, or when
 * closed. Only the user's own doing counts: a change is credited when it follows a pointer or key
 * event in the editor, so a script selecting the start cube does not tick off "Click to select".
 * The research's guided first steps (`ux-patterns.md` §7: click to select, Tab/double-click to edit,
 * then move or extrude), cut to the three that make someone productive.
 */

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Button} from '@blueprintjs/core'
import {Box3, IObject3D, Vector3} from 'threepipe'
import {formatShortcut, useEditor, useEngineEvent, useEngineVersion, useOnboarding} from './EditorContext'
import {HINT_ORDER, HintId} from '../onboarding/OnboardingStore'

/** A gizmo or modal transform step, as the engine and mesh-edit label them ("Move", "Rotate Cube"). */
const TRANSFORM_STEP = /^(Move|Rotate|Scale|Resize|Transform)\b/
/** How long after a pointer press or release, or a key, a change still counts as the user's own. */
const USER_INPUT_MS = 1500

interface Placement {
    x: number
    y: number
    side: 'right' | 'bottom'
    /** A point in the viewport rather than a control: draw the pulsing ring. */
    point: boolean
}

export function Hints() {
    const {engine} = useEditor()
    const [store] = useOnboarding()
    useEngineVersion('modeChanged', 'toolChanged', 'keymapChanged', 'sceneChanged')
    const lastInput = useRef(-Infinity)

    // Credit only what follows the user's own input.
    useEffect(() => {
        const note = () => { lastInput.current = performance.now() }
        // A drag can last longer than the window, and its step is recorded on release: note both ends.
        const events = ['pointerdown', 'pointerup', 'keydown'] as const
        for (const t of events) window.addEventListener(t, note, true)
        return () => { for (const t of events) window.removeEventListener(t, note, true) }
    }, [])
    /**
     * Run `check` once the current input event has reached every listener. A key goes through the
     * engine's router (a window capture listener added before this one) synchronously, so the change
     * it causes arrives before this component has seen the key; a zero timeout runs after both.
     */
    const ifByUser = (check: () => void) => {
        if (!store.enabled) return
        setTimeout(() => { if (performance.now() - lastInput.current < USER_INPUT_MS) check() }, 0)
    }

    useEngineEvent('selectionChanged', () => ifByUser(() => {
        if (engine.mode === 'object' && engine.context().selectedObjects.length > 0) store.completeHint('select')
    }))
    useEngineEvent('modeChanged', e => ifByUser(() => {
        if (e.mode !== 'edit') return
        // Entering edit mode needs a selected mesh, so the first hint is done too.
        store.completeHint('select')
        store.completeHint('edit')
    }))
    useEngineEvent('historyChanged', () => ifByUser(() => {
        const top = engine.history.entries()[engine.history.position]
        if (top && TRANSFORM_STEP.test(top.label)) store.completeHint('move')
    }))

    const hint = store.activeHint
    const target = useHintTarget(hint)
    if (!hint || !target) return null

    const n = HINT_ORDER.indexOf(hint) + 1
    const editKey = engine.keymap.shortcutFor('object.enter_edit', 'object')
    const exitKey = engine.keymap.shortcutFor('mesh.exit_edit', 'edit')
    const moveTool = engine.mode === 'edit' ? 'mesh.move' : 'object.move'
    const moveKey = engine.keymap.shortcutFor(moveTool, engine.mode)
    const gizmoTool = !!engine.activeTool && /\.(move|rotate|scale|transform)$/.test(engine.activeTool.id)
    const name = engine.modelObjects()[0]?.name || 'object'

    let title: string
    let body: React.ReactNode
    if (hint === 'select') {
        title = 'Click to select'
        body = <>Click the {name} to select it. Shift+click adds to the selection; a drag on empty space draws a box.</>
    } else if (hint === 'edit') {
        title = `${editKey ? formatShortcut(editKey) + ' or double-click' : 'Double-click'} to edit`
        body = <>With a mesh selected, press {editKey ? <kbd className="me-kbd">{formatShortcut(editKey)}</kbd> : 'Edit'}, double-click it, or use this
            button, to work on its vertices, edges and faces.{exitKey ? <> {formatShortcut(exitKey)} goes back.</> : null}</>
    } else {
        title = 'Drag a handle to move'
        body = gizmoTool
            ? <>Drag one of the gizmo's arrows to move along that axis. Ctrl+Z undoes it.</>
            : <>Pick the Move tool here{moveKey ? <> or press <kbd className="me-kbd">{formatShortcut(moveKey)}</kbd></> : null}, then drag one of the gizmo's arrows.</>
    }

    return <>
        {target.point && <div className="me-hint-ring" style={{left: target.x, top: target.y}} />}
        <div className={`me-coach me-coach-${target.side}`} data-hint={hint} role="status"
            style={target.side === 'right'
                ? {left: target.x + (target.point ? 44 : 12), top: target.y}
                : {left: target.x, top: target.y + 12}}>
            <div className="me-coach-head">
                <span className="me-coach-title">{title}</span>
                <Button variant="minimal" size="small" icon="cross" aria-label="Close hint" data-hint-close
                    onMouseDown={e => e.preventDefault()} onClick={() => store.dismissHint(hint)} />
            </div>
            <div className="me-coach-body">{body}</div>
            <div className="me-coach-foot">
                <span className="me-coach-step">{n} of {HINT_ORDER.length}</span>
                <Button variant="minimal" size="small" text="Skip tips" data-hint-skip
                    onMouseDown={e => e.preventDefault()} onClick={() => store.dismissAllHints()} />
            </div>
        </div>
    </>
}

/** Where the hint points: the object on screen, the Edit button, the Move tool. Tracked every frame. */
function useHintTarget(id: HintId | null): Placement | null {
    const {engine, viewer} = useEditor()
    const [placement, setPlacement] = useState<Placement | null>(null)
    useLayoutEffect(() => {
        if (!id) {
            setPlacement(null)
            return
        }
        let raf = 0
        const box = new Box3()
        const v = new Vector3()
        const measure = (): Placement | null => {
            if (id === 'select') {
                if (engine.mode !== 'object') return null
                const obj = engine.modelObjects().find(o => o.visible) as IObject3D | undefined
                if (!obj) return null
                box.setFromObject(obj)
                if (box.isEmpty()) return null
                box.getCenter(v).project(viewer.scene.mainCamera)
                if (v.z > 1) return null
                const r = viewer.canvas.getBoundingClientRect()
                return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, side: 'right', point: true}
            }
            const selector = id === 'edit'
                ? '[data-mode-button="edit"]'
                : `[data-tool="${engine.mode === 'edit' ? 'mesh.move' : 'object.move'}"]`
            if (id === 'edit' && engine.mode !== 'object') return null
            const el = document.querySelector(selector)
            if (!el) return null
            const r = el.getBoundingClientRect()
            if (!r.width) return null
            return id === 'edit'
                ? {x: r.left + r.width / 2, y: r.bottom, side: 'bottom', point: false}
                : {x: r.right, y: r.top + r.height / 2, side: 'right', point: false}
        }
        const tick = () => {
            const next = measure()
            setPlacement(prev => prev && next && prev.side === next.side && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 ? prev : next)
            raf = requestAnimationFrame(tick)
        }
        tick()
        return () => cancelAnimationFrame(raf)
    }, [id])
    return placement
}
