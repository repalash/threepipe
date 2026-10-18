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
 * With the limit surface (`is_adaptive`), Blender's evaluator (`evaluator_impl.cc:439-505`) refines adaptively to
 * `quality`, builds bicubic patches with Gregory-basis end caps, and evaluates them at the grid points of a
 * `(1 << levels) + 1` grid per ptex face (`subdiv_foreach` / `subdiv_mesh`). The output topology is the uniform
 * refinement to `levels` (the same grid), and every output vertex and UV corner is evaluated on the patch table at
 * its ptex coordinate (`patchTable.ts`). Without the limit surface the refined control points are the result.
 */

import {MeshData} from '../MeshData'
import {createBaseLevel, TopologyRefiner} from './refiner'
import {CreasingMethod, FVarLinearInterpolation, SdcOptions, VtxBoundaryInterpolation} from './sdc'
import {Level} from './level'
import {isUVMapLayer, propagateAttributes} from './attributes'
import {FVarChannel, uvValuesFromCorners} from './fvarRefiner'
import {buildPatchTable, evaluatePatch, PatchMap, resolvePoints} from './patchTable'
import {PtexIndices} from './patchBuilder'
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
    // UV maps become face-varying channels of the base level (subdiv_converter_mesh.cc precalc_uv_layer)
    const uvLayers = mesh.attributes.layers().filter(isUVMapLayer)
    const uvChannels = uvLayers.map(layer => {
        const {cornerValues, values} = uvValuesFromCorners(mesh, layer.data)
        return {layer, values, channel: refiner.addFVarChannel(cornerValues, values.length / 2)}
    })

    // positions of the base level
    const P0 = mesh.positions
    let pos: Float64Array = new Float64Array(base.level.numVertices * 3)
    for (let bv = 0; bv < base.level.numVertices; bv++) {
        const mv = base.baseToMesh[bv]
        pos[3 * bv] = P0[3 * mv]; pos[3 * bv + 1] = P0[3 * mv + 1]; pos[3 * bv + 2] = P0[3 * mv + 2]
    }
    const basePos = pos

    // the output grid: uniform refinement to `levels`
    refiner.refineUniform(levels)
    for (let l = 1; l <= levels; l++) pos = refiner.interpolate(l, pos, 3)
    const outLevel = refiner.levels[levels]
    const limited = useLimit && !simple
    let finalPos: Float64Array = pos.subarray(0, outLevel.numVertices * 3)

    // the limit surface: an adaptive refiner of its own and its patch table
    let limitEval: LimitEvaluator | null = null
    let grid: PtexGrid | null = null
    if (limited) {
        const aBase = createBaseLevel(mesh, options, {useCreases: opts.useCreases ?? true, simple, edgeCrease: opts.edgeCrease, vertexCrease: opts.vertexCrease})
        const adaptive = new TopologyRefiner(aBase.level, options)
        const aUV = uvLayers.map(layer => {
            const {cornerValues, values} = uvValuesFromCorners(mesh, layer.data)
            return {values, channel: adaptive.addFVarChannel(cornerValues, values.length / 2)}
        })
        adaptive.refineAdaptive({isolationLevel: quality, useInfSharpPatch: true, considerFVarChannels: aUV.length > 0})
        limitEval = new LimitEvaluator(adaptive, basePos, aUV.map(u => ({channel: u.channel, values: u.values})))
        grid = ptexGrid(refiner, levels)
        finalPos = new Float64Array(outLevel.numVertices * 3)
        for (let v = 0; v < outLevel.numVertices; v++) {
            limitEval.evaluate(grid.vertFace[v], grid.vertU[v], grid.vertV[v], finalPos, 3 * v)
        }
    }

    const faces: number[][] = []
    for (let f = 0; f < outLevel.numFaces; f++) faces.push(Array.from(outLevel.getFaceVertices(f)))
    const out = MeshData.fromFaces({positions: Float32Array.from(finalPos), faces})
    out.materials = [...mesh.materials]

    const warnings: string[] = []
    propagateAttributes(refiner, levels, mesh, base.baseToMesh, out, warnings)

    // UV maps: face-varying channels refined with the output grid, or evaluated on the face-varying patches
    uvChannels.forEach(({layer, values, channel: c}, i) => {
        const dstUV = out.attributes.ensure(layer.name, AttrDomain.Corner, 'float2').data as Float32Array
        const fv = outLevel.faceVerts.indices
        if (limitEval && grid) {
            const uv = new Float64Array(2)
            for (let f = 0; f < outLevel.numFaces; f++) {
                for (let k = 0; k < 4; k++) {
                    const corner = 4 * f + k
                    limitEval.evaluateFVar(i, grid.facePtex[f], grid.cornerU[corner], grid.cornerV[corner], uv, 0)
                    dstUV[2 * corner] = uv[0]
                    dstUV[2 * corner + 1] = uv[1]
                }
            }
            return
        }
        const channel = new FVarChannel(refiner, c)
        let vals = values
        for (let l = 1; l <= levels; l++) vals = channel.interpolate(l, vals, 2)
        const fL = channel.levels[levels]
        for (let corner = 0; corner < fv.length; corner++) {
            const val = fL.faceVertValues[corner]
            dstUV[2 * corner] = vals[2 * val]
            dstUV[2 * corner + 1] = vals[2 * val + 1]
        }
    })
    if (base.baseToMesh.length < mesh.vertsNum) warnings.push('loose vertices and edges are not carried to the output yet (16b S7)')
    return {mesh: out, refiner, level: outLevel, warnings}
}

