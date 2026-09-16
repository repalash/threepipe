/**
 * `@threepipe/mesh-kernel` - a Node-safe editable polygon mesh kernel.
 *
 * The kernel has no dependency on threepipe and touches no browser API, so it runs in Node, in a
 * worker, or in the browser. Rendering, picking and UI live in `@threepipe/plugin-mesh-edit`.
 *
 * Two representations, following Blender:
 * - {@link MeshData} - struct-of-arrays with n-gon faces and per-domain attributes. Canonical,
 *   serialisable, cheap to snapshot and to bake into a `BufferGeometry`.
 * - {@link BMesh} - verts, edges, loops and faces linked by disk, radial and loop cycles, built when
 *   editing starts. Every operator runs here, then writes back.
 */

export * from './constants'
export * from './attributes'
export * from './MeshData'
export * from './bmesh'
export * from './bake'
export * from './unbake'
