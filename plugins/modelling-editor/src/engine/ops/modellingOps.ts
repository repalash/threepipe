/**
 * `ModellingPlugin.describeCommands()` as operators.
 *
 * Every command already has a JSON schema, validation, undo snapshots and a one-line summary, so it
 * maps straight onto an {@link OperatorDescriptor}: `modelling.<op>` with the schema as `props`. The
 * `object` / `objects` parameter is filled from the current selection and hidden from the form.
 * Redo-last pops the command's history entry and runs it again with the edited props, which is
 * exactly Blender's `ED_undo_operator_repeat`.
 *
 * Commands that make no sense as a button (session, capture, help, undo/redo - those have their own
 * operators) are skipped.
 */

import type {LegacyEditorEngine} from '../legacyEngine'
import type {EditorContext, OperatorDescriptor, PropSchema} from '../../registry'

// delete/duplicate/rename have object-mode operators already (object.*) that also cover imported meshes
const SKIP = new Set(['primitive', 'undo', 'redo', 'checkpoint', 'history', 'help', 'selftest', 'capture',
    'inspect', 'camera', 'export', 'select', 'display', 'measure', 'reference', 'lighting', 'modifier', 'vertices', 'transform',
    'delete', 'duplicate', 'rename'])

/** Shape operators belong in the object context menu; material/light/lathe/sweep stay in the menus. */
const IN_CONTEXT_MENU = new Set(['inset', 'bevel', 'solidify', 'mirror', 'array', 'extrude', 'weld', 'join', 'separate'])

const ICONS: Record<string, string> = {
    inset: 'inner-join', bevel: 'polygon-filter', solidify: 'layers', mirror: 'swap-horizontal', array: 'layout-grid',
    extrude: 'arrow-up', join: 'merge-links', separate: 'split-columns', weld: 'group-objects', delete: 'trash',
    duplicate: 'duplicate', rename: 'edit', material: 'tint', light: 'flash', lathe: 'refresh', sweep: 'flows',
}

const CATEGORY: Record<string, string> = {
    inset: 'Mesh', bevel: 'Mesh', solidify: 'Mesh', mirror: 'Mesh', array: 'Mesh', extrude: 'Mesh', weld: 'Mesh',
    join: 'Object', separate: 'Object', delete: 'Object', duplicate: 'Object', rename: 'Object', material: 'Object',
    light: 'Add', lathe: 'Add', sweep: 'Add',
}

export function registerModellingOperators(engine: LegacyEditorEngine): void {
    const modelling = engine.modelling
    if (!modelling) return

    for (const def of modelling.describeCommands()) {
        if (SKIP.has(def.name)) continue
        const schema = def.inputSchema as PropSchema
        const takesObject = !!schema.properties?.object || !!schema.properties?.objects
        const needsObject = takesObject && !(schema.properties?.object as any)?.description?.includes('optional')
        const visible: PropSchema = {
            type: 'object',
            properties: Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([k]) => k !== 'object' && k !== 'objects')),
            required: (schema.required ?? []).filter(k => k !== 'object' && k !== 'objects'),
        }
        const id = `modelling.${def.name}`
        const docObject = (ctx: EditorContext) => ctx.selectedObjects.map(o => modelling.document.find(o.uuid)).filter(e => !!e)

        const op: OperatorDescriptor = {
            id,
            label: def.name.charAt(0).toUpperCase() + def.name.slice(1),
            description: def.description.split('\n')[0],
            icon: ICONS[def.name] ?? 'wrench',
            category: CATEGORY[def.name] ?? 'Mesh',
            modes: ['object'],
            contextMenu: IN_CONTEXT_MENU.has(def.name) ? ['object'] : undefined,
            props: Object.keys(visible.properties).length ? visible : undefined,
            flags: {undo: true, register: true},
            poll: ctx => {
                if (!needsObject) return true
                if (!ctx.selectedObjects.length) return 'Select an object first'
                if (!docObject(ctx).length) return 'Only objects created here (Add menu) can be modelled; imported meshes are not in the document yet'
                return true
            },
            async exec(ctx, props) {
                const entries = docObject(ctx)
                const command: Record<string, unknown> = {op: def.name, ...props}
                if (takesObject && entries.length) {
                    command[schema.properties?.object ? 'object' : 'objects'] = entries.length === 1 ? entries[0].name : entries.map(e => e.name)
                }
                const result = await modelling.run(command as never)
                if (!result.ok) return {ok: false, error: result.error}
                engine.setLastOperation({
                    operator: op,
                    props: props ?? {},
                    redo: async newProps => {
                        if (engine.canPopLastModellingEntry()) engine.history.undo()
                        return engine.run(id, newProps)
                    },
                })
                return {ok: true, warnings: result.warnings, data: result.data}
            },
        }
        engine.operators.register(op)
    }
}
