/**
 * The cheat sheet (`?`, F1 in the Blender preset, Help > Keyboard Shortcuts): every binding of the
 * active keymap preset, grouped by where it works - everywhere, object mode, edit mode - then by menu
 * category, plus the mouse and trackpad gestures. Generated from `keymap.activePreset.bindings` and
 * the operator / tool registries, so it is never out of date and switches with the preset.
 * Searchable by command name, key, category or description (Figma's Ctrl+Shift+?, Penpot's `?`).
 */

import {useMemo, useState} from 'react'
import {Button, Dialog, DialogBody, DialogFooter, InputGroup} from '@blueprintjs/core'
import {formatCombo} from '@threepipe/plugin-editor-engine'
import type {EditorEngine, KeyBinding} from '@threepipe/plugin-editor-engine'
import {formatShortcut, useEditor, useEngineVersion} from './EditorContext'

interface Row {
    id: string
    label: string
    keys: string[]
    category: string
    description?: string
}

interface Group {
    id: 'all' | 'object' | 'edit' | 'pointer'
    title: string
    rows: Row[]
}

const CATEGORY_ORDER = ['File', 'Edit', 'View', 'Add', 'Tools', 'Object', 'Mesh', 'Select', 'Help']

/** The groups for the active preset; exported for the agent API and tests. */
export function cheatSheetGroups(engine: EditorEngine): Group[] {
    const preset = engine.keymap.activePreset
    const scopes: Group[] = [
        {id: 'all', title: 'Everywhere', rows: []},
        {id: 'object', title: 'Object mode', rows: []},
        {id: 'edit', title: 'Edit mode', rows: []},
    ]
    const byKey = new Map<string, Row>()
    const add = (b: KeyBinding) => {
        const op = b.tool ? undefined : engine.operators.get(b.id)
        const tool = engine.tools.get(b.id)
        const item = op ?? tool
        if (!item) return // a binding for something not registered in this app
        const scope = scopes.find(s => s.id === (b.mode ?? 'all'))!
        const k = scope.id + '|' + b.id
        let row = byKey.get(k)
        if (!row) {
            row = {id: b.id, label: item.label, keys: [], category: op ? op.category ?? 'Other' : 'Tools', description: item.description}
            byKey.set(k, row)
            scope.rows.push(row)
        }
        const text = formatCombo(b.keys)
        if (!row.keys.includes(text)) row.keys.push(text)
    }
    for (const b of preset.bindings) add(b)
    const rank = (c: string) => {
        const i = CATEGORY_ORDER.indexOf(c)
        return i < 0 ? CATEGORY_ORDER.length : i
    }
    for (const s of scopes) s.rows.sort((a, b) => rank(a.category) - rank(b.category))

    // Pointer: what the buttons do in this preset, and the three ways to move the view.
    const nav = preset.navigation
    const pointer: Row[] = [
        {id: 'pointer.select', label: 'Select', keys: ['Click'], category: 'Select'},
        {id: 'pointer.extend', label: 'Add to the selection', keys: ['Shift+Click'], category: 'Select'},
        ...(nav.leftDrag === 'select' ? [{id: 'pointer.box', label: 'Box select', keys: ['Drag on empty space'], category: 'Select'}] : []),
        {id: 'pointer.edit', label: 'Edit an object', keys: ['Double-click'], category: 'Object'},
        {id: 'pointer.menu', label: 'Context menu', keys: ['Right-click'], category: 'Object'},
    ]
    for (const device of ['mouse', 'trackpad'] as const) {
        for (const g of engine.navigation.gestures(device)) {
            pointer.push({
                id: `pointer.${device}.${g.action}`, label: `${g.label} (${device})`,
                keys: [g.gesture, ...g.alternatives.map(a => a.gesture)], category: 'View',
            })
        }
    }
    return [...scopes.filter(s => s.rows.length), {id: 'pointer', title: 'Mouse and trackpad', rows: pointer}]
}

function matches(row: Row, group: Group, words: string[]): boolean {
    const text = `${row.label} ${row.keys.join(' ')} ${row.category} ${group.title} ${row.description ?? ''} ${row.id}`.toLowerCase()
    return words.every(w => text.includes(w))
}

export function CheatSheet({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    const v = useEngineVersion('registryChanged', 'keymapChanged', 'navigationChanged')
    const [query, setQuery] = useState('')
    const groups = useMemo(() => cheatSheetGroups(engine), [engine, v])
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const shown = groups
        .map(g => ({...g, rows: g.rows.filter(r => matches(r, g, words))}))
        .filter(g => g.rows.length)
    const preset = engine.keymap.activePreset
    const other = engine.keymap.presets.find(p => p.id !== preset.id)

    return <Dialog isOpen={isOpen} onClose={onClose} onOpened={() => setQuery('')} title={`Keyboard shortcuts - ${preset.label}`}
        className="me-dialog me-dialog-wide me-cheatsheet" icon="key">
        <DialogBody>
            <InputGroup leftIcon="search" placeholder="Search: a command, a key, a mode… (e.g. extrude, ctrl+z, edit)" autoFocus
                value={query} onChange={e => setQuery(e.target.value)} data-cheatsheet-search className="me-cheatsheet-search" />
            <div className="me-shortcuts" data-cheatsheet>
                {shown.map(g => <section key={g.id} className="me-shortcut-group" data-shortcut-group={g.id}>
                    <h6 className="bp5-heading">{g.title}</h6>
                    {g.rows.map((r, i) => <div key={r.id} className="me-shortcut-row" title={r.description} data-shortcut-row={r.id}>
                        {i === 0 || g.rows[i - 1].category !== r.category ? <span className="me-shortcut-cat">{r.category}</span> : null}
                        <span className="me-shortcut-label">{r.label}</span>
                        <span className="me-shortcut-keys">{r.keys.map(k => <kbd key={k} className="me-kbd">{g.id === 'pointer' ? k : formatShortcut(k)}</kbd>)}</span>
                    </div>)}
                </section>)}
                {shown.length === 0 && <div className="me-empty">Nothing matches "{query}". Every command, with or without a key, is in the command palette
                    {engine.keymap.shortcutFor('ui.command_palette') ? ` (${formatShortcut(engine.keymap.shortcutFor('ui.command_palette'))})` : ''}.</div>}
            </div>
            <div className="me-dialog-note">Generated from the {preset.label} keymap. Every menu entry and toolbar tooltip shows the same keys.</div>
        </DialogBody>
        <DialogFooter actions={<>
            {other && <Button text={`Switch to ${other.label}`} variant="minimal" onClick={() => engine.keymap.setPreset(other.id)} data-cheatsheet-switch />}
            <Button text="Close" onClick={onClose} />
        </>} />
    </Dialog>
}
