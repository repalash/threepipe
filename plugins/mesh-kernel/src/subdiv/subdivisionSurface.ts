/**
 * Blender's Subdivision Surface modifier on a {@link MeshData} (`MOD_subsurf.cc`, Blender 5.2.2): settings from
 * `BKE_subsurf_modifier_settings_init` (`subdiv_modifier.cc`), then `bke::subdiv` (`bke/`): `subdiv_new_from_mesh`
 * on the OpenSubdiv port (`osd/`) and `subdiv_to_mesh` at resolution `(1 << levels) + 1`. The output is in Blender's
 * `subdiv_foreach` order with Blender's attribute interpolation; loose edges and vertices are kept.
 *
 * Everything runs in float as Blender's CPU evaluator does: uniform refinement through stencils, and the limit
 * surface (`is_adaptive`, refined to `quality`) through adaptive refinement, B-spline and Gregory patches with their
 * local points (`issues/open/modelling-tools/15e-one-subdivision-port.md`).
 */
import {MeshData} from '../MeshData'
import {fvarInterpolationFromUvSmooth, subdivNewFromMesh, SubdivSettings, vtxBoundaryInterpolationFromSubsurf} from './bke/subdiv'
import {subdivToMesh} from './bke/subdivMesh'
import type {SubdivBoundarySmooth, SubdivUVSmooth} from './options'

export type {SubdivBoundarySmooth, SubdivUVSmooth} from './options'

export interface SubdivisionSurfaceOptions {
    /** Subdivision levels. Default 1. */
    levels?: number
    /** Evaluate the limit surface (Blender's default) instead of the refined control points. Default true. */
    useLimitSurface?: boolean
    /** Adaptive refinement depth for the limit surface (Blender's `quality`). Default 3. */
    quality?: number
    /** Read `crease_edge` / `crease_vert`. Default true. */
    useCreases?: boolean
    /** Blender's `boundary_smooth`. Default `ALL`. */
    boundarySmooth?: SubdivBoundarySmooth
    /** Blender's `uv_smooth`. Default `PRESERVE_BOUNDARIES`. (Face-varying interpolation is step S5.) */
    uvSmooth?: SubdivUVSmooth
    /** `SIMPLE` is Blender's Simple subdivision (and the Subdivide Mesh node). Default `CATMULL_CLARK`. */
    scheme?: 'CATMULL_CLARK' | 'SIMPLE'
}

export interface SubdivisionResult {
    mesh: MeshData
    /** What was not reproduced exactly. */
    warnings: string[]
}

/** `eSubsurfUVSmooth` (`DNA_modifier_types.h`), in DNA order. */
const SUBSURF_UV_SMOOTH: readonly SubdivUVSmooth[] = ['NONE', 'PRESERVE_CORNERS', 'PRESERVE_CORNERS_AND_JUNCTIONS',
    'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE', 'PRESERVE_BOUNDARIES', 'SMOOTH_ALL']
/** `eSubsurfBoundarySmooth` (`DNA_modifier_types.h`), in DNA order. */
const SUBSURF_BOUNDARY_SMOOTH: readonly SubdivBoundarySmooth[] = ['ALL', 'PRESERVE_CORNERS']

/**
 * Blender's Subdivision Surface modifier (`MOD_subsurf.cc`): `BKE_subsurf_modifier_settings_init`
 * (`subdiv_modifier.cc`: simple at level 1, the limit surface adaptive to `quality`, else uniform to `levels`),
 * `subdiv_new_from_mesh` and `subdiv_to_mesh` at resolution `(1 << levels) + 1` - so the result is in Blender's
 * order with Blender's attribute interpolation. Null when nothing is subdivided (levels 0, no faces) or no
 * `Subdiv` could be made.
 */
export function subdivisionSurfaceEvaluate(mesh: MeshData, opts: SubdivisionSurfaceOptions = {}): SubdivisionResult | null {
    const levels = opts.levels ?? 1
    const resolution = (1 << Math.max(levels, 0)) + 1
    // `subdiv_as_mesh`: a resolution below 3 returns the input.
    if (levels <= 0 || resolution < 3 || mesh.facesNum === 0) return null
    const simple = opts.scheme === 'SIMPLE'
    const adaptive = opts.useLimitSurface ?? true
    const settings: SubdivSettings = {
        isSimple: simple,
        isAdaptive: adaptive,
        level: simple ? 1 : adaptive ? opts.quality ?? 3 : levels,
        useCreases: opts.useCreases ?? true,
        vtxBoundaryInterpolation: vtxBoundaryInterpolationFromSubsurf(SUBSURF_BOUNDARY_SMOOTH.indexOf(opts.boundarySmooth ?? 'ALL')),
        fvarLinearInterpolation: fvarInterpolationFromUvSmooth(SUBSURF_UV_SMOOTH.indexOf(opts.uvSmooth ?? 'PRESERVE_BOUNDARIES')),
    }
    const subdiv = subdivNewFromMesh(settings, mesh)
    if (!subdiv) return null
    // `use_optimal_display` only tags edges for drawing; nothing in the mesh changes with it.
    const out = subdivToMesh(subdiv, {resolution, useOptimalDisplay: false}, mesh)
    if (!out) return null
    return {mesh: out, warnings: []}
}

/** Blender's Subdivision Surface: `MeshData` in, `MeshData` out. Level 0 (or a mesh without faces) is a copy. */
export function subdivisionSurface(mesh: MeshData, opts: SubdivisionSurfaceOptions = {}): MeshData {
    return subdivisionSurfaceEvaluate(mesh, opts)?.mesh ?? mesh.clone()
}
