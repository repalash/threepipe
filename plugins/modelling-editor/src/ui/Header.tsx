/**
 * The header: app menu, Object/Edit mode switch, vertex/edge/face buttons, pivot / orientation /
 * snapping / proportional slots, shading and X-ray toggles.
 *
 * Menus render from the operator registry grouped by `category`; nothing here names an operator.
 * The four popover slots are placeholders: the engine rebuild (P1) provides pivot, orientation,
 * snapping and proportional editing, and their popovers will mount here.
 */

import React from 'react'
import {Button, ButtonGroup, Menu, MenuDivider, MenuItem, Popover, Tooltip} from '@blueprintjs/core'
import {useEditor, useEngineVersion, formatShortcut} from './EditorContext'
import {IconButton, TooltipContent} from './IconButton'
import type {EditorContext, OperatorDescriptor, SelectModeName} from '@threepipe/plugin-editor-engine'
import type {EditorViewportPlugin} from '../EditorViewportPlugin'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'

const MENU_ORDER = ['File', 'Edit', 'Add', 'Object', 'Mesh', 'Select', 'View', 'Help']

function MenuForCategory({category, ops, ctx}: {category: string, ops: OperatorDescriptor[], ctx: EditorContext}) {
    const {engine} = useEditor()
    const polled = (op: OperatorDescriptor) => engine.poll(op, ctx)
    const mode = ctx.mode
    const inMode = ops.filter(op => (!op.modes || op.modes.includes(mode)) && !op.hidden)
    const other = ops.filter(op => op.modes && !op.modes.includes(mode) && !op.hidden)
    const item = (op: OperatorDescriptor) => {
        const p = polled(op)
        return <MenuItem
            key={op.id}
            text={op.label}
            icon={op.icon as never}
            label={formatShortcut(op.shortcut)}
            disabled={!p.enabled}
            title={p.enabled ? op.description : p.reason ?? op.description}
            onClick={() => engine.run(op.id)}
        />
    }
    return <Menu className="me-menu">
        {inMode.flatMap(op => op.id === 'file.open' ? [item(op), <RecentFilesMenu key="recent" />] : [item(op)])}
        {other.length ? <MenuDivider title={`${other[0].modes![0] === 'edit' ? 'Edit' : 'Object'} mode`} /> : null}
        {other.map(item)}
        {category === 'Help' ? <><MenuDivider /><MenuItem text="Version" disabled label="shell 0.1.0" /></> : null}
        {category === 'Edit' ? <><MenuDivider /><MenuItem text="Keymap" disabled label={engine.keymap.activePreset.label} /></> : null}
    </Menu>
}

/** File > Open Recent: names only (a page cannot re-open a file by itself, so an entry opens the picker). */
function RecentFilesMenu() {
    const {engine} = useEditor()
    const recent = engine.file.recent
    const when = (t: number) => {
        const d = new Date(t)
        return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : d.toLocaleDateString()
    }
    const size = (n: number) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
    return <MenuItem text="Open Recent" icon="history" disabled={!recent.length} data-recent-menu
        title={recent.length ? 'Files opened here before. The browser asks you to pick the file again.' : 'No files opened yet: File > Open, or drop one onto the viewport.'}>
        {recent.map(r => <MenuItem key={r.name} text={r.name} label={`${size(r.size)} · ${when(r.openedAt)}`} data-recent-file={r.name}
            onClick={() => engine.run('file.open_recent', {name: r.name})} />)}
        <MenuDivider />
        <MenuItem text="Clear Recent List" icon="trash" onClick={() => engine.file.clearRecent()} />
    </MenuItem>
}

