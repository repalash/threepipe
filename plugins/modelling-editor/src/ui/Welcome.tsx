/**
 * The first-run welcome, two short steps, skippable at each:
 *
 * 1. "Have you used Blender?" - the answer picks the keymap preset (Blender, or Design for someone
 *    who knows Figma / Photoshop or nothing yet). Blender's own first run asks the same thing in its
 *    splash Quick Setup (keymap: Blender / Industry Compatible).
 * 2. "How to move around" - three cards, orbit / pan / zoom, drawn and worded from the engine's
 *    `navigation.gestures()` for the chosen preset and pointing device, so they cannot disagree with
 *    the controls. The device is detected (mouse or trackpad) and can be switched here.
 *
 * Opens by itself until finished or skipped once (remembered by the onboarding store); Help > Welcome
 * opens it again.
 */

import {useEffect, useState} from 'react'
import {Button, Classes, Dialog, DialogBody, DialogFooter, SegmentedControl} from '@blueprintjs/core'
import type {PointingDevice} from '@threepipe/plugin-editor-engine'
import {formatShortcut, useEditor, useEngineVersion} from './EditorContext'
import {GestureIcon} from './GestureIcon'

/** The answers; what each one sets up is the preset's own description. */
const PRESET_CHOICES = [
    {preset: 'blender', title: 'Yes, I have used Blender'},
    {preset: 'design', title: 'No, or I know Figma / Photoshop better'},
] as const

export function Welcome({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    useEngineVersion('keymapChanged', 'navigationChanged')
    const [step, setStep] = useState<1 | 2>(1)
    useEffect(() => { if (isOpen) setStep(1) }, [isOpen])

    const preset = engine.keymap.activePreset
    const nav = engine.navigation
    const device = nav.device
    const gestures = nav.gestures(device)
    const frameKey = engine.keymap.shortcutFor('view.frame_all')
    const helpKey = engine.keymap.shortcutFor('help.shortcuts')
    const undoKey = engine.keymap.shortcutFor('edit.undo')
    const editKey = engine.keymap.shortcutFor('object.enter_edit', 'object')

    const choose = (id: string) => {
        if (engine.keymap.activePreset.id !== id) engine.keymap.setPreset(id)
        setStep(2)
    }

    return <Dialog isOpen={isOpen} onClose={onClose} className="me-dialog me-welcome"
        title={step === 1 ? 'Welcome' : 'How to move around'} icon={step === 1 ? 'hand' : 'move'} canOutsideClickClose={false}>
        <DialogBody><div data-welcome={step}>
            {step === 1 && <>
                <p className="me-welcome-lead">Build and edit 3D models in the browser. One question to set up the keys:</p>
                <h4 className={Classes.HEADING}>Have you used Blender?</h4>
                <div className="me-welcome-choices">
                    {PRESET_CHOICES.filter(c => engine.keymap.presets.some(p => p.id === c.preset)).map(c => <button key={c.preset} type="button" data-preset-choice={c.preset}
                        className={'me-welcome-choice' + (preset.id === c.preset ? ' me-current' : '')}
                        onClick={() => choose(c.preset)}>
                        <span className="me-welcome-choice-title">{c.title}</span>
                        <span className="me-welcome-choice-sub">{engine.keymap.presets.find(p => p.id === c.preset)!.description}</span>
                    </button>)}
                </div>
                <div className="me-dialog-note">You can switch any time: Edit &gt; Keymap.</div>
            </>}
            {step === 2 && <>
                <div className="me-welcome-device">
                    <span>I'm using a</span>
                    <SegmentedControl size="small" value={device} data-device-choice
                        options={[{label: 'Mouse', value: 'mouse'}, {label: 'Trackpad', value: 'trackpad'}]}
                        onValueChange={v => nav.setDevice(v as PointingDevice)} />
                    {nav.deviceSource !== 'chosen' && <span className="me-welcome-device-source">
                        {nav.deviceSource === 'detected' ? 'detected' : 'best guess'}
                    </span>}
                </div>
                <div className="me-gesture-cards" data-gesture-cards={device}>
                    {gestures.map(g => <div key={g.action} className="me-gesture-card" data-gesture-card={g.action}>
                        <GestureIcon kind={g.kind} />
                        <div className="me-gesture-card-label">{g.label}</div>
                        <div className="me-gesture-card-text">{g.gesture}</div>
                        {g.alternatives.length > 0 && <div className="me-gesture-card-alt">or {g.alternatives.map(a => a.gesture).join(', or ')}</div>}
                    </div>)}
                </div>
                <ul className="me-welcome-tips">
                    <li>Click to select, then {editKey ? <><kbd className="me-kbd">{formatShortcut(editKey)}</kbd> or </> : null}double-click to edit its vertices, edges and faces.</li>
                    {frameKey && <li>Lost? <kbd className="me-kbd">{formatShortcut(frameKey)}</kbd> frames everything.</li>}
                    {helpKey && <li><kbd className="me-kbd">{formatShortcut(helpKey)}</kbd> lists every shortcut.{undoKey ? <> <kbd className="me-kbd">{formatShortcut(undoKey)}</kbd> undoes anything.</> : null}</li>}
                </ul>
            </>}
        </div></DialogBody>
        <DialogFooter actions={step === 1
            ? <Button text="Skip" variant="minimal" onClick={onClose} data-welcome-skip />
            : <>
                <Button text="Back" variant="minimal" onClick={() => setStep(1)} />
                <Button text="Start modelling" intent="primary" onClick={onClose} data-welcome-done />
            </>} />
    </Dialog>
}
