/**
 * View operators over `EditorViewportPlugin` (grid, projection, axis views, framing, shading) and
 * the Help / palette entries the shell itself serves.
 */

import type {LegacyEditorEngine} from '../legacyEngine'
import type {OperatorDescriptor} from '../../registry'
import type {AxisView, ViewportShading} from '../../EditorViewportPlugin'

export function registerViewOperators(engine: LegacyEditorEngine): void {
    const vp = engine.viewport
    const needsViewport = () => !!vp || 'EditorViewportPlugin is not loaded'
    const ui = (request: string) => () => { engine.dispatchEvent({type: 'uiRequest', request} as never); return {ok: true} }

    const ops: OperatorDescriptor[] = [
        {
            id: 'view.frame_all', label: 'Frame All', icon: 'zoom-to-fit', shortcut: 'Home', category: 'View',
            description: 'Fit the whole scene in the view.',
            poll: needsViewport,
            async exec() { await vp!.frame(null); return {ok: true} },
        },
        {
            id: 'view.frame_selected', label: 'Frame Selected', icon: 'locate', shortcut: 'F', category: 'View',
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
            id: 'view.toggle_projection', label: 'Perspective / Orthographic', icon: 'camera', shortcut: 'Numpad 5', category: 'View',
            description: 'Switch between perspective and orthographic projection.',
            poll: needsViewport,
            exec: () => { vp!.toggleOrthographic(); return {ok: true} },
        },
        ...([
            ['front', 'Front', 'Numpad 1'], ['back', 'Back', 'Ctrl+Numpad 1'],
            ['right', 'Right', 'Numpad 3'], ['left', 'Left', 'Ctrl+Numpad 3'],
            ['top', 'Top', 'Numpad 7'], ['bottom', 'Bottom', 'Ctrl+Numpad 7'],
        ] as [AxisView, string, string][]).map(([view, label, shortcut]): OperatorDescriptor => ({
            id: `view.${view}`, label: `${label} View`, icon: 'cube', shortcut, category: 'View',
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
            id: 'ui.command_palette', label: 'Search Commands…', icon: 'search', shortcut: 'Ctrl+K', category: 'Help',
            description: 'Find any command by name.',
            exec: ui('palette'),
        },
        {
            id: 'help.shortcuts', label: 'Keyboard Shortcuts', icon: 'key', category: 'Help',
            description: 'Every command with its key.',
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
    for (const op of ops) engine.operators.register(op)
}