export function AppMenu() {
    const {engine} = useEditor()
    useEngineVersion('registryChanged', 'modeChanged', 'selectionChanged', 'historyChanged', 'lastOperationChanged', 'keymapChanged', 'fileChanged', 'navigationChanged')
    const ctx = engine.context()
    const byCategory = new Map<string, OperatorDescriptor[]>()
    for (const op of engine.operators.list()) {
        const c = op.category ?? 'Other'
        if (!byCategory.has(c)) byCategory.set(c, [])
        byCategory.get(c)!.push(op)
    }
    const categories = [...MENU_ORDER.filter(c => byCategory.has(c)), ...[...byCategory.keys()].filter(c => !MENU_ORDER.includes(c))]
    return <div className="me-app-menu" role="menubar">
        {categories.map(c => <Popover
            key={c}
            placement="bottom-start"
            minimal
            content={<MenuForCategory category={c} ops={byCategory.get(c)!} ctx={ctx} />}
        >
            <Button variant="minimal" size="small" text={c} className="me-menu-button" data-menu={c} />
        </Popover>)}
    </div>
}

export function ModeSwitch() {
    const {engine} = useEditor()
    useEngineVersion('modeChanged', 'selectionChanged')
    const mode = engine.mode
    useEngineVersion('keymapChanged')
    const canEdit = engine.context().selectedObjects.some(o => !!o.geometry)
    const toEdit = engine.keymap.shortcutFor('object.enter_edit', 'object')
    const toObject = engine.keymap.shortcutFor('mesh.exit_edit', 'edit')
    return <ButtonGroup className="me-mode-switch" data-mode={mode}>
        <Tooltip content={<TooltipContent label="Object Mode" shortcut={toObject} description="Place, move and arrange whole objects." />} compact hoverOpenDelay={350}>
            <Button size="small" icon="cube" text="Object" active={mode === 'object'} data-mode-button="object"
                onMouseDown={e => e.preventDefault()}
                onClick={() => engine.setMode('object')} />
        </Tooltip>
        <Tooltip content={<TooltipContent label="Edit Mode" shortcut={toEdit} description="Edit the selected mesh's vertices, edges and faces. Double-clicking a mesh does it too." reason={mode === 'object' && !canEdit ? 'Click a mesh in the viewport or the outliner to select it first' : undefined} />} compact hoverOpenDelay={350}>
            <Button size="small" icon="edit" text="Edit" active={mode === 'edit'} data-mode-button="edit"
                disabled={mode === 'object' && !canEdit}
                onMouseDown={e => e.preventDefault()}
                onClick={() => engine.setMode('edit')} />
        </Tooltip>
    </ButtonGroup>
}

const SELECT_MODES: {id: SelectModeName, label: string, icon: string, description: string}[] = [
    {id: 'vertex', label: 'Vertex select', icon: 'dot', description: 'Click vertices.'},
    {id: 'edge', label: 'Edge select', icon: 'minus', description: 'Click edges.'},
    {id: 'face', label: 'Face select', icon: 'square', description: 'Click faces.'},
]

export function SelectModeButtons() {
    const {engine} = useEditor()
    useEngineVersion('modeChanged', 'selectModeChanged', 'keymapChanged')
    if (engine.mode !== 'edit') return null
    const current = engine.selectMode
    return <ButtonGroup className="me-select-modes">
        {SELECT_MODES.map(m => <IconButton
            key={m.id}
            icon={m.icon as never}
            size="small"
            active={current === m.id}
            label={m.label} shortcut={engine.keymap.shortcutFor(`mesh.select_mode_${m.id}`, 'edit')} description={m.description}
            data-select-mode={m.id}
            onClick={() => engine.setSelectMode(m.id)}
        />)}
    </ButtonGroup>
}

function SlotPopover({icon, label, description, children}: {icon: string, label: string, description: string, children?: React.ReactNode}) {
    return <Popover placement="bottom" minimal content={<div className="me-slot-popover">
        <div className="me-slot-title">{label}</div>
        {children ?? <div className="me-slot-pending">Arrives with the interaction engine (P1). The shell slot is ready.</div>}
    </div>}>
        <IconButton icon={icon as never} size="small" label={label} description={description} data-slot={label} />
    </Popover>
}

