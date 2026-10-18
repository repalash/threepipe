/**
 * A menu definition, resolved for the current context: Blender's `UI_menutype_draw` +
 * `ui_item_menutype_func`, which run a menu's `draw` against the context and turn each
 * `layout.operator` into a button with its label, its poll state and the key the keymap gives it.
 *
 * - An operator that is registered shows its poll: disabled with the reason when it cannot run.
 * - An operator that is not registered, or a variant the engine's operator does not implement
 *   (`unavailable`), shows disabled: "Not available yet". The menu keeps Blender's structure.
 * - The key beside an entry is the active keymap's binding for that operator with exactly those
 *   props (`WM_key_event_operator_string`, `wm_keymap.cc`), or for a submenu, the key of the operator
 *   that opens it (Blender shows `wm.call_menu`'s binding beside a submenu).
 * - Rows hidden by their `visible` predicate are dropped (the `if` around a `layout.*` call); separators
 *   are kept exactly where the definition puts them, as Blender draws them.
 */

import type {EditorEngine, EditorContext, MenuItem, ResolvedMenu, ResolvedMenuItem} from '../registry'
import {NOT_AVAILABLE_YET} from '../registry'

export function resolveMenu(engine: EditorEngine, id: string, ctx: EditorContext, depth = 0): ResolvedMenu | undefined {
    const menu = engine.menus.get(id)
    if (!menu) return undefined
    const items = typeof menu.items === 'function' ? menu.items(ctx) : menu.items
    return {id: menu.id, label: menu.label, items: resolveItems(engine, items, ctx, id, depth)}
}

function resolveItems(engine: EditorEngine, items: MenuItem[], ctx: EditorContext, keyPrefix: string, depth: number): ResolvedMenuItem[] {
    const out: ResolvedMenuItem[] = []
    items.forEach((item, i) => {
        if (item.visible && !item.visible(ctx)) return
        const key = `${keyPrefix}/${i}`
        if (item.type === 'separator') {
            out.push({type: 'separator', key})
        } else if (item.type === 'label') {
            out.push({type: 'label', key, label: item.label})
        } else if (item.type === 'operator') {
            const op = engine.operators.get(item.id)
            const blender = item.blender ?? item.id
            if (!op) {
                out.push({type: 'operator', key, id: item.id, label: item.label, props: item.props, icon: item.icon,
                    enabled: false, available: false, tooltip: `${NOT_AVAILABLE_YET} (Blender's ${blender})`})
                return
            }
            const shortcut = engine.keymap.shortcutFor(item.id, ctx.mode, item.props ?? {})
            const unavailable = typeof item.unavailable === 'function' ? item.unavailable(ctx) : item.unavailable
            if (unavailable) {
                out.push({type: 'operator', key, id: item.id, label: item.label, props: item.props, icon: item.icon, shortcut,
                    enabled: false, available: false, tooltip: `${NOT_AVAILABLE_YET}: ${unavailable}`})
                return
            }
            const polled = engine.poll(op, ctx)
            out.push({type: 'operator', key, id: item.id, label: item.label, props: item.props, icon: item.icon, shortcut,
                enabled: polled.enabled, available: true,
                tooltip: polled.enabled ? op.description : polled.reason ?? op.description})
        } else {
            const registered = item.items ? undefined : engine.menus.get(item.id)
            const label = item.label ?? registered?.label ?? item.id
            const keyed = registered?.operator && (!registered.operatorModes || registered.operatorModes.includes(ctx.mode))
            const shortcut = keyed ? engine.keymap.shortcutFor(registered!.operator!, ctx.mode, {}) : undefined
            if (item.unavailable || (!item.items && !registered)) {
                out.push({type: 'menu', key, id: item.id, label, icon: item.icon, shortcut, available: false,
                    tooltip: `${NOT_AVAILABLE_YET}${item.unavailable ? `: ${item.unavailable}` : ` (Blender's ${item.id})`}`})
                return
            }
            // Menus do not nest deeper than a few levels; the guard only stops a definition that names itself.
            if (depth > 8) return
            const menu = item.items
                ? {id: item.id, label, items: resolveItems(engine, item.items, ctx, key, depth + 1)}
                : resolveMenu(engine, item.id, ctx, depth + 1)!
            out.push({type: 'menu', key, id: item.id, label, icon: item.icon, shortcut, available: true, menu: {...menu, label}})
        }
    })
    return out
}
