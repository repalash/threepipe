/**
 * The one history over `JSUndoManager`: labels, change events, `undoTo` (Blender's `ED_undo_pop_op`)
 * and the redo-last round trip on a stack with other steps interleaved.
 */

import {describe, expect, it} from 'vitest'
import {JSUndoManager} from 'threepipe'
import {EditorHistory, labelOf} from '../src/history/EditorHistory'

function make() {
    const um = new JSUndoManager({bindHotKeys: false, limit: 50, debug: false})
    let changes = 0
    const history = new EditorHistory({undoManager: um} as never, () => changes++)
    return {um, history, changes: () => changes}
}

describe('EditorHistory', () => {
    it('labels every step and lists them in order with the undone ones marked', () => {
        const {history} = make()
        const value = {n: 0}
        const step = (label: string, to: number) => {
            const from = value.n
            value.n = to
            history.record({label, undo: () => { value.n = from }, redo: () => { value.n = to }})
        }
        step('Add Cube', 1)
        step('Extrude', 2)
        step('Move', 3)
        history.undo()
        expect(value.n).toBe(2)
        expect(history.entries()).toEqual([
            {label: 'Add Cube', undone: false}, {label: 'Extrude', undone: false}, {label: 'Move', undone: true},
        ])
        expect(history.canRedo()).toBe(true)
    })

    it('fires a change for records, undo and redo', () => {
        const {history, changes} = make()
        history.record({label: 'a', undo() {}, redo() {}})
        history.undo()
        history.redo()
        expect(changes()).toBe(3)
    })

    it('names unlabelled steps pushed by other plugins after the operator that ran', () => {
        const {um, history} = make()
        history.pendingLabel = 'Delete'
        um.record({undo() {}, redo() {}})
        history.pendingLabel = null
        um.record({undo() {}, redo() {}})
        history.labelLastRecorded('Select cube')
        expect(history.entries().map(e => e.label)).toEqual(['Delete', 'Select cube'])
        expect(labelOf({type: 'ThreeViewerUM_set', binding: [{}, 'roughness']})).toBe('Set roughness')
    })

    it('undoTo pops back through later steps, like ED_undo_pop_op searching back', () => {
        const {history} = make()
        const log: string[] = []
        const step = (label: string) => {
            const cmd = {label, undo: () => log.push(`undo ${label}`), redo: () => log.push(`redo ${label}`)}
            history.record(cmd)
            return cmd
        }
        const extrude = step('Extrude')
        step('Select')
        step('Move')
        expect(history.undoTo(extrude)).toBe(3)
        expect(log).toEqual(['undo Move', 'undo Select', 'undo Extrude'])
        // Redo-last re-exec then pushes a new step; the three undone ones are discarded by the push.
        step('Extrude again')
        expect(history.entries().map(e => e.label)).toEqual(['Extrude again'])
        expect(history.undoTo(extrude)).toBe(-1)
    })

    it('restores the manager on dispose', () => {
        const {um, history, changes} = make()
        history.dispose()
        um.record({undo() {}, redo() {}})
        expect(changes()).toBe(0)
    })
})

describe('EditorHistory.noteEvent', () => {
    it('names the record that follows an event in the same tick, and nothing later', async() => {
        const {um, history} = make()
        history.noteEvent('Select cube')
        um.record({undo() {}, redo() {}})
        await Promise.resolve()
        um.record({undo() {}, redo() {}})
        expect(history.entries().map(e => e.label)).toEqual(['Select cube', 'Action'])
    })
})
