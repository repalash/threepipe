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
export {};
