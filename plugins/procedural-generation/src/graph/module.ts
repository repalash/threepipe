/**
 * GraphModule — standard export interface for procedural graph files.
 *
 * Any .ts file that defines a procedural graph should export a `graphModule`
 * conforming to this interface. Both the comparison script and the generic
 * viewer consume this shape.
 *
 * Graph outputs can produce:
 * - `GeneratedInstance[]` — instances placed from loaded GLB assets
 *     { world_matrix: number[16], object_name: string }[]
 *     world_matrix is column-major 4x4, matching Blender's depsgraph format.
 * - Plain data objects with vertex arrays (e.g. `{rings: [{vertices, indices, placements}]}`)
 *     The viewer builds BufferGeometry from vertex data.
 *     The comparison script verifies vertex positions.
 *
 * Both work in Node.js (with polyfill) and in the browser.
 */

import type {GraphDef, NodeDef} from './graph'

/** Mesh data extracted from a loaded GLB asset (geometry + material pairs). */
export interface ModuleData {
    meshes: {geometry: any, material: any, worldMatrix?: any}[]
}

/** Map of asset filename → loaded mesh data. Used by the viewer and scene builders. */
export type ModuleMap = Map<string, ModuleData>

/** A single instance placed by the generator. */
export interface GeneratedInstance {
    /** 16 floats, column-major 4×4 world matrix */
    world_matrix: number[]
    /** Asset filename (e.g. 'window.glb') */
    object_name: string
}

/** Pointer to a node output consumed by the viewer and comparison script. */
export interface OutputRef {
    /** Node reference (from the graph's nodes array) */
    node: NodeDef
    /** Output key on that node */
    output: string
}

/** A single graph with its output references. */
export interface GraphEntry {
    /** The graph definition. */
    graph: GraphDef
    /**
     * Node outputs the viewer should render and the comparison script should verify.
     * Each ref points to a node output producing either:
     * - `GeneratedInstance[]` — placed from loaded GLB assets
     * - Plain data objects with vertex arrays (for procedural mesh generators)
     */
    outputs: OutputRef[]
}

/**
 * Standard export shape for a procedural graph file.
 * Each entry in `graphs` is an independent graph with its own runtime.
 */
export interface GraphModule {
    /** One or more independent graphs, each evaluated with its own runtime. */
    graphs: GraphEntry[]
    /** Asset filenames the viewer needs to load. Shared across all graphs. */
    assets: string[]
    /** Base path for assets. Defaults to './assets/' in the viewer. */
    assetsPath?: string
}
