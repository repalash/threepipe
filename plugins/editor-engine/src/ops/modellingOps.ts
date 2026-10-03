/**
 * `ModellingPlugin.describeCommands()` as object-mode operators.
 *
 * Every command already has a JSON schema, validation, an undo step and a one-line summary, so it
 * maps straight onto an {@link OperatorDescriptor}: `modelling.<op>` with the schema as `props`. The
 * `object` / `objects` parameter is filled from the current selection and hidden from the form.
 * Redo-last is the engine's generic pop-undo + re-run; nothing here implements it.
 *
 * Commands that make no sense as a button (session, capture, help, undo/redo - those have their own
 * operators) are skipped, as are the ones the object-mode pack covers with a richer operator
 * (primitive, delete, duplicate, rename, join, separate, applyTransform) and the edit-mode ones
 * (deleteElements).
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorDescriptor, PropSchema} from '../registry'

const SKIP = new Set(['primitive', 'undo', 'redo', 'checkpoint', 'history', 'help', 'selftest', 'capture',
    'inspect', 'camera', 'export', 'select', 'display', 'measure', 'reference', 'lighting', 'modifier', 'vertices', 'transform',
    'delete', 'duplicate', 'rename', 'join', 'separate', 'deleteElements', 'applyTransform'])

/** Shape operators belong in the object context menu; material/light/lathe/sweep stay in the menus. */
const IN_CONTEXT_MENU = new Set(['inset', 'bevel', 'solidify', 'mirror', 'array', 'extrude', 'weld'])

const ICONS: Record<string, string> = {
    inset: 'inner-join', bevel: 'polygon-filter', solidify: 'layers', mirror: 'swap-horizontal', array: 'layout-grid',
    extrude: 'arrow-up', weld: 'group-objects', material: 'tint', light: 'flash', lathe: 'refresh', sweep: 'flows',
    poke: 'star-empty', wireframe: 'polygon-filter',
}

const CATEGORY: Record<string, string> = {
    inset: 'Mesh', bevel: 'Mesh', solidify: 'Mesh', mirror: 'Mesh', array: 'Mesh', extrude: 'Mesh', weld: 'Mesh',
    poke: 'Mesh', wireframe: 'Mesh', material: 'Object', light: 'Add', lathe: 'Add', sweep: 'Add',
}

/** A command's schema without the object reference, which the selection supplies. */
export function visibleSchema(schema: PropSchema): PropSchema {
    return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([k]) => k !== 'object' && k !== 'objects')),
        required: (schema.required ?? []).filter(k => k !== 'object' && k !== 'objects'),
    }
}

export function registerModellingOperators(engine: EditorEnginePlugin): void {
    const modelling = engine.modelling
    if (!modelling) return

    for (const def of modelling.describeCommands()) {
        if (SKIP.has(def.name)) continue
        const schema = def.inputSchema as PropSchema
        const takesObject = !!schema.properties?.object || !!schema.properties?.objects
        const needsObject = takesObject && !(schema.properties?.object as any)?.description?.includes('optional')
        const visible = visibleSchema(schema)
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
                if (!ctx.selectedObjects.length) return 'Click an object to select it first'
                if (!docObject(ctx).length) return `Enter Edit mode on this object once${engine.keyHint('object.enter_edit', 'object')} to make it modellable, then come back`
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
                return {ok: true, warnings: result.warnings, data: result.data}
            },
        }
        engine.operators.register(op)
    }
}