/**
 * Ptex coordinates of the uniform grid at `levels`: for each face its ptex face and the (u, v) of its corners, and
 * for each vertex one (face, u, v) it is evaluated at (the first face it appears in). Ptex faces follow
 * `Far::PtexIndices`; a quad's frame has corner 0 at (0, 0) and corner 1 at (1, 0), an n-gon's sub-face j (its j-th
 * level-1 child) has the base vertex j at (0, 0), as OpenSubdiv's patch parameterisation (`ComputePatchParam`) does.
 */
interface PtexGrid {
    facePtex: Int32Array
    cornerU: Float64Array
    cornerV: Float64Array
    vertFace: Int32Array
    vertU: Float64Array
    vertV: Float64Array
}

function ptexGrid(refiner: TopologyRefiner, levels: number): PtexGrid {
    const base = refiner.levels[0]
    const ptex = new PtexIndices(base)
    // level 1 faces from the base faces
    let L = refiner.levels[1]
    let facePtex = new Int32Array(L.numFaces)
    let cu = new Float64Array(L.numFaces * 4), cv = new Float64Array(L.numFaces * 4)
    const r0 = refiner.refinements[0]
    const QUAD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]]
    for (let f = 0; f < base.numFaces; f++) {
        const n = base.faceVerts.counts[f]
        for (let j = 0; j < n; j++) {
            const cf = r0.faceChildFace(f, j)
            const cVerts = L.getFaceVertices(cf)
            for (let k = 0; k < 4; k++) {
                const x = cVerts[k]
                let u: number, v: number
                if (n === 4) {
                    // the child vertex's place in the parent frame
                    if (x === r0.faceChildVert[f]) { u = 0.5; v = 0.5 }
                    else {
                        const pv = r0.childVertParent[x]
                        if (x < r0.firstChildVertFromFace) {
                            const kk = Array.from(base.getFaceVertices(f)).indexOf(pv)
                            u = QUAD_UV[kk][0]; v = QUAD_UV[kk][1]
                        } else {
                            const kk = Array.from(base.getFaceEdges(f)).indexOf(pv)
                            u = (QUAD_UV[kk][0] + QUAD_UV[(kk + 1) & 3][0]) / 2
                            v = (QUAD_UV[kk][1] + QUAD_UV[(kk + 1) & 3][1]) / 2
                        }
                    }
                    facePtex[cf] = ptex.getFaceId(f)
                } else {
                    // sub-face j: [vertex j, mid edge j, centre, mid edge j-1] at (0,0), (1,0), (1,1), (0,1)
                    u = QUAD_UV[k][0]; v = QUAD_UV[k][1]
                    facePtex[cf] = ptex.getFaceId(f) + j
                }
                cu[4 * cf + k] = u
                cv[4 * cf + k] = v
            }
        }
    }
    // deeper levels: child corners from the parent face's corner coordinates
    for (let l = 2; l <= levels; l++) {
        const r = refiner.refinements[l - 1], P = refiner.levels[l - 1]
        L = refiner.levels[l]
        const nPtex = new Int32Array(L.numFaces), nu = new Float64Array(L.numFaces * 4), nv = new Float64Array(L.numFaces * 4)
        for (let f = 0; f < P.numFaces; f++) {
            const pVerts = P.getFaceVertices(f), pEdges = P.getFaceEdges(f)
            for (let j = 0; j < 4; j++) {
                const cf = r.faceChildFace(f, j)
                const cVerts = L.getFaceVertices(cf)
                nPtex[cf] = facePtex[f]
                for (let k = 0; k < 4; k++) {
                    const x = cVerts[k]
                    let u = 0, v = 0
                    if (x === r.faceChildVert[f]) {
                        for (let m = 0; m < 4; m++) { u += cu[4 * f + m] / 4; v += cv[4 * f + m] / 4 }
                    } else if (x < r.firstChildVertFromFace) {
                        const m = Array.from(pVerts).indexOf(r.childVertParent[x])
                        u = cu[4 * f + m]; v = cv[4 * f + m]
                    } else {
                        const m = Array.from(pEdges).indexOf(r.childVertParent[x])
                        u = (cu[4 * f + m] + cu[4 * f + ((m + 1) & 3)]) / 2
                        v = (cv[4 * f + m] + cv[4 * f + ((m + 1) & 3)]) / 2
                    }
                    nu[4 * cf + k] = u
                    nv[4 * cf + k] = v
                }
            }
        }
        facePtex = nPtex; cu = nu; cv = nv
    }
    const vertFace = new Int32Array(L.numVertices).fill(-1), vertU = new Float64Array(L.numVertices), vertV = new Float64Array(L.numVertices)
    for (let f = 0; f < L.numFaces; f++) {
        const fv = L.getFaceVertices(f)
        for (let k = 0; k < 4; k++) {
            const x = fv[k]
            if (vertFace[x] >= 0) continue
            vertFace[x] = facePtex[f]; vertU[x] = cu[4 * f + k]; vertV[x] = cv[4 * f + k]
        }
    }
    return {facePtex, cornerU: cu, cornerV: cv, vertFace, vertU, vertV}
}

