/**
 * Blender's Subdivision Surface on a {@link MeshData}: the Subdivision Surface modifier and the geometry-nodes
 * Subdivision Surface / Subdivide Mesh nodes, through the OpenSubdiv port in this folder
 * (`issues/open/modelling-tools/16b-subdivision-surface.md`).
 *
 * Settings follow `blenkernel/intern/subdiv_modifier.cc:31-39` and `subdiv.cc:47-77` (Blender 5.2.2):
 * - `boundarySmooth`: `ALL` -> `VTX_BOUNDARY_EDGE_ONLY`, `PRESERVE_CORNERS` -> `VTX_BOUNDARY_EDGE_AND_CORNER`;
 * - creasing is always `CREASE_UNIFORM`;
 * - `useLimitSurface` (default true) evaluates the limit surface, otherwise the uniformly refined control points.
 *
 * With the limit surface, Blender evaluates bicubic patches built by adaptive refinement to `quality` at the
 * grid points of a `(1 << levels) + 1` grid per face. Every such grid point is the parameter of a level-`levels`
 * vertex, so this evaluates OpenSubdiv's exact limit mask (`Scheme::ComputeVertexLimitMask`) at that vertex after
 * refining further where semi-sharp creases still have to decay (up to `quality` levels, as adaptive isolation
 * does). Vertex children keep their parent's index in OpenSubdiv's numbering, so the level-`levels` vertex `v` is
 * vertex `v` at every deeper level.
 */

import {MeshData} from '../MeshData'
import {createBaseLevel, TopologyRefiner} from './refiner'
import {CreasingMethod, FVarLinearInterpolation, SdcOptions, VtxBoundaryInterpolation} from './sdc'
import {Level} from './level'
import {isUVMapLayer, propagateAttributes} from './attributes'
import {FVarChannel, uvValuesFromCorners} from './fvarRefiner'
import {AttrDomain} from '../constants'

export type SubdivBoundarySmooth = 'ALL' | 'PRESERVE_CORNERS'
export type SubdivUVSmooth = 'NONE' | 'PRESERVE_CORNERS' | 'PRESERVE_CORNERS_AND_JUNCTIONS'
    | 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE' | 'PRESERVE_BOUNDARIES' | 'SMOOTH_ALL'

export interface SubdivisionSurfaceOptions {
    /** Subdivision levels. Default 1. */
    levels?: number
    /** Evaluate the limit surface (Blender's default) instead of the refined control points. Default true. */
    useLimitSurface?: boolean
    /** Adaptive refinement depth for the limit surface (Blender's `quality`). Default 3. */
    quality?: number
    /** Read `crease_edge` / `crease_vert`. Default true. */
    useCreases?: boolean
    /** Per-edge crease 0..1, overriding the attribute (the geometry-nodes Edge Crease input). */
    edgeCrease?: ArrayLike<number> | null
    /** Per-vertex crease 0..1, overriding the attribute (the geometry-nodes Vertex Crease input). */
    vertexCrease?: ArrayLike<number> | null
    /** Blender's `boundary_smooth`. Default `ALL`. */
    boundarySmooth?: SubdivBoundarySmooth
    /** Blender's `uv_smooth`. Default `PRESERVE_BOUNDARIES`. (Face-varying interpolation is step S5.) */
    uvSmooth?: SubdivUVSmooth
    /** `SIMPLE` is Blender's Simple subdivision (and the Subdivide Mesh node). Default `CATMULL_CLARK`. */
    scheme?: 'CATMULL_CLARK' | 'SIMPLE'
}

/** `subdiv.cc:47` `fvar_interpolation_from_uv_smooth`. */
export function fvarInterpolationFromUVSmooth(uvSmooth: SubdivUVSmooth): FVarLinearInterpolation {
    switch (uvSmooth) {
    case 'NONE': return FVarLinearInterpolation.All
    case 'PRESERVE_CORNERS': return FVarLinearInterpolation.CornersOnly
    case 'PRESERVE_CORNERS_AND_JUNCTIONS': return FVarLinearInterpolation.CornersPlus1
    case 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE': return FVarLinearInterpolation.CornersPlus2
    case 'PRESERVE_BOUNDARIES': return FVarLinearInterpolation.Boundaries
    case 'SMOOTH_ALL': return FVarLinearInterpolation.None
    }
}

/** The refiner and the per-level vertex positions, for callers that need more than the output mesh. */
export interface SubdivisionResult {
    mesh: MeshData
    refiner: TopologyRefiner
    /** The refiner level the output mesh is (its vertices, faces and corners, in order). */
    level: Level
    /** What was not reproduced exactly (UV smoothing modes pending S5, dropped layer types, loose geometry). */
    warnings: string[]
}

