import {describe, expect, test} from 'vitest'
import type {ViewerAction} from 'threepipe'
import {shortcutsSheetGroups} from '../../plugins/tweakpane-editor/src/ShortcutsSheet'

// The rows of the shortcuts sheet of the tweakpane editor: the actions with keys, in groups, and the search

const actions: ViewerAction[] = [
    {id: 'undo', label: 'Undo', shortcut: 'Mod+KeyZ', group: 'Edit', run: () => {}},
    {id: 'picking.delete', label: 'Delete the selection', shortcut: ['Delete', 'Backspace'], group: 'Selection', run: () => {}},
    {id: 'redo', label: 'Redo', shortcut: ['Mod+Shift+KeyZ', 'Mod+KeyY'], group: 'Edit', run: () => {}},
    {id: 'export', label: 'Export', group: 'File', run: () => {}},
    {id: 'upload', label: 'Upload', shortcut: 'Shift+U', run: () => {}},
]
const own = (id: string) => actions.find(a => a.id === id)?.shortcut

describe('shortcutsSheetGroups', () => {
    test('the actions with a key, in the groups in the order of their first action; the labels of the platform', () => {
        expect(shortcutsSheetGroups(actions, own, '', 'Other', false)).toEqual([
            {name: 'Edit', rows: [{id: 'undo', label: 'Undo', keys: ['Ctrl+Z']}, {id: 'redo', label: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y']}]},
            {name: 'Selection', rows: [{id: 'picking.delete', label: 'Delete the selection', keys: ['Delete', 'Backspace']}]},
            {name: 'Other', rows: [{id: 'upload', label: 'Upload', keys: ['Shift+U']}]},
        ])
        expect(shortcutsSheetGroups(actions, own, '', 'Other', true)[0].rows[1].keys).toEqual(['⇧⌘Z', '⌘Y'])
    })

    test('the keys that the app set: another key, and no key (the row goes)', () => {
        const set: Record<string, string | null> = {undo: 'Alt+Z', redo: null}
        const groups = shortcutsSheetGroups(actions, id => id in set ? set[id] ?? undefined : own(id), '', 'Misc', false)
        expect(groups.map(g => [g.name, g.rows.map(r => r.keys.join(' or '))])).toEqual([['Edit', ['Alt+Z']], ['Selection', ['Delete or Backspace']], ['Misc', ['Shift+U']]])
    })

    test('the search: the label, a key or the group, in any case; a group without a match goes', () => {
        const ids = (q: string) => shortcutsSheetGroups(actions, own, q, 'Other', false).flatMap(g => g.rows.map(r => r.id))
        expect(ids('  REDO ')).toEqual(['redo'])
        expect(ids('ctrl+y')).toEqual(['redo'])
        expect(ids('selection')).toEqual(['picking.delete'])
        expect(ids('backspace')).toEqual(['picking.delete'])
        expect(ids('export')).toEqual([])
    })

    test('the search finds the keys by their names also where the labels are symbols (a Mac)', () => {
        const ids = (q: string) => shortcutsSheetGroups(actions, own, q, 'Other', true).flatMap(g => g.rows.map(r => r.id))
        expect(ids('cmd+z')).toEqual(['undo'])
        expect(ids('shift')).toEqual(['redo', 'upload'])
        expect(ids('ctrl+y')).toEqual(['redo'])
    })
})
