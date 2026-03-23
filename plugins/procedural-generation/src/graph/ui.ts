/**
 * UI binding for the graph system.
 *
 * Generates a UiObjectConfig tree from a Runtime, reading ui metadata from
 * PropDef inputs on node definitions. Each node with settable inputs gets a folder.
 */

import type {UiObjectConfig} from 'uiconfig.js'
import {resolveDefault, resolveUi, type NodeDef, type InputDef} from './graph'
import type {Runtime} from './runtime'

/** Generate a complete UiObjectConfig tree for a graph runtime.
 *  Shows all settable PropDef inputs from all nodes, flattened into one folder
 *  like Blender's modifier panel. Inputs are labeled as "NodeName: InputLabel". */
export function graphUiConfig(
    rt: Runtime,
    onChange: () => void,
    label = 'Node Graph',
): UiObjectConfig {
    const children: UiObjectConfig[] = []

    for (const node of rt.graph.nodes) {
        const inputs = rt.settableInputs(node)
        if (inputs.length === 0) continue

        const defs: Record<string, InputDef> = node.inputDefs

        const visible = inputs.filter(name => {
            const ui = resolveUi(defs[name])
            return ui && !ui.hidden
        })
        if (visible.length === 0) continue

        // Proxy for property binding
        const proxy: Record<string, unknown> = {}
        for (const name of visible) proxy[name] = resolveDefault(defs[name])

        for (const name of visible) {
            const val = resolveDefault(defs[name])
            const ui = resolveUi(defs[name])
            const inputLabel = ui?.label ?? name

            let base: UiObjectConfig
            if (typeof val === 'boolean') {
                base = {type: 'checkbox', label: inputLabel, property: [proxy, name]}
            } else if (typeof val === 'string') {
                base = ui?.options
                    ? {type: 'dropdown', label: inputLabel, property: [proxy, name], children: ui.options.map((o: string) => ({label: o}))}
                    : {type: 'input', label: inputLabel, property: [proxy, name]}
            } else if (typeof val === 'number') {
                if (ui?.bounds) {
                    const isInt = Number.isInteger(val)
                    base = {type: 'slider', label: inputLabel, property: [proxy, name],
                        bounds: ui.bounds, stepSize: isInt ? 1 : 0.1}
                } else {
                    base = {type: 'number', label: inputLabel, property: [proxy, name]}
                }
            } else {
                base = {type: 'input', label: inputLabel, property: [proxy, name]}
            }

            children.push({
                ...base,
                ...ui,
                label: inputLabel,
                onChange: () => {
                    rt.set(node, name, proxy[name])
                    onChange()
                },
            } satisfies UiObjectConfig)
        }
    }

    return {
        type: 'folder',
        label,
        expanded: true,
        children,
    }
}

/** Generate a UiObjectConfig folder for a single node's settable inputs. Returns null if none visible. */
export function nodeUiConfig(
    rt: Runtime,
    node: NodeDef,
    onChange: () => void,
    expanded = false,
): UiObjectConfig | null {
    const inputs = rt.settableInputs(node)
    if (inputs.length === 0) return null

    const defs: Record<string, InputDef> = node.inputDefs

    // Filter: only show PropDef inputs with ui metadata (not raw values)
    const visible = inputs.filter(name => {
        const ui = resolveUi(defs[name])
        if (!ui) return false  // raw values (not PropDef) are internal — never show
        if (ui.hidden) return false
        return true
    })
    if (visible.length === 0) return null

    // Proxy object for uiConfig property binding
    const proxy: Record<string, unknown> = {}
    for (const name of visible) proxy[name] = resolveDefault(defs[name])

    const children: UiObjectConfig[] = visible.map(name => {
        const val = resolveDefault(defs[name])
        const ui = resolveUi(defs[name])

        // Pick the right control type based on the value type and ui metadata
        let base: UiObjectConfig
        if (typeof val === 'boolean') {
            base = {type: 'checkbox', label: name, property: [proxy, name]}
        } else if (typeof val === 'string') {
            base = ui?.options
                ? {type: 'dropdown', label: name, property: [proxy, name], children: ui.options.map((o: string) => ({label: o}))}
                : {type: 'input', label: name, property: [proxy, name]}
        } else if (typeof val === 'number') {
            // Use slider only if bounds are provided, otherwise plain number input
            if (ui?.bounds) {
                const isInt = Number.isInteger(val)
                base = {type: 'slider', label: name, property: [proxy, name],
                    bounds: ui.bounds, stepSize: isInt ? 1 : 0.1}
            } else {
                base = {type: 'number', label: name, property: [proxy, name]}
            }
        } else {
            base = {type: 'input', label: name, property: [proxy, name]}
        }

        return {
            ...base,
            ...ui,
            onChange: () => {
                rt.set(node, name, proxy[name])
                onChange()
            },
        } satisfies UiObjectConfig
    })

    return {
        type: 'folder',
        label: node.name,
        expanded,
        children,
    }
}