/** The patch table of an adaptive refiner with its resolved points, evaluated at ptex coordinates. */
class LimitEvaluator {
    private readonly table: ReturnType<typeof buildPatchTable>
    private readonly map: PatchMap
    private readonly points: Float64Array
    private readonly fvarPoints: Float64Array[]

    constructor(refiner: TopologyRefiner, basePositions: Float64Array, uvs: {channel: number, values: Float64Array}[]) {
        this.table = buildPatchTable(refiner, true)
        this.map = new PatchMap(this.table.patches.map(p => p.param))
        // positions of every level (the vertex stencils with intermediate levels), then the local points
        const levelValues = new Float64Array(this.table.vertex.numLevelPoints * 3)
        let cur = basePositions
        levelValues.set(cur, 0)
        for (let l = 1; l < refiner.levels.length; l++) {
            cur = refiner.interpolate(l, cur, 3)
            levelValues.set(cur.subarray(0, refiner.levels[l].numVertices * 3), this.table.vertex.levelOffsets[l] * 3)
        }
        this.points = resolvePoints(this.table.vertex, levelValues, 3)
        this.fvarPoints = uvs.map(({channel, values}) => {
            const ch = new FVarChannel(refiner, channel)
            const fv = this.table.fvar[channel]
            const all = new Float64Array(fv.channel.numLevelPoints * 2)
            let vals = values
            all.set(vals, 0)
            for (let l = 1; l < refiner.levels.length; l++) {
                vals = ch.interpolate(l, vals, 2)
                all.set(vals, fv.channel.levelOffsets[l] * 2)
            }
            return resolvePoints(fv.channel, all, 2)
        })
    }

    evaluate(face: number, u: number, v: number, out: Float64Array, o: number): void {
        const h = this.map.findPatch(face, u, v)
        if (h < 0) throw new Error(`subdivision: no patch at ptex face ${face} (${u}, ${v})`)
        evaluatePatch(this.table.patches[h], u, v, this.points, 3, out, o)
    }

    /** `evaluateFaceVarying`: the patch handle comes from the vertex patch map, as Blender looks it up. */
    evaluateFVar(channel: number, face: number, u: number, v: number, out: Float64Array, o: number): void {
        const h = this.map.findPatch(face, u, v)
        if (h < 0) throw new Error(`subdivision: no patch at ptex face ${face} (${u}, ${v})`)
        evaluatePatch(this.table.fvar[channel].patches[h], u, v, this.fvarPoints[channel], 2, out, o)
    }
}

/** Blender's Subdivision Surface: `MeshData` in, `MeshData` out. Level 0 (or a mesh without faces) is a copy. */
export function subdivisionSurface(mesh: MeshData, opts: SubdivisionSurfaceOptions = {}): MeshData {
    return subdivisionSurfaceEvaluate(mesh, opts)?.mesh ?? mesh.clone()
}
