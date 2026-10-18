/**
 * Node types. Each Blender node is one `NodeTypeDef`: its declaration (sockets as a function of its
 * properties) and either a multi-function (field nodes, `build_multi_function`) or an `execute`
 * (`geometry_node_execute`). Ported node files register themselves here.
 */

import type {MultiFunction} from '../fields/field'
import {Declaration, DeclarationBuilder} from './declaration'
import type {ExecParams} from './params'
import type {JSONValue, NodeJSON} from './types'

/** A node of a tree as node code sees it. */
export class NodeInstance {
    readonly decl: Declaration

    constructor(readonly json: NodeJSON, readonly def: NodeTypeDef) {
        const b = new DeclarationBuilder()
        def.declare(b, this)
        this.decl = b.decl
    }

    get name(): string {
        return this.json.name
    }

    get type(): string {
        return this.json.type
    }

    /** An RNA property, falling back to the type's default for a fresh node. */
    prop<T extends JSONValue | JSONValue[] = JSONValue>(name: string): T {
        const v = this.json.properties?.[name] ?? this.def.properties?.[name]
        if (v === undefined) throw new Error(`procedural: ${this.type} '${this.name}' has no property '${name}'`)
        return v as T
    }

    hasProp(name: string): boolean {
        return this.json.properties?.[name] !== undefined || this.def.properties?.[name] !== undefined
    }

    /** Dynamic socket items (`capture_items`, ...). */
    items(name: string): Record<string, JSONValue>[] {
        return this.json.items?.[name] ?? []
    }
}

export interface NodeTypeDef {
    /** `bl_idname`. */
    readonly idname: string
    /** UI name (`ui_name`), used for DSL class names. */
    readonly label: string
    /** RNA properties of a freshly added node, with Blender's defaults (`node_init`). */
    readonly properties?: Record<string, JSONValue | JSONValue[]>
    /** Allowed values of enum properties (RNA enum identifiers), for validation and DSL typings. */
    readonly enums?: Record<string, readonly string[]>
    /** DSL class name when the UI label is ambiguous (`Grid` → `MeshGrid`). */
    readonly dslName?: string
    /** `node_declare`. May read `node.prop(...)` for dynamic declarations. */
    declare(b: DeclarationBuilder, node: NodeInstance): void
    /**
     * Field nodes (`build_multi_function`): one function from the node's available data inputs to its
     * available data outputs, in declaration order. Evaluated on single values when every input is
     * single, otherwise wrapped into a field operation (`execute_multi_function_on_value_variant`,
     * `geometry_nodes_lazy_function.cc:502`).
     */
    multiFunction?(node: NodeInstance): MultiFunction
    /** Everything else (`geometry_node_execute`). */
    execute?(params: ExecParams): void
    /** `internally_linked_input` override for muted nodes. */
    internallyLinkedInput?(node: NodeInstance, outputIdentifier: string): string | undefined
}

const registry = new Map<string, NodeTypeDef>()

export function registerNodeType(def: NodeTypeDef): NodeTypeDef {
    if (registry.has(def.idname)) throw new Error(`procedural: node type ${def.idname} registered twice`)
    registry.set(def.idname, def)
    return def
}

export function getNodeType(idname: string): NodeTypeDef | undefined {
    return registry.get(idname)
}

export function registeredNodeTypes(): NodeTypeDef[] {
    return [...registry.values()]
}
