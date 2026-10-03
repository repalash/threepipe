/**
 * The shell's own operators: view operators over `EditorViewportPlugin` (grid, projection, axis views,
 * framing, shading) and the Help / palette entries the shell itself serves. Registered into the
 * engine like any other pack, so the keymap, menus, palette and context menus see them.
 */

import type {EditorEngine, OperatorDescriptor} from '@threepipe/plugin-editor-engine'
import type {AxisView, EditorViewportPlugin, ViewportShading} from '../EditorViewportPlugin'

export function registerViewOperators(engine: EditorEngine, vp: EditorViewportPlugin | undefined): () => void {
    const needsViewport = () => !!vp || 'EditorViewportPlugin is not loaded'
    const ui = (request: 'palette' | 'shortcuts' | 'about') => () => { engine.dispatchEvent({type: 'uiRequest', request}); return {ok: true} }

    const ops: OperatorDescriptor[] = [
        {
            id: 'view.frame_all', label: 'Frame All', icon: 'zoom-to-fit', category: 'View',
            description: 'Fit the whole scene in the view.',
            poll: needsViewport,
            async exec() { await vp!.frame(null); return {ok: true} },
        },
        {
            id: 'view.frame_selected', label: 'Frame Selected', icon: 'locate', category: 'View',
            contextMenu: ['object', 'vertex', 'edge', 'face'],
            description: 'Fit the selection in the view.',
            poll: ctx => !!vp && (ctx.selectedObjects.length > 0 || !!ctx.editObject) || 'Select something first',
            async exec(ctx) { await vp!.frame(ctx.editObject ? [ctx.editObject] : ctx.selectedObjects); return {ok: true} },
        },
        {
            id: 'view.toggle_grid', label: 'Toggle Grid', icon: 'grid', category: 'View',
            description: 'Show or hide the ground grid and axes.',
            poll: needsViewport,
            exec: () => { vp!.setGridVisible(!vp!.gridVisible); return {ok: true} },
        },
        {
            id: 'view.toggle_projection', label: 'Perspective / Orthographic', icon: 'camera', category: 'View',
            description: 'Switch between perspective and orthographic projection.',
            poll: needsViewport,
            exec: () => { vp!.toggleOrthographic(); return {ok: true} },
        },
        ...([
            ['front', 'Front'], ['back', 'Back'], ['right', 'Right'], ['left', 'Left'], ['top', 'Top'], ['bottom', 'Bottom'],
        ] as [AxisView, string][]).map(([view, label]): OperatorDescriptor => ({
            id: `view.${view}`, label: `${label} View`, icon: 'cube', category: 'View',
            description: `Look at the scene from the ${label.toLowerCase()}, in orthographic projection.`,
            poll: needsViewport,
            exec: () => { vp!.setAxisView(view); return {ok: true} },
        })),
        ...([
            ['material', 'Material Preview', 'media'],
            ['solid', 'Solid', 'full-circle'],
            ['wireframe', 'Wireframe', 'polygon-filter'],
        ] as [ViewportShading, string, string][]).map(([mode, label, icon]): OperatorDescriptor => ({
            id: `view.shading_${mode}`, label: `Shading: ${label}`, icon, category: 'View',
            description: mode === 'solid' ? 'Flat neutral grey, for judging a silhouette.'
                : mode === 'wireframe' ? 'Edges only.' : 'The real materials and lighting.',
            poll: needsViewport,
            exec: () => { vp!.setShading(mode); return {ok: true} },
        })),
        {
            id: 'ui.command_palette', label: 'Search Commands…', icon: 'search', category: 'Help',
            description: 'Find any command by name.',
            exec: ui('palette'),
        },
        {
            id: 'help.shortcuts', label: 'Keyboard Shortcuts', icon: 'key', category: 'Help',
            description: 'Every command with its key in the active keymap.',
            exec: ui('shortcuts'),
        },
        {
            id: 'help.docs', label: 'Threepipe Documentation', icon: 'manual', category: 'Help',
            description: 'Open the threepipe docs in a new tab.',
            exec: () => { window.open('https://threepipe.org/', '_blank', 'noopener'); return {ok: true} },
        },
        {
            id: 'help.about', label: 'About', icon: 'info-sign', category: 'Help',
            description: 'What this editor is and what is still coming.',
            exec: ui('about'),
        },
    ]
    const disposers = ops.map(op => engine.operators.register(op))
    return () => { for (const d of disposers) d() }
}
