/**
 * The state of one object being edited: its kernel mesh, the live BMesh operators mutate, and the
 * mapping back to the rendered geometry.
 *
 * Kept separate from the plugin so the whole edit session is testable without a viewer.
 */

import {
    bakeGeometry,
    BMesh,
    bmFromMesh,
    bmToMesh,
    BMEdge,
    BMFace,
    BMVert,
    GeometryData,
    MeshData,
    meshDataFromTriangles,
    meshNormalsUpdate,
    selectCountsRecalc,
    SelectMode,
    SelectModeMask,
} from '@threepipe/mesh-kernel'

/**
 * `EDBMUpdate_Params` (`ED_mesh.hh:157`): what an operator asks the session to recompute after it.
 * Each operator says it, as Blender's do when they call `EDBM_update`. `calc_looptris` has no
 * counterpart: the session re-bakes the drawn surface after every change anyway.
 */
export interface EditMeshUpdateParams {
    /** `calc_normals`: recompute face and vertex normals, `BM_mesh_normals_update`. */
    calcNormals: boolean
}

/** The usual one: a topology or position change, after which the normals are stale. */
export const EDIT_UPDATE_NORMALS: Readonly<EditMeshUpdateParams> = {calcNormals: true}
/** Selection, visibility: nothing an operator reads from the normals changed (`mesh.hide`, `editmesh_tools.cc:2579`). */
export const EDIT_UPDATE_NONE: Readonly<EditMeshUpdateParams> = {calcNormals: false}

/** Buffers a source geometry must expose for edit mode to take it over. */
export interface SourceGeometryArrays {
    position: ArrayLike<number>
    index?: ArrayLike<number> | null
    uv?: ArrayLike<number> | null
    groups?: {start: number, count: number, materialIndex?: number}[]
}

export interface EditMeshStateOptions {
    /** Weld tolerance when recovering topology from triangles. */
    tolerance?: number
    /** Merge coplanar triangles back into n-gons on entry. Off by default; it guesses at intent. */
    mergeCoplanar?: boolean
}

/**
 * One editing session.
 *
 * On construction the source triangles are welded into a {@link MeshData} and a {@link BMesh} is built
 * from it. Operators mutate the BMesh; {@link syncFromBMesh} pushes the result back to the array form
 * and re-bakes the render buffers.
 *
 * The BMesh's face and vertex normals are current whenever an operator starts, as in Blender's edit
 * mode: computed when the session (or an undo step) builds the BMesh
 * (`BKE_editmesh_looptris_and_normals_calc`, `object_edit.cc:906`, `editmesh_undo.cc:1075`) and by
 * {@link update} after each committed operator and modal transform (`EDBM_update`). Not per frame
 * while a transform runs: the drawn surface has its own normals, from {@link bake}.
 */
export class EditMeshState {
    /** The canonical array-form mesh. Rebuilt from the BMesh after every committed change. */
    mesh: MeshData
    /** The live linked-topology mesh. This is what operators touch. */
    bm: BMesh

    /** Incremented on every topology or position change, so views know to rebuild. */
    revision = 0

    /** How many source vertices the weld collapsed. Useful to warn about lossy entry. */
    readonly weldedCount: number

    constructor(source: SourceGeometryArrays, options: EditMeshStateOptions = {}) {
        const {mesh, weldedCount} = meshDataFromTriangles(source, {
            tolerance: options.tolerance,
            mergeCoplanar: options.mergeCoplanar,
        })
        this.mesh = mesh
        this.weldedCount = weldedCount
        this.bm = bmFromMesh(mesh)
        meshNormalsUpdate(this.bm)
    }

    /** Build a session directly from an existing kernel mesh, with no welding. */
    static fromMeshData(mesh: MeshData): EditMeshState {
        const state = Object.create(EditMeshState.prototype) as EditMeshState
        state.mesh = mesh
        state.bm = bmFromMesh(mesh)
        meshNormalsUpdate(state.bm)
        state.revision = 0
        Object.defineProperty(state, 'weldedCount', {value: 0, enumerable: true})
        return state
    }

    get selectMode(): SelectModeMask {
        return this.bm.selectMode
    }

    set selectMode(mode: SelectModeMask) {
        this.bm.selectMode = mode
    }

    /** Push BMesh changes back into the array form. Call after any committed operation. */
    syncFromBMesh(): void {
        selectCountsRecalc(this.bm)
        this.mesh = bmToMesh(this.bm)
        this.revision++
    }

    /** Rebuild the BMesh from the array form. Used after an undo restores a snapshot. */
    syncToBMesh(): void {
        this.bm = bmFromMesh(this.mesh)
        meshNormalsUpdate(this.bm)
        this.revision++
    }

    /**
     * `EDBM_update` (`editmesh_utils.cc:1776`) for what the BMesh carries: after an operator, recompute
     * what it says went stale. Once per committed operator; the plugin calls it from its commit path and
     * when a modal transform ends.
     */
    update(params: EditMeshUpdateParams): void {
        // `EDBM_mesh_normals_update` -> `BM_mesh_normals_update` (:1789).
        if (params.calcNormals) meshNormalsUpdate(this.bm)
    }

    /** Baked render buffers for the current state. With `skipHidden`, hidden faces are not drawn. */
    bake(skipHidden = false): {data: GeometryData, triangleToFace: Int32Array} {
        const {data, triangleToFace} = bakeGeometry(this.mesh, {includeNormals: true, skipHidden})
        return {data, triangleToFace}
    }

    /** A compact summary, the sort of thing a status bar or an agent's `measure()` wants. */
    describe(): string {
        const bm = this.bm
        const domain = bm.selectMode & SelectMode.Face ? 'face'
            : bm.selectMode & SelectMode.Edge ? 'edge' : 'vertex'
        return `${domain} mode | verts ${bm.totvert} edges ${bm.totedge} faces ${bm.totface}`
            + ` | selected ${bm.totvertsel}/${bm.totedgesel}/${bm.totfacesel}`
    }

    /** Elements of the active domain, in a stable order, for overlays and hit testing. */
    activeDomainElements(): (BMVert | BMEdge | BMFace)[] {
        if (this.bm.selectMode & SelectMode.Face) return [...this.bm.faces]
        if (this.bm.selectMode & SelectMode.Edge) return [...this.bm.edges]
        return [...this.bm.verts]
    }
}
