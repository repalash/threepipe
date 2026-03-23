/**
 * GraphModule — standard export interface for procedural graph files.
 *
 * Any .ts file that defines a procedural graph should export a `graphModule`
 * conforming to this interface. Both the comparison script and the generic
 * viewer example consume this shape.
 *
 * Instance output format (what the graph nodes must produce):
 *   { world_matrix: number[16], object_name: string }[]
 *
 * world_matrix is column-major 4x4, matching Blender's depsgraph format.
 */

import type {GraphDef, NodeDef} from './graph'

/** A single instance placed by the generator. */
export interface GeneratedInstance {
    /** 16 floats, column-major 4×4 world matrix */
    world_matrix: number[]
    /** Asset filename (e.g. 'window.glb') */
    object_name: string
}

/** Pointer to a node output that produces GeneratedInstance[]. */
export interface OutputRef {
    /** Node reference (from the graph's nodes array) */
    node: NodeDef
    /** Output key on that node */
    output: string
}

/**
 * Standard export shape for a procedural graph file.
 *
 * Usage in a graph .ts file:
 * ```ts
 * export const graphModule: GraphModule = { graph, outputs: [...], assets: [...] }
 * ```
 */
export interface GraphModule {
    /** The graph definition. */
    graph: GraphDef
    /** Which node outputs produce GeneratedInstance[] arrays. */
    outputs: OutputRef[]
    /** Asset filenames the viewer needs to load (e.g. ['window.glb', 'door.glb']). */
    assets: string[]
    /** Base path for assets. Defaults to './assets/' in the viewer. */
    assetsPath?: string
}