export function subdivisionSurfaceEvaluate(mesh: MeshData, opts: SubdivisionSurfaceOptions = {}): SubdivisionResult | null {
    const levels = opts.levels ?? 1
    if (levels <= 0 || mesh.facesNum === 0) return null
    const useLimit = opts.useLimitSurface ?? true
    const quality = opts.quality ?? 3
    const simple = opts.scheme === 'SIMPLE'
    const options: SdcOptions = {
        vtxBoundaryInterpolation: (opts.boundarySmooth ?? 'ALL') === 'PRESERVE_CORNERS' ? VtxBoundaryInterpolation.EdgeAndCorner : VtxBoundaryInterpolation.EdgeOnly,
        fvarLinearInterpolation: fvarInterpolationFromUVSmooth(opts.uvSmooth ?? 'PRESERVE_BOUNDARIES'),
        creasingMethod: CreasingMethod.Uniform,
    }
    const base = createBaseLevel(mesh, options, {useCreases: opts.useCreases ?? true, simple, edgeCrease: opts.edgeCrease, vertexCrease: opts.vertexCrease})
    const refiner = new TopologyRefiner(base.level, options)

    // positions of the base level
    const P0 = mesh.positions
    let pos: Float64Array = new Float64Array(base.level.numVertices * 3)
    for (let bv = 0; bv < base.level.numVertices; bv++) {
        const mv = base.baseToMesh[bv]
        pos[3 * bv] = P0[3 * mv]; pos[3 * bv + 1] = P0[3 * mv + 1]; pos[3 * bv + 2] = P0[3 * mv + 2]
    }

    // how deep to go: `levels`, and for the limit surface deep enough for semi-sharp creases to decay (adaptive
    // isolation stops at `quality`)
    let depth = levels
    if (useLimit && !simple) {
        let maxSemi = 0
        for (const s of base.level.edgeSharpness) if (s > 0 && s < 10 && s > maxSemi) maxSemi = s
        for (const s of base.level.vertSharpness) if (s > 0 && s < 10 && s > maxSemi) maxSemi = s
        depth = Math.max(levels, Math.min(quality, Math.ceil(maxSemi)))
    }
    refiner.refineUniform(depth)
    let atLevels: Float64Array = pos
    for (let l = 1; l <= depth; l++) {
        pos = refiner.interpolate(l, pos, 3)
        if (l === levels) atLevels = pos
    }
    const outLevel = refiner.levels[levels]
    let finalPos: Float64Array
    if (useLimit && !simple && levels > 0) {
        const lim = refiner.limit(pos, 3)
        finalPos = lim.subarray(0, outLevel.numVertices * 3)
    } else {
        finalPos = atLevels.subarray(0, outLevel.numVertices * 3)
    }

    const faces: number[][] = []
    for (let f = 0; f < outLevel.numFaces; f++) faces.push(Array.from(outLevel.getFaceVertices(f)))
    const out = MeshData.fromFaces({positions: Float32Array.from(finalPos), faces})
    out.materials = [...mesh.materials]

    const warnings: string[] = []
    propagateAttributes(refiner, levels, mesh, base.baseToMesh, out, warnings)

    // UV maps: face-varying channels, refined to the same depth, limited the same way as positions
    for (const layer of mesh.attributes.layers().filter(isUVMapLayer)) {
        const {cornerValues, values} = uvValuesFromCorners(mesh, layer.data)
        const channel = new FVarChannel(refiner, cornerValues, values.length / 2)
        let vals = values
        let atLevelsVals = values
        for (let l = 1; l <= depth; l++) {
            vals = channel.interpolate(l, vals, 2)
            if (l === levels) atLevelsVals = vals
        }
        const fL = channel.levels[levels], fD = channel.levels[depth]
        const limited = useLimit && !simple
        const src = limited ? channel.limit(vals, 2) : atLevelsVals
        const dstUV = out.attributes.ensure(layer.name, AttrDomain.Corner, 'float2').data as Float32Array
        const fv = outLevel.faceVerts.indices
        for (let c = 0; c < fv.length; c++) {
            let val = fL.faceVertValues[c]
            if (limited && depth > levels) {
                // the level-`levels` value's descendant: same vertex index, same sibling, deeper offsets
                const v = fv[c]
                val = fD.vertSiblingOffsets[v] + (val - fL.vertSiblingOffsets[v])
            }
            dstUV[2 * c] = src[2 * val]
            dstUV[2 * c + 1] = src[2 * val + 1]
        }
    }
    if (base.baseToMesh.length < mesh.vertsNum) warnings.push('loose vertices and edges are not carried to the output yet (16b S7)')
    return {mesh: out, refiner, level: outLevel, warnings}
}

/** Blender's Subdivision Surface: `MeshData` in, `MeshData` out. Level 0 (or a mesh without faces) is a copy. */
export function subdivisionSurface(mesh: MeshData, opts: SubdivisionSurfaceOptions = {}): MeshData {
    return subdivisionSurfaceEvaluate(mesh, opts)?.mesh ?? mesh.clone()
}
