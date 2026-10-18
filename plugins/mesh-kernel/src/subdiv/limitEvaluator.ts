/**
 * The limit surface of a mesh at ptex coordinates (`createSubdivLimitEvaluator`): an adaptive refiner to `quality` and
 * its patch table, evaluated in double. `bke::subdiv` (`bke/subdiv.ts`) uses it for `is_adaptive` until the float
 * adaptive pipeline replaces it (subplan 15e, phase 2).
 */

import {MeshData} from '../MeshData'
import {createBaseLevel, TopologyRefiner} from './refiner'
import {CreasingMethod, SdcOptions, VtxBoundaryInterpolation} from './sdc'
import {FVarChannel, uvValuesFromCorners} from './fvarRefiner'
import {buildPatchTable, evaluatePatch, PatchMap, resolvePoints} from './patchTable'
import {fvarInterpolationFromUVSmooth, SubdivBoundarySmooth, SubdivUVSmooth} from './options'

/** An adaptive refiner of `mesh` to `quality` with its patch table: Blender's limit-surface evaluator. */
function adaptiveLimitEvaluator(mesh: MeshData, options: SdcOptions, settings: Parameters<typeof createBaseLevel>[2], quality: number,
    basePositions: Float64Array, uvMaps: ArrayLike<number>[]): LimitEvaluator {
    const aBase = createBaseLevel(mesh, options, settings)
    const adaptive = new TopologyRefiner(aBase.level, options)
    const aUV = uvMaps.map(uv => {
        const {cornerValues, values} = uvValuesFromCorners(mesh, uv)
        return {values, channel: adaptive.addFVarChannel(cornerValues, values.length / 2)}
    })
    adaptive.refineAdaptive({isolationLevel: quality, useInfSharpPatch: true, considerFVarChannels: aUV.length > 0})
    return new LimitEvaluator(adaptive, basePositions, aUV.map(u => ({channel: u.channel, values: u.values})))
}

/** Options of {@link createSubdivLimitEvaluator}: {@link SubdivisionSurfaceOptions}' surface settings and the UV maps. */
export interface SubdivLimitEvaluatorOptions {
    quality?: number
    /**
     * Blender's Simple subdivision (`is_simple`: OpenSubdiv's bilinear scheme). Until the float adaptive port
     * (subplan 15e phase 2) this evaluates Catmark with every edge and vertex infinitely sharp, which refines the same
     * points as the bilinear scheme.
     */
    simple?: boolean
    useCreases?: boolean
    edgeCrease?: ArrayLike<number> | null
    vertexCrease?: ArrayLike<number> | null
    boundarySmooth?: SubdivBoundarySmooth
    uvSmooth?: SubdivUVSmooth
    /** Per-corner float2 UV maps, one face-varying channel each, in this order. */
    uvMaps?: ArrayLike<number>[]
}

/** Blender's limit surface of a mesh (`is_adaptive`), evaluated at ptex coordinates (`Far::PtexIndices`). */
export interface SubdivLimitEvaluator {
    /** `evaluateLimit`: the position at (u, v) of ptex face `ptexFace`. */
    evaluateLimit(ptexFace: number, u: number, v: number, out: Float64Array, offset?: number): void
    /** `evaluateFaceVarying`: UV map `channel` at the same place (the patch found through the vertex patch map). */
    evaluateFaceVarying(channel: number, ptexFace: number, u: number, v: number, out: Float64Array, offset?: number): void
}

/**
 * The limit-surface evaluator Blender's subdivision builds with `is_adaptive` (`evaluator_impl.cc:439-505`): an
 * adaptive refiner to `quality` and its patch table. For callers that mesh the result themselves (the geometry-nodes
 * Subdivision Surface node, which follows `subdiv_mesh.cc`'s output order). Null for a mesh without faces.
 */
export function createSubdivLimitEvaluator(mesh: MeshData, opts: SubdivLimitEvaluatorOptions = {}): SubdivLimitEvaluator | null {
    if (mesh.facesNum === 0) return null
    const options: SdcOptions = {
        vtxBoundaryInterpolation: (opts.boundarySmooth ?? 'ALL') === 'PRESERVE_CORNERS' ? VtxBoundaryInterpolation.EdgeAndCorner : VtxBoundaryInterpolation.EdgeOnly,
        fvarLinearInterpolation: fvarInterpolationFromUVSmooth(opts.uvSmooth ?? 'PRESERVE_BOUNDARIES'),
        creasingMethod: CreasingMethod.Uniform,
    }
    const settings = {useCreases: opts.useCreases ?? true, simple: opts.simple ?? false, edgeCrease: opts.edgeCrease, vertexCrease: opts.vertexCrease}
    const base = createBaseLevel(mesh, options, settings)
    const P0 = mesh.positions
    const basePos = new Float64Array(base.level.numVertices * 3)
    for (let bv = 0; bv < base.level.numVertices; bv++) {
        const mv = base.baseToMesh[bv]
        basePos[3 * bv] = P0[3 * mv]; basePos[3 * bv + 1] = P0[3 * mv + 1]; basePos[3 * bv + 2] = P0[3 * mv + 2]
    }
    const ev = adaptiveLimitEvaluator(mesh, options, settings, opts.quality ?? 3, basePos, opts.uvMaps ?? [])
    return {
        evaluateLimit: (f, u, v, out, o = 0) => ev.evaluate(f, u, v, out, o),
        evaluateFaceVarying: (c, f, u, v, out, o = 0) => ev.evaluateFVar(c, f, u, v, out, o),
    }
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
