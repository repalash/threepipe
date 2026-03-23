/**
 * UI binding for the graph system.
 *
 * Generates a UiObjectConfig tree from a Runtime, reading ui metadata from
 * PropDef inputs on node definitions. Each node with settable inputs gets a folder.
 */

import type {UiObjectConfig} from 'uiconfig.js'
import {resolveDefault, resolveUi, type NodeDef, type InputDef} from './graph'
import type {Runtime} from './runtime'

/** Generate a complete UiObjectConfig tree for a graph runtime. */
export function graphUiConfig(
    rt: Runtime,
    onChange: () => void,
    label = 'Node Graph',
): UiObjectConfig {
    const folders: UiObjectConfig[] = []

    for (const node of rt.graph.nodes) {
        const folder = nodeUiConfig(rt, node, onChange)
        if (folder) folders.push(folder)
    }

    return {
        type: 'folder',
        label,
        expanded: true,
        children: folders,
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

    // Filter: only show inputs that have ui metadata or are numeric
    const visible = inputs.filter(name => {
        const ui = resolveUi(defs[name])
        if (ui?.hidden) return false
        const val = resolveDefault(defs[name])
        return ui !== undefined || typeof val === 'number'
    })
    if (visible.length === 0) return null

    // Proxy object for uiConfig property binding
    const proxy: Record<string, unknown> = {}
    for (const name of visible) proxy[name] = resolveDefault(defs[name])

    const children: UiObjectConfig[] = visible.map(name => {
        const val = resolveDefault(defs[name])
        const ui = resolveUi(defs[name])
        const isInt = typeof val === 'number' && Number.isInteger(val)

        return {
            type: 'slider',
            label: name,
            property: [proxy, name],
            bounds: (isInt ? [0, 100] : [0, 10]) as [number, number],
            stepSize: isInt ? 1 : 0.1,
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
