/**
 * `@threepipe/mesh-kernel` - a Node-safe editable polygon mesh kernel.
 *
 * The kernel has no dependency on threepipe and touches no browser API, so it runs in Node, in a
 * worker, or in the browser. Rendering, picking and UI live in `@threepipe/plugin-mesh-edit`.
 *
 * Two representations, following Blender:
 * - {@link MeshData} - struct-of-arrays with n-gon faces and per-domain attributes. Canonical,
 *   serialisable, cheap to snapshot and to bake into a `BufferGeometry`.
 * - `BMesh` (coming next) - pointer-linked verts/edges/loops/faces with disk and radial cycles, built
 *   when editing starts. Every operator runs here, then writes back.
 */

export * from './constants'
export * from './attributes'
export * from './MeshData'
