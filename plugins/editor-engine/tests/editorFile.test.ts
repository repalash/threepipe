/**
 * The document's name, unsaved-changes flag and recent-files list (`EditorFile`).
 */

import {beforeEach, describe, expect, it} from 'vitest'
import {JSUndoManager} from 'threepipe'
import {EditorHistory} from '../src/history/EditorHistory'
import {baseName, EditorFile, RECENT_FILES_MAX} from '../src/files/EditorFile'

// A Map-backed localStorage; the root setup has none in Node.
const store = new Map<string, string>()
beforeEach(() => {
    store.clear()
    ;(globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)) },
        removeItem: (k: string) => { store.delete(k) },
    }
})

function make(key: string | null = 'test-recent') {
    const um = new JSUndoManager({bindHotKeys: false, limit: 50, debug: false})
    const history = new EditorHistory({undoManager: um} as never, () => {})
    let changes = 0
    const file = new EditorFile(history, key, () => changes++)
    const step = (label: string) => history.record({label, undo() {}, redo() {}})
    return {um, history, file, step, changes: () => changes}
}

describe('EditorFile dirty flag', () => {
    it('is clean after markClean and dirty after any new step', () => {
        const {file, step} = make()
        step('Add Cube')
        expect(file.dirty).toBe(true)
        file.markClean()
        expect(file.dirty).toBe(false)
        step('Extrude')
        expect(file.dirty).toBe(true)
    })

    it('undo then redo back to the saved step is clean again; undo then a new step is not', () => {
        const {file, step, history} = make()
        step('Add Cube')
        step('Extrude')
        file.markClean()
        history.undo()
        expect(file.dirty).toBe(true)
        history.redo()
        expect(file.dirty).toBe(false)
        // Same stack position as the save, but a different step: Blender clears `file_saved` on every push.
        history.undo()
        step('Inset')
        expect(history.position).toBe(1)
        expect(file.dirty).toBe(true)
    })
})

describe('EditorFile names and recent files', () => {
    it('strips .glb from the name and reports changes', () => {
        const {file, changes} = make()
        file.setName('chair.glb')
        expect(file.name).toBe('chair')
        file.setName('chair')
        expect(changes()).toBe(1)
        expect(baseName('models/chair.v2.glb')).toBe('chair.v2')
    })

    it('keeps metadata only, newest first, de-duplicated, capped, persisted', () => {
        const {file} = make()
        for (let i = 0; i < RECENT_FILES_MAX + 2; i++) file.addRecent({name: `f${i}.glb`, size: i, lastModified: 1000 + i})
        file.addRecent({name: 'f5.glb', size: 5, lastModified: 1005})
        expect(file.recent.length).toBe(RECENT_FILES_MAX)
        expect(file.recent[0].name).toBe('f5.glb')
        expect(file.recent.filter(r => r.name === 'f5.glb').length).toBe(1)
        expect(Object.keys(file.recent[0]).sort()).toEqual(['lastModified', 'name', 'openedAt', 'size'])
        // A new EditorFile on the same key reads the list back.
        const again = make()
        expect(again.file.recent.map(r => r.name)).toEqual(file.recent.map(r => r.name))
        again.file.clearRecent()
        expect(make().file.recent).toEqual([])
    })

    it('keeps nothing when persistence is off', () => {
        const {file} = make(null)
        file.addRecent({name: 'a.glb'})
        expect(store.size).toBe(0)
        expect(file.recent.length).toBe(1)
    })
})
