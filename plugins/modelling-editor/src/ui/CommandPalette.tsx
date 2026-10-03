/**
 * The command palette (Ctrl/Cmd+K, F3): every operator, searchable by label, id, category and
 * description words, with its shortcut shown. Enter runs it. Operators that cannot run now are
 * listed disabled with the reason, so the user learns what is needed rather than wondering why a
 * command is missing.
 */

import {useMemo} from 'react'
import {MenuItem, Tag} from '@blueprintjs/core'
import {ItemRenderer, Omnibar} from '@blueprintjs/select'
import {useEditor, useEngineVersion, formatShortcut} from './EditorContext'
import type {OperatorDescriptor} from '../registry'

interface PaletteItem {
    op: OperatorDescriptor
    enabled: boolean
    reason?: string
    search: string
}

/** 0 = no match; higher is better: label equals > label starts with > label contains > words anywhere. */
function score(query: string, item: PaletteItem): number {
    const q = query.trim().toLowerCase()
    if (!q) return 1
    const label = item.op.label.toLowerCase()
    if (label === q) return 5
    if (label.startsWith(q)) return 4
    if (label.includes(q)) return 3
    // every word must appear somewhere; "del face" finds Mesh > Delete
    const words = q.split(/\s+/)
    if (words.every(w => label.includes(w))) return 2
    return words.every(w => item.search.includes(w)) ? 1 : 0
}

/** Filter and rank: runnable first, then by match quality, then alphabetically. */
const listPredicate = (query: string, items: PaletteItem[]): PaletteItem[] =>
    items
        .map(item => ({item, s: score(query, item)}))
        .filter(x => x.s > 0)
        .sort((a, b) => Number(b.item.enabled) - Number(a.item.enabled) || b.s - a.s || a.item.op.label.localeCompare(b.item.op.label))
        .map(x => x.item)

const renderItem: ItemRenderer<PaletteItem> = (item, {handleClick, handleFocus, modifiers}) => {
    if (!modifiers.matchesPredicate) return null
    const {op} = item
    return <MenuItem
        key={op.id}
        active={modifiers.active}
        disabled={!item.enabled}
        icon={op.icon as never}
        text={<span className="me-palette-text">
            <span className="me-palette-label">{op.label}</span>
            <span className="me-palette-desc">{item.enabled ? op.description : item.reason ?? op.description}</span>
        </span>}
        labelElement={<span className="me-palette-right">
            {op.category && <Tag minimal>{op.category}</Tag>}
            {op.shortcut && <kbd className="me-kbd">{formatShortcut(op.shortcut)}</kbd>}
        </span>}
        onClick={handleClick}
        onFocus={handleFocus}
        roleStructure="listoption"
    />
}

export function CommandPalette({isOpen, onClose}: {isOpen: boolean, onClose: () => void}) {
    const {engine} = useEditor()
    const v = useEngineVersion('registryChanged', 'modeChanged', 'selectionChanged')
    const items = useMemo<PaletteItem[]>(() => {
        const ctx = engine.context()
        return engine.operators.list()
            .map(op => {
                const p = (engine as any).poll?.(op, ctx) as {enabled: boolean, reason?: string} ?? {enabled: true}
                return {
                    op, enabled: p.enabled, reason: p.reason,
                    search: `${op.label} ${op.id} ${op.category ?? ''} ${op.description ?? ''} ${op.shortcut ?? ''}`.toLowerCase(),
                }
            })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, v, isOpen])

    return <Omnibar<PaletteItem>
        isOpen={isOpen}
        onClose={onClose}
        items={items}
        itemListPredicate={listPredicate}
        itemRenderer={renderItem}
        onItemSelect={item => {
            onClose()
            if (item.enabled) engine.run(item.op.id)
            else (engine as any).message?.('info', item.reason ?? `${item.op.label} is not available right now`)
        }}
        resetOnSelect
        noResults={<MenuItem disabled text="No matching command" />}
        inputProps={{placeholder: 'Type a command… (e.g. extrude, export, frame)', className: 'me-palette-input'}}
        className="me-palette"
        overlayProps={{className: 'me-palette-overlay'}}
    />
}
