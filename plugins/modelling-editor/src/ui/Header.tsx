/**
 * The header: app menu, Object/Edit mode switch, vertex/edge/face buttons, pivot / orientation /
 * snapping / proportional slots, shading and X-ray toggles.
 *
 * Menus are the engine's menu definitions (Blender's `VIEW3D_MT_*` / `TOPBAR_MT_*`), drawn by
 * {@link MenuView}; nothing here names an operator or a menu.
 * The four popover slots are placeholders: the engine rebuild (P1) provides pivot, orientation,
 * snapping and proportional editing, and their popovers will mount here.
 */

import React from 'react'
import {Button, ButtonGroup, Popover, Tooltip} from '@blueprintjs/core'
import {useEditor, useEngineVersion, formatShortcut} from './EditorContext'
import {IconButton, TooltipContent} from './IconButton'
import type {SelectModeName} from '@threepipe/plugin-editor-engine'
import {MenuView} from './MenuView'
import type {EditorViewportPlugin} from '../EditorViewportPlugin'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'

/**
 * The menu bar: `engine.headerMenus()` for the current mode - File, Edit, then Blender's 3D view header
 * menus (View, Select, Add, Object; or Mesh, Vertex, Edge, Face, UV in edit mode), then Help.
 */
export function AppMenu() {
    const {engine} = useEditor()
    useEngineVersion('registryChanged', 'modeChanged', 'selectModeChanged', 'selectionChanged', 'historyChanged', 'lastOperationChanged', 'keymapChanged', 'fileChanged', 'navigationChanged')
    // Resolved on every engine change above, so poll state and context-dependent rows (Open Recent,
    // Extrude, Merge's At First / At Last) are current while a menu is open.
    const menus = engine.headerMenus()
    return <div className="me-app-menu" role="menubar">
        {menus.map(m => <Popover
            key={m.id}
            placement="bottom-start"
            minimal
            content={<MenuView menu={m} />}
        >
            <Button variant="minimal" size="small" text={m.label} className="me-menu-button" data-menu={m.label} data-menu-id={m.id} />
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
