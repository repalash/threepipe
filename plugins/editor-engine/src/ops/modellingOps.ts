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

const SKIP = new Set(['look', 'primitive', 'undo', 'redo', 'checkpoint', 'history', 'help', 'selftest', 'capture',
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

    // The agent socket: connect this page to a relay so an agent outside drives the document.
    engine.operators.register({
        id: 'agent.connect',
        label: 'Connect Agent…',
        description: 'Let an AI agent (Claude Code, the threepipe-modelling CLI) drive this document through the agent socket. Its steps land in this undo history.',
        icon: 'link',
        category: 'File',
        poll: () => engine.viewer.getPlugin('AgentSocketPlugin' as never) ? true : 'AgentSocketPlugin is not loaded',
        exec() {
            engine.dispatchEvent({type: 'uiRequest', request: 'agent'})
            return {ok: true}
        },
    })

    // `look` is what an agent sees with. As an operator it renders the same sheet for the person at the
    // screen and opens it in the shell, beside its description; an agent's own looks land in the same
    // place through `engine.lastLook`.
    const lookSchema = modelling.commands.get('look')?.schema.properties as Record<string, any> | undefined
    if (lookSchema) {
        engine.operators.register({
            id: 'view.look',
            label: 'Look (Agent View)',
            description: 'Render the auto-framed front / right / top / iso sheet an agent sees with `look`, and show it with what it describes.',
            icon: 'eye-open',
            category: 'View',
            modes: ['object', 'edit'],
            props: {
                type: 'object',
                properties: {
                    view: {type: 'string', enum: ['angles', 'viewport', 'front', 'back', 'left', 'right', 'top', 'bottom', 'iso'], description: 'Which view. `angles` is the 2x2 sheet.', default: 'angles'},
                    style: {...lookSchema.style, default: 'solid'},
                },
            },
            async exec(_ctx, props) {
                const result = await modelling.run({op: 'look', view: props?.view ?? 'angles', style: props?.style ?? 'solid'})
                if (!result.ok) return {ok: false, error: result.error}
                engine.dispatchEvent({type: 'uiRequest', request: 'look'})
                return {ok: true, warnings: result.warnings, props: {view: props?.view ?? 'angles', style: props?.style ?? 'solid'}}
            },
        })
    }

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