export function HeaderSlots() {
    const {engine} = useEditor()
    useEngineVersion('modeChanged', 'statusChanged', 'keymapChanged')
    const vp = engine.viewer.getPlugin('EditorViewportPlugin' as never) as EditorViewportPlugin | undefined
    const meshEdit = engine.viewer.getPlugin(MeshEditPlugin)
    const shading = vp?.shading ?? 'material'
    return <div className="me-header-slots">
        <SlotPopover icon="locate" label="Pivot point" description="Where rotation and scaling happen: median, active, individual, cursor." />
        <SlotPopover icon="globe" label="Transform orientation" description="Global, local or normal axes." />
        <SlotPopover icon="pin" label="Snapping" description="Snap to increments, vertices, edges or faces." />
        <SlotPopover icon="circle" label="Proportional editing" description="Move nearby elements with a falloff." />
        <span className="me-header-divider" />
        <ButtonGroup className="me-shading">
            {([['material', 'media', 'Material preview', 'Real materials and lighting.'],
                ['solid', 'full-circle', 'Solid', 'Flat grey, for judging shape.'],
                ['wireframe', 'polygon-filter', 'Wireframe', 'Edges only.']] as const).map(([mode, icon, label, desc]) =>
                <IconButton key={mode} icon={icon} size="small" active={shading === mode} label={label} description={desc}
                    reason={vp ? undefined : 'EditorViewportPlugin is not loaded'}
                    data-shading={mode}
                    onClick={() => engine.run(`view.shading_${mode}`)} />)}
        </ButtonGroup>
        <IconButton icon="eye-open" size="small" active={!!meshEdit?.xray} label="X-Ray" shortcut={engine.keymap.shortcutFor('mesh.toggle_xray', 'edit')}
            description="See and select through the mesh (edit mode)."
            reason={engine.mode === 'edit' ? undefined : `Only in Edit mode: select a mesh and press ${engine.keymap.shortcutFor('object.enter_edit', 'object') ?? 'Edit'}`}
            data-xray
            onClick={() => engine.run('mesh.toggle_xray')} />
        <IconButton icon="grid" size="small" active={!!vp?.gridVisible} label="Grid" description="Show the ground grid and axes."
            reason={vp ? undefined : 'EditorViewportPlugin is not loaded'}
            data-grid
            onClick={() => engine.run('view.toggle_grid')} />
        <IconButton icon="camera" size="small" active={!!vp?.isOrthographic} label="Orthographic" shortcut={engine.keymap.shortcutFor('view.toggle_projection')} description="Toggle perspective / orthographic projection."
            reason={vp ? undefined : 'EditorViewportPlugin is not loaded'}
            onClick={() => engine.run('view.toggle_projection')} />
    </div>
}

/** The document's name and an unsaved-changes dot, as a desktop app's title bar shows them. */
export function DocumentName() {
    const {engine} = useEditor()
    useEngineVersion('fileChanged')
    const {name, dirty} = engine.file
    const saveKey = engine.keymap.shortcutFor('file.save')
    return <span className="me-doc-name" data-file-name={name ?? ''} data-dirty={dirty}
        title={dirty ? `Unsaved changes. File > Save${saveKey ? ` (${formatShortcut(saveKey)})` : ''} downloads a .glb that re-opens editable.` : 'Saved'}>
        {name ?? 'Untitled'}{dirty ? <span className="me-doc-dirty" aria-label="unsaved changes"> •</span> : null}
    </span>
}

export function Header({title}: {title?: string}) {
    return <header className="me-header">
        <div className="me-brand" title="threepipe modelling editor">
            <span className="me-brand-mark" />
            <span className="me-brand-text">{title ?? 'threepipe'}</span>
        </div>
        <AppMenu />
        <span className="me-header-divider" />
        <DocumentName />
        <span className="me-header-divider" />
        <ModeSwitch />
        <SelectModeButtons />
        <span className="me-spacer" />
        <HeaderSlots />
    </header>
}
