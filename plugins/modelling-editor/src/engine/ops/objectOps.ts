/**
 * Object-mode operators over `PickingPlugin`, `UndoManagerPlugin` and the scene, plus the Edit
 * menu (undo / redo / history) and the Add menu.
 *
 * Primitives go through `ModellingPlugin`'s `primitive` command when it is loaded, so a cube is six
 * quads and stays editable by index (plan P0.7); otherwise through the geometry generators.
 */

import {GeometryGeneratorPlugin, IObject3D, Object3DGeneratorPlugin} from 'threepipe'
import type {LegacyEditorEngine} from '../legacyEngine'
import type {EditorContext, OperatorDescriptor, PropSchema} from '../../registry'

const PRIMITIVES: {type: string, label: string, icon: string, generator: string, defaults: Record<string, unknown>}[] = [
    {type: 'cube', label: 'Cube', icon: 'cube', generator: 'geometry-box', defaults: {size: 1}},
    {type: 'plane', label: 'Plane', icon: 'square', generator: 'geometry-plane', defaults: {size: 2}},
    {type: 'circle', label: 'Circle', icon: 'circle', generator: 'geometry-circle', defaults: {radius: 0.5, segments: 32}},
    {type: 'sphere', label: 'UV Sphere', icon: 'globe', generator: 'geometry-sphere', defaults: {radius: 0.5, segments: 32, rings: 16}},
    {type: 'icosphere', label: 'Ico Sphere', icon: 'polygon-filter', generator: 'geometry-sphere', defaults: {radius: 0.5, subdivisions: 2}},
    {type: 'cylinder', label: 'Cylinder', icon: 'database', generator: 'geometry-cylinder', defaults: {radius: 0.5, height: 1, segments: 32}},
    {type: 'cone', label: 'Cone', icon: 'symbol-triangle-up', generator: 'geometry-cylinder', defaults: {radius: 0.5, height: 1, segments: 32}},
    {type: 'torus', label: 'Torus', icon: 'ring', generator: 'geometry-torus', defaults: {radius: 0.5, tubeRadius: 0.15, segments: 32, tubeSegments: 12}},
    {type: 'grid', label: 'Grid', icon: 'grid', generator: 'geometry-plane', defaults: {size: 2, xSegments: 10, ySegments: 10}},
]

const PRIMITIVE_PROPS: Record<string, string[]> = {
    cube: ['size', 'width', 'height', 'depth'],
    plane: ['size', 'width', 'height'],
    circle: ['radius', 'segments', 'capEnds'],
    sphere: ['radius', 'segments', 'rings'],
    icosphere: ['radius', 'subdivisions'],
    cylinder: ['radius', 'height', 'segments', 'capEnds'],
    cone: ['radius', 'height', 'segments', 'capEnds'],
    torus: ['radius', 'tubeRadius', 'segments', 'tubeSegments'],
    grid: ['size', 'xSegments', 'ySegments'],
}

function selected(ctx: EditorContext): IObject3D[] {
    return ctx.selectedObjects
}

export function registerObjectOperators(engine: LegacyEditorEngine): void {
    const viewer = engine.viewer
    const picking = engine.picking
    const needsSelection = (ctx: EditorContext) => selected(ctx).length > 0 || 'Select an object first'

    const ops: OperatorDescriptor[] = [
        // --- Edit ---------------------------------------------------------------------------
        {
            id: 'edit.undo', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', category: 'Edit',
            description: 'Undo the last action.',
            poll: () => engine.history.canUndo() || 'Nothing to undo',
            exec: () => { engine.history.undo(); return {ok: true} },
        },
        {
            id: 'edit.redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Shift+Z', category: 'Edit',
            description: 'Redo the last undone action.',
            poll: () => engine.history.canRedo() || 'Nothing to redo',
            exec: () => { engine.history.redo(); return {ok: true} },
        },
        {
            id: 'edit.history', label: 'Undo History…', icon: 'history', category: 'Edit',
            description: 'Show the list of actions that can be undone.',
            exec: () => { engine.dispatchEvent({type: 'uiRequest', request: 'history'} as never); return {ok: true} },
        },
        {
            id: 'edit.repeat_last', label: 'Adjust Last Operation', icon: 'settings', shortcut: 'F9', category: 'Edit',
            description: 'Open the panel for the last operation\'s parameters.',
            poll: () => !!engine.lastOperation || 'No operation to adjust',
            exec: () => { engine.dispatchEvent({type: 'uiRequest', request: 'operatorPanel'} as never); return {ok: true} },
        },
        {
            id: 'edit.rename', label: 'Rename', icon: 'edit', shortcut: 'F2', category: 'Edit', modes: ['object'],
            contextMenu: ['object'],
            description: 'Rename the active object.',
            poll: needsSelection,
            async exec(ctx) {
                const obj = selected(ctx)[0]
                const name = await viewer.dialog.prompt('Object name', obj.name, true)
                if (name === null || name === obj.name) return {ok: true}
                const old = obj.name
                const apply = (n: string) => { obj.name = n; obj.setDirty?.({change: 'name'} as never) }
                apply(name)
                engine.record({label: `Rename to ${name}`, undo: () => apply(old), redo: () => apply(name)})
                return {ok: true}
            },
        },
        // --- Add ----------------------------------------------------------------------------
        ...PRIMITIVES.map((p): OperatorDescriptor => ({
            id: `add.${p.type}`,
            label: p.label,
            icon: p.icon,
            category: 'Add',
            modes: ['object'],
            description: `Add a ${p.label.toLowerCase()} at the origin.`,
            flags: {undo: true, register: true},
            props: engine.modelling ? primitiveSchema(engine, p.type) : undefined,
            async exec(_ctx, props) {
                const params = {...p.defaults, ...props}
                if (engine.modelling) {
                    const result = await engine.modelling.run({op: 'primitive', type: p.type, ...params})
                    if (!result.ok) return {ok: false, error: result.error}
                    const name = result.objects?.[0]
                    const entry = name ? engine.modelling.document.find(name) : undefined
                    // Selecting the new object is part of this operator, not an undo step of its own.
                    if (entry) picking.setSelectedObject(entry.object, false, false)
                    const op = engine.operators.get(`add.${p.type}`)!
                    engine.setLastOperation({
                        operator: op,
                        props: params,
                        redo: async newProps => {
                            // Blender's ED_undo_operator_repeat: pop the last step, run again with new props.
                            if (engine.canPopLastModellingEntry()) engine.history.undo()
                            return engine.run(op.id, newProps)
                        },
                    })
                    return {ok: true, warnings: result.warnings, data: result.data}
                }
                const gen = viewer.getPlugin(Object3DGeneratorPlugin)
                if (!gen) return {ok: false, error: 'Neither ModellingPlugin nor Object3DGeneratorPlugin is loaded.'}
                viewer.getOrAddPluginSync(GeometryGeneratorPlugin)
                const obj = gen.generate(p.generator, {})
                if (!obj) return {ok: false, error: `No generator for ${p.generator}`}
                obj.name = p.label
                picking.setSelectedObject(obj, false, false)
                engine.setLastOperation({operator: engine.operators.get(`add.${p.type}`)!, props: {}})
                return {ok: true}
            },
        })),
        // --- Object -------------------------------------------------------------------------
        {
            id: 'object.enter_edit', label: 'Edit Mode', icon: 'edit', shortcut: 'Tab', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Edit the selected mesh\'s vertices, edges and faces.',
            poll: ctx => selected(ctx).some(o => !!o.geometry) || 'Select a mesh first',
            exec: () => ({ok: engine.setMode('edit')}),
        },
        {
            id: 'object.select_all', label: 'Select All', icon: 'select', shortcut: 'A', category: 'Select', modes: ['object'],
            description: 'Select every object in the scene.',
            exec: () => { picking.selectAll(); return {ok: true} },
        },
        {
            id: 'object.select_none', label: 'Select None', icon: 'disable', shortcut: 'Alt+A', category: 'Select', modes: ['object'],
            description: 'Deselect everything.',
            poll: needsSelection,
            exec: () => { picking.clearSelection(); return {ok: true} },
        },
        {
            id: 'object.delete', label: 'Delete', icon: 'trash', shortcut: 'X', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Delete the selected objects.',
            flags: {undo: true},
            poll: needsSelection,
            async exec() { await picking.deleteSelected(); return {ok: true} },
        },
        {
            id: 'object.duplicate', label: 'Duplicate', icon: 'duplicate', shortcut: 'Shift+D', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Copy the selected objects in place.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.duplicateSelected('simple'); return {ok: true} },
        },
        {
            id: 'object.hide', label: 'Hide', icon: 'eye-off', shortcut: 'H', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Hide the selected objects.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.toggleVisibilitySelected(); return {ok: true} },
        },
        {
            id: 'object.unhide_all', label: 'Unhide All', icon: 'eye-open', shortcut: 'Shift+H', category: 'Object', modes: ['object'],
            description: 'Show every hidden object.',
            flags: {undo: true},
            exec: () => { picking.unhideAll(); return {ok: true} },
        },
        {
            id: 'object.reset_position', label: 'Clear Location', icon: 'move', shortcut: 'Alt+G', category: 'Object', modes: ['object'],
            description: 'Move the selection back to the origin.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('position'); return {ok: true} },
        },
        {
            id: 'object.reset_rotation', label: 'Clear Rotation', icon: 'refresh', shortcut: 'Alt+R', category: 'Object', modes: ['object'],
            description: 'Reset the selection\'s rotation.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('rotation'); return {ok: true} },
        },
        {
            id: 'object.reset_scale', label: 'Clear Scale', icon: 'maximize', shortcut: 'Alt+S', category: 'Object', modes: ['object'],
            description: 'Reset the selection\'s scale to 1.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('scale'); return {ok: true} },
        },
    ]
    for (const op of ops) engine.operators.register(op)
}

/** The `primitive` command's schema, narrowed to the parameters that apply to one primitive type. */
function primitiveSchema(engine: LegacyEditorEngine, type: string): PropSchema | undefined {
    const def = engine.modelling?.describeCommands().find(c => c.name === 'primitive')
    const schema = def?.inputSchema as PropSchema | undefined
    if (!schema) return undefined
    const keys = PRIMITIVE_PROPS[type] ?? []
    const properties: PropSchema['properties'] = {}
    for (const k of keys) if (schema.properties[k]) properties[k] = schema.properties[k]
    return {type: 'object', properties}
}
