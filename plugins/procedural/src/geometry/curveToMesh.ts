/**
 * `bke::curve_to_mesh_sweep` / `curve_to_wire_mesh` (`blenkernel/intern/curve_to_mesh_convert.cc`): every main curve
 * swept along by every profile curve, positions from the main curve's evaluated points, tangents and normals.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {cross3, normalize3} from '../blender/math/vec'
import {CurvesGeometry, MeshAccessor} from './components'
import {BEZIER_HANDLE_FREE, BEZIER_HANDLE_VECTOR, CURVE_TYPE_BEZIER, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, CurvesEvaluator, curvesAttributeOr, segmentsNum} from './curvesEval'
import {fillCurveTypes} from './curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {newMesh} from './meshPrimitives'
import {GVArray} from './varray'

/** `segments_num_no_duplicate_edge` (:20). */
function segmentsNumNoDuplicateEdge(pointsNum: number, cyclic: boolean): number {
    if (pointsNum === 0) return 0
    if (pointsNum <= 2) return segmentsNum(pointsNum, false)
    return segmentsNum(pointsNum, cyclic)
}

/** `has_caps` (:31). */
const hasCaps = (mainCyclic: boolean, profileCyclic: boolean, profileSegmentNum: number) => !mainCyclic && profileCyclic && profileSegmentNum > 2

/** `fill_mesh_topology` (:38). */
function fillMeshTopology(vertOffset: number, edgeOffset: number, faceOffset: number, loopOffset: number, mainPointNum: number,
    profilePointNum: number, mainCyclic: boolean, profileCyclic: boolean, fillCaps: boolean,
    edges: Int32Array, cornerVerts: Int32Array, cornerEdges: Int32Array, faceOffsets: Int32Array): void {
    const mainSegmentNum = segmentsNumNoDuplicateEdge(mainPointNum, mainCyclic)
    const profileSegmentNum = segmentsNum(profilePointNum, profileCyclic)
    const setEdge = (e: number, a: number, b: number) => { edges[e * 2] = a; edges[e * 2 + 1] = b }
    if (profilePointNum === 1) {
        for (let i = 0; i < mainPointNum - 1; i++) setEdge(edgeOffset + i, vertOffset + i, vertOffset + i + 1)
        if (mainCyclic && mainSegmentNum > 2) setEdge(edgeOffset + mainSegmentNum - 1, vertOffset + mainPointNum - 1, vertOffset)
        return
    }
    const mainEdgesStart = edgeOffset
    for (let iProfile = 0; iProfile < profilePointNum; iProfile++) {
        const profileEdgeOffset = mainEdgesStart + iProfile * mainSegmentNum
        for (let iRing = 0; iRing < mainSegmentNum; iRing++) {
            const iNextRing = iRing === mainPointNum - 1 ? 0 : iRing + 1
            setEdge(profileEdgeOffset + iRing, vertOffset + profilePointNum * iRing + iProfile, vertOffset + profilePointNum * iNextRing + iProfile)
        }
    }
    const profileEdgesStart = mainEdgesStart + profilePointNum * mainSegmentNum
    for (let iRing = 0; iRing < mainPointNum; iRing++) {
        const ringVertOffset = vertOffset + profilePointNum * iRing
        const ringEdgeOffset = profileEdgesStart + iRing * profileSegmentNum
        for (let iProfile = 0; iProfile < profileSegmentNum; iProfile++) {
            const iNextProfile = iProfile === profilePointNum - 1 ? 0 : iProfile + 1
            setEdge(ringEdgeOffset + iProfile, ringVertOffset + iProfile, ringVertOffset + iNextProfile)
        }
    }
    for (let iRing = 0; iRing < mainSegmentNum; iRing++) {
        const iNextRing = iRing === mainPointNum - 1 ? 0 : iRing + 1
        const ringVertOffset = vertOffset + profilePointNum * iRing
        const nextRingVertOffset = vertOffset + profilePointNum * iNextRing
        const ringEdgeStart = profileEdgesStart + profileSegmentNum * iRing
        const nextRingEdgeOffset = profileEdgesStart + profileSegmentNum * iNextRing
        const ringFaceOffset = faceOffset + iRing * profileSegmentNum
        const ringLoopOffset = loopOffset + iRing * profileSegmentNum * 4
        for (let iProfile = 0; iProfile < profileSegmentNum; iProfile++) {
            const l = ringLoopOffset + iProfile * 4
            const iNextProfile = iProfile === profilePointNum - 1 ? 0 : iProfile + 1
            const mainEdgeStart = mainEdgesStart + mainSegmentNum * iProfile
            const nextMainEdgeStart = mainEdgesStart + mainSegmentNum * iNextProfile
            faceOffsets[ringFaceOffset + iProfile] = l
            cornerVerts[l] = ringVertOffset + iProfile
            cornerEdges[l] = ringEdgeStart + iProfile
            cornerVerts[l + 1] = ringVertOffset + iNextProfile
            cornerEdges[l + 1] = nextMainEdgeStart + iRing
            cornerVerts[l + 2] = nextRingVertOffset + iNextProfile
            cornerEdges[l + 2] = nextRingEdgeOffset + iProfile
            cornerVerts[l + 3] = nextRingVertOffset + iProfile
            cornerEdges[l + 3] = mainEdgeStart + iRing
        }
    }
    if (fillCaps && hasCaps(mainCyclic, profileCyclic, profileSegmentNum)) {
        const faceNum = mainSegmentNum * profileSegmentNum
        const capLoopOffset = loopOffset + faceNum * 4
        const capFaceOffset = faceOffset + faceNum
        faceOffsets[capFaceOffset] = capLoopOffset
        faceOffsets[capFaceOffset + 1] = capLoopOffset + profileSegmentNum
        const lastRingIndex = mainPointNum - 1
        const lastRingVertOffset = vertOffset + profilePointNum * lastRingIndex
        const lastRingEdgeOffset = profileEdgesStart + profileSegmentNum * lastRingIndex
        for (let i = 0; i < profileSegmentNum; i++) {
            const iInv = profileSegmentNum - i - 1
            cornerVerts[capLoopOffset + i] = vertOffset + iInv
            cornerEdges[capLoopOffset + i] = profileEdgesStart + (i === profileSegmentNum - 1 ? profileSegmentNum - 1 : iInv - 1)
            cornerVerts[capLoopOffset + profileSegmentNum + i] = lastRingVertOffset + i
            cornerEdges[capLoopOffset + profileSegmentNum + i] = lastRingEdgeOffset + i
        }
    }
}

/** `curves::bezier::point_is_sharp` (`BKE_curves.hh:1115`). */
const pointIsSharp = (htl: ArrayLike<number>, htr: ArrayLike<number>, i: number) =>
    htl[i] === BEZIER_HANDLE_VECTOR || htl[i] === BEZIER_HANDLE_FREE || htr[i] === BEZIER_HANDLE_VECTOR || htr[i] === BEZIER_HANDLE_FREE

/**
 * `build_point_matrix` (:179) followed by the optional `math::scale` and `math::transform_point`
 * (`BLI_math_matrix.hh:1647`: `result(0) += p[c] * axis[c]`, then the location).
 */
function transformProfilePoint(location: ArrayLike<number>, tangent: ArrayLike<number>, normal: ArrayLike<number>, scale: number | undefined,
    p: ArrayLike<number>, out: Float32Array, o: number): void {
    const x = [tangent[0], tangent[1], tangent[2]]
    const y = normalize3(cross3(normal, tangent))
    const z = [normal[0], normal[1], normal[2]]
    if (scale !== undefined) {
        for (let k = 0; k < 3; k++) {
            x[k] = f32(x[k] * scale)
            y[k] = f32(y[k] * scale)
            z[k] = f32(z[k] * scale)
        }
    }
    for (let k = 0; k < 3; k++) {
        let r = 0
        r = f32(r + f32(p[0] * x[k]))
        r = f32(r + f32(p[1] * y[k]))
        r = f32(r + f32(p[2] * z[k]))
        out[o + k] = f32(r + location[k])
    }
}

interface ResultOffsets {
    total: number
    vert: Int32Array
    edge: Int32Array
    loop: Int32Array
    face: Int32Array
    mainIndices: Int32Array
    profileIndices: Int32Array
}

interface Combination {
    iMain: number
    iProfile: number
    mainPoints: [number, number]
    profilePoints: [number, number]
    mainCyclic: boolean
    profileCyclic: boolean
    mainSegmentNum: number
    profileSegmentNum: number
    vertStart: number
    edgeStart: number
    faceStart: number
    loopStart: number
}

/** `curve_to_mesh_sweep` (:842). `scales` is the Scale field on the main curves' points (`undefined` for none). */
export function curveToMeshSweep(main: CurvesGeometry, profile: CurvesGeometry, scales: GVArray | undefined, fillCaps: boolean): MeshData | undefined {
    const mainEval = new CurvesEvaluator(main)
    const profileEval = new CurvesEvaluator(profile)
    const mainCyclic = mainEval.cyclic, profileCyclic = profileEval.cyclic
    const mainOffsets = mainEval.evaluatedOffsets, profileOffsets = profileEval.evaluatedOffsets
    const mc = main.curvesNum, pc = profile.curvesNum

    // `calculate_result_offsets` (:265).
    const total = mc * pc
    const offsets: ResultOffsets = {
        total, vert: new Int32Array(total + 1), edge: new Int32Array(total + 1), loop: new Int32Array(total + 1), face: new Int32Array(total + 1),
        mainIndices: new Int32Array(total), profileIndices: new Int32Array(total),
    }
    {
        let meshIndex = 0, vertOffset = 0, edgeOffset = 0, loopOffset = 0, faceOffset = 0
        for (let iMain = 0; iMain < mc; iMain++) {
            const cyclic = !!mainCyclic[iMain]
            const mainPointNum = mainOffsets[iMain + 1] - mainOffsets[iMain]
            const mainSegmentNum = segmentsNumNoDuplicateEdge(mainPointNum, cyclic)
            for (let iProfile = 0; iProfile < pc; iProfile++) {
                offsets.vert[meshIndex] = vertOffset
                offsets.edge[meshIndex] = edgeOffset
                offsets.loop[meshIndex] = loopOffset
                offsets.face[meshIndex] = faceOffset
                const pCyclic = !!profileCyclic[iProfile]
                const profilePointNum = profileOffsets[iProfile + 1] - profileOffsets[iProfile]
                if (profilePointNum === 0) continue
                const profileSegmentNum = segmentsNum(profilePointNum, pCyclic)
                const caps = fillCaps && hasCaps(cyclic, pCyclic, profileSegmentNum)
                const tubeFaceNum = mainSegmentNum * profileSegmentNum
                vertOffset += mainPointNum * profilePointNum
                edgeOffset += mainPointNum * profileSegmentNum + mainSegmentNum * profilePointNum
                faceOffset += tubeFaceNum + (caps ? 2 : 0)
                loopOffset += tubeFaceNum * 4 + (caps ? profileSegmentNum * 2 : 0)
                meshIndex++
            }
        }
        offsets.vert[total] = vertOffset
        offsets.edge[total] = edgeOffset
        offsets.loop[total] = loopOffset
        offsets.face[total] = faceOffset
        let i = 0
        for (let iMain = 0; iMain < mc; iMain++) {
            for (let iProfile = 0; iProfile < pc; iProfile++) {
                offsets.mainIndices[i] = iMain
                offsets.profileIndices[i] = iProfile
                i++
            }
        }
    }
    if (offsets.vert[total] === 0) return undefined

    // `foreach_curve_combination` (:438).
    const combinations: Combination[] = []
    for (let i = 0; i < total; i++) {
        const iMain = offsets.mainIndices[i], iProfile = offsets.profileIndices[i]
        const mainPoints: [number, number] = [mainOffsets[iMain], mainOffsets[iMain + 1]]
        const profilePoints: [number, number] = [profileOffsets[iProfile], profileOffsets[iProfile + 1]]
        if (mainPoints[1] === mainPoints[0] || profilePoints[1] === profilePoints[0]) continue
        const mCyc = !!mainCyclic[iMain], pCyc = !!profileCyclic[iProfile]
        combinations.push({
            iMain, iProfile, mainPoints, profilePoints, mainCyclic: mCyc, profileCyclic: pCyc,
            mainSegmentNum: segmentsNum(mainPoints[1] - mainPoints[0], mCyc), profileSegmentNum: segmentsNum(profilePoints[1] - profilePoints[0], pCyc),
            vertStart: offsets.vert[i], edgeStart: offsets.edge[i], faceStart: offsets.face[i], loopStart: offsets.loop[i],
        })
    }

    const mesh = newMesh(offsets.vert[total], offsets.edge[total], offsets.face[total], offsets.loop[total])
    const faceOffsets = mesh.faceOffsets
    faceOffsets[mesh.facesNum] = mesh.cornersNum
    for (const c of combinations) {
        fillMeshTopology(c.vertStart, c.edgeStart, c.faceStart, c.loopStart, c.mainPoints[1] - c.mainPoints[0], c.profilePoints[1] - c.profilePoints[0],
            c.mainCyclic, c.profileCyclic, fillCaps, mesh.edgeVerts, mesh.cornerVerts, mesh.cornerEdges, faceOffsets)
    }
    const meshAttributes = new MeshAccessor(mesh)

    if (fillCaps) {
        if (!meshAttributes.contains('sharp_face')) meshAttributes.add('sharp_face', AttrDomain.Face, 'bool')
        const sharpFaces = mesh.attributes.get('sharp_face')!.data
        for (const c of combinations) {
            if (hasCaps(c.mainCyclic, c.profileCyclic, c.profileSegmentNum)) {
                const capFaceOffset = c.faceStart + c.mainSegmentNum * c.profileSegmentNum
                sharpFaces[capFaceOffset] = 1
                sharpFaces[capFaceOffset + 1] = 1
            }
        }
    }

    buildMeshPositions(main, mainEval, profileEval, combinations, scales, mesh)

    // `write_sharp_bezier_edges` (:793).
    let sharpEdges: TypedArray | undefined
    const profileTypes = profileEval.types
    if (Array.prototype.some.call(profileTypes, (t: number) => t === CURVE_TYPE_BEZIER)) {
        const htl = curvesAttributeOr(profile, 'handle_type_left', profile.pointsNum, 0)
        const htr = curvesAttributeOr(profile, 'handle_type_right', profile.pointsNum, 0)
        const has = (a: ArrayLike<number>) => Array.prototype.some.call(a, (t: number) => t === BEZIER_HANDLE_VECTOR)
        if (has(htl) || has(htr)) {
            if (!meshAttributes.contains('sharp_edge')) meshAttributes.add('sharp_edge', AttrDomain.Edge, 'bool')
            sharpEdges = mesh.attributes.get('sharp_edge')!.data
            for (const c of combinations) {
                if (profileTypes[c.iProfile] !== CURVE_TYPE_BEZIER) continue
                const [s, e] = profile.pointsRange(c.iProfile)
                const l = Array.prototype.slice.call(htl, s, e) as number[], r = Array.prototype.slice.call(htr, s, e) as number[]
                const controlPointOffsets = profileEval.bezierOffsets(c.iProfile)
                // `mark_bezier_vector_edges_sharp` (:162).
                if (pointIsSharp(l, r, 0)) sharpEdges.fill(1, c.edgeStart, c.edgeStart + c.mainSegmentNum)
                for (let i = 1; i < e - s; i++) {
                    if (pointIsSharp(l, r, i)) {
                        const o = c.edgeStart + c.mainSegmentNum * controlPointOffsets[i]
                        sharpEdges.fill(1, o, o + c.mainSegmentNum)
                    }
                }
            }
        }
    }
    if (fillCaps) {
        if (!sharpEdges) {
            if (!meshAttributes.contains('sharp_edge')) meshAttributes.add('sharp_edge', AttrDomain.Edge, 'bool')
            sharpEdges = mesh.attributes.get('sharp_edge')!.data
        }
        for (const c of combinations) {
            if (c.mainCyclic || !c.profileCyclic) continue
            const profilePointNum = c.profilePoints[1] - c.profilePoints[0]
            const profileEdgesStart = c.edgeStart + profilePointNum * c.mainSegmentNum
            const lastRingEdgeOffset = profileEdgesStart + c.profileSegmentNum * (c.mainPoints[1] - c.mainPoints[0] - 1)
            sharpEdges.fill(1, profileEdgesStart, profileEdgesStart + c.profileSegmentNum)
            sharpEdges.fill(1, lastRingEdgeOffset, lastRingEdgeOffset + c.profileSegmentNum)
        }
    }

    const mainAttributes = main.accessor()
    for (const name of mainAttributes.names()) {
        const meta = mainAttributes.lookupMeta(name)!
        if (!shouldAddAttributeToMesh(mainAttributes.isBuiltin(name), meshAttributes, name)) continue
        const dstDomain = attributeDomainForMesh(meshAttributes, name)
        const src = mainAttributes.lookup(name)!
        if (meta.domain === AttrDomain.Point) {
            copyMainPointDomainAttribute(main, mainEval, combinations, name, meta.type, dstDomain, src, mesh, meshAttributes)
        } else if (meta.domain === AttrDomain.Curve) {
            const dst = lookupOrAdd(meshAttributes, name, dstDomain, meta.type)
            if (dst) copyCurveDomainAttribute(offsets, offsets.mainIndices, dstDomain, src, dst)
        }
    }

    const profileAttributes = profile.accessor()
    for (const name of profileAttributes.names()) {
        if (mainAttributes.contains(name)) continue
        const meta = profileAttributes.lookupMeta(name)!
        if (!shouldAddAttributeToMesh(profileAttributes.isBuiltin(name), meshAttributes, name)) continue
        const dstDomain = attributeDomainForMesh(meshAttributes, name)
        const src = profileAttributes.lookup(name)!
        const dst = lookupOrAdd(meshAttributes, name, dstDomain, meta.type)
        if (!dst) continue
        const c = DATA_TYPES[meta.type].components
        if (meta.domain === AttrDomain.Point) {
            const all = evaluateAttribute(profile, profileEval, meta.type, src)
            for (const cb of combinations) {
                const pn = cb.profilePoints[1] - cb.profilePoints[0]
                const copy = (s: number, d: number) => { for (let k = 0; k < c; k++) dst[d * c + k] = all[s * c + k] }
                if (dstDomain === AttrDomain.Point) {
                    // `copy_profile_point_data_to_mesh_verts` (:665).
                    for (let iRing = 0; iRing < cb.mainPoints[1] - cb.mainPoints[0]; iRing++) {
                        for (let i = 0; i < pn; i++) copy(cb.profilePoints[0] + i, cb.vertStart + iRing * pn + i)
                    }
                } else if (dstDomain === AttrDomain.Edge) {
                    // `copy_profile_point_data_to_mesh_edges` (:678).
                    for (let i = 0; i < pn; i++) for (let j = 0; j < cb.mainSegmentNum; j++) copy(cb.profilePoints[0] + i, cb.edgeStart + i * cb.mainSegmentNum + j)
                } else if (dstDomain === AttrDomain.Face) {
                    // `copy_profile_point_data_to_mesh_faces` (:690).
                    for (let iRing = 0; iRing < cb.mainSegmentNum; iRing++) {
                        for (let i = 0; i < cb.profileSegmentNum; i++) copy(cb.profilePoints[0] + i, cb.faceStart + iRing * cb.profileSegmentNum + i)
                    }
                }
            }
        } else if (meta.domain === AttrDomain.Curve) {
            copyCurveDomainAttribute(offsets, offsets.profileIndices, dstDomain, src, dst)
        }
    }
    mesh.materials = []
    return mesh
}

/** `should_add_attribute_to_mesh` (:369). */
function shouldAddAttributeToMesh(curveBuiltin: boolean, meshAttributes: MeshAccessor, name: string): boolean {
    if (name === 'position' || name === '.edge_verts' || name === '.corner_vert' || name === '.corner_edge') return false
    if (name === 'custom_normal') return false
    if (curveBuiltin && !meshAttributes.isBuiltin(name)) return false
    return true
}

/** `get_attribute_domain_for_mesh` (:356): a built-in's domain when it already exists on the mesh, else points. */
function attributeDomainForMesh(meshAttributes: MeshAccessor, name: string): AttrDomain {
    if (!meshAttributes.isBuiltin(name)) return AttrDomain.Point
    const meta = meshAttributes.lookupMeta(name)
    if (!meta) return AttrDomain.Point
    return meta.domain
}

/** `lookup_or_add_for_write_only_span` (`attribute_access.cc:540`): the layer's data, or undefined when it fails. */
function lookupOrAdd(acc: MeshAccessor, name: string, domain: AttrDomain, type: DataType): TypedArray | undefined {
    const meta = acc.lookupMeta(name)
    if (meta) return meta.domain === domain && meta.type === type ? acc.layerForWrite(name)!.data : undefined
    if (!acc.add(name, domain, type)) return undefined
    return acc.layerForWrite(name)!.data
}

/** `evaluate_attribute` (:395): point values on every evaluated point. */
function evaluateAttribute(curves: CurvesGeometry, ev: CurvesEvaluator, type: DataType, src: GVArray): TypedArray {
    const c = DATA_TYPES[type].components
    const values = src.materialize()
    const out = new DATA_TYPES[type].array(ev.evaluatedPointsNum * c)
    for (let i = 0; i < curves.curvesNum; i++) {
        const [s, e] = curves.pointsRange(i)
        const [es, ee] = ev.evaluatedRange(i)
        ev.interpolateToEvaluated(i, type, values.subarray(s * c, e * c), out.subarray(es * c, ee * c))
    }
    return out
}

/** `build_mesh_positions` (:479). */
function buildMeshPositions(main: CurvesGeometry, mainEval: CurvesEvaluator, profileEval: CurvesEvaluator, combinations: Combination[],
    scales: GVArray | undefined, mesh: MeshData): void {
    const profilePositions = profileEval.positions
    const ignoreProfilePosition = profilePositions.length === 3 && profilePositions[0] === 0 && profilePositions[1] === 0 && profilePositions[2] === 0
    const positions = mesh.positions
    if (ignoreProfilePosition) {
        const hasNurbs = Array.prototype.some.call(mainEval.types, (t: number) => t === CURVE_TYPE_NURBS)
        if (mesh.vertsNum === main.pointsNum && !hasNurbs) {
            // Shares the control point positions.
            positions.set(main.positions)
            return
        }
        positions.set(mainEval.positions)
        return
    }
    const mainPositions = mainEval.positions
    const tangents = mainEval.tangents
    const normals = mainEval.normals
    let evalScales: TypedArray | undefined
    if (scales && !(scales.isSingle && scales.single[0] === 1)) evalScales = evaluateAttribute(main, mainEval, 'float', scales)
    for (const c of combinations) {
        const pn = c.profilePoints[1] - c.profilePoints[0]
        for (let iRing = 0; iRing < c.mainPoints[1] - c.mainPoints[0]; iRing++) {
            const m = c.mainPoints[0] + iRing
            const v = (a: Float32Array, i: number) => a.subarray(i * 3, i * 3 + 3)
            // `build_point_matrix(main_positions[i], normals[i], tangents[i])`: the normal is passed as the tangent.
            const scale = evalScales ? evalScales[m] : undefined
            for (let i = 0; i < pn; i++) {
                transformProfilePoint(v(mainPositions, m), v(normals, m), v(tangents, m), scale, v(profilePositions, c.profilePoints[0] + i),
                    positions, (c.vertStart + iRing * pn + i) * 3)
            }
        }
    }
}

/** `copy_main_point_domain_attribute_to_mesh` (:600). */
function copyMainPointDomainAttribute(main: CurvesGeometry, mainEval: CurvesEvaluator, combinations: Combination[], name: string, type: DataType,
    dstDomain: AttrDomain, src: GVArray, mesh: MeshData, meshAttributes: MeshAccessor): void {
    const c = DATA_TYPES[type].components
    if (dstDomain === AttrDomain.Point) {
        // `try_sharing_point_data` (:566).
        if (mesh.vertsNum === main.pointsNum && meshAttributes.add(name, AttrDomain.Point, type, src.materialize().slice())) return
    }
    const dst = lookupOrAdd(meshAttributes, name, dstDomain, type)
    if (!dst) return
    if (dstDomain === AttrDomain.Point && dst.length / c === mainEval.evaluatedPointsNum) {
        // `try_direct_evaluate_point_data` (:584).
        dst.set(evaluateAttribute(main, mainEval, type, src))
        return
    }
    const all = evaluateAttribute(main, mainEval, type, src)
    const copy = (s: number, d: number) => { for (let k = 0; k < c; k++) dst[d * c + k] = all[s * c + k] }
    for (const cb of combinations) {
        const pn = cb.profilePoints[1] - cb.profilePoints[0]
        const mn = cb.mainPoints[1] - cb.mainPoints[0]
        if (dstDomain === AttrDomain.Point) {
            // `copy_main_point_data_to_mesh_verts` (:536).
            for (let iRing = 0; iRing < mn; iRing++) for (let i = 0; i < pn; i++) copy(cb.mainPoints[0] + iRing, cb.vertStart + iRing * pn + i)
        } else if (dstDomain === AttrDomain.Edge) {
            // `copy_main_point_data_to_mesh_edges` (:547).
            const edgesStart = pn * cb.mainSegmentNum
            for (let iRing = 0; iRing < mn; iRing++) {
                for (let i = 0; i < cb.profileSegmentNum; i++) copy(cb.mainPoints[0] + iRing, cb.edgeStart + edgesStart + cb.profileSegmentNum * iRing + i)
            }
        } else if (dstDomain === AttrDomain.Face) {
            // `copy_main_point_data_to_mesh_faces` (:561).
            for (let iRing = 0; iRing < cb.mainSegmentNum; iRing++) {
                for (let i = 0; i < cb.profileSegmentNum; i++) copy(cb.mainPoints[0] + iRing, cb.faceStart + cb.profileSegmentNum * iRing + i)
            }
        }
    }
}

/** `copy_curve_domain_attribute_to_mesh` (:762) via `copy_indices_to_offset_ranges` (:745). */
function copyCurveDomainAttribute(offsets: ResultOffsets, curveIndices: Int32Array, dstDomain: AttrDomain, src: GVArray, dst: TypedArray): void {
    const o = dstDomain === AttrDomain.Point ? offsets.vert : dstDomain === AttrDomain.Edge ? offsets.edge
        : dstDomain === AttrDomain.Face ? offsets.face : offsets.loop
    const c = DATA_TYPES[src.type].components
    for (let i = 0; i < curveIndices.length; i++) {
        for (let d = o[i]; d < o[i + 1]; d++) for (let k = 0; k < c; k++) dst[d * c + k] = src.get(curveIndices[i], k)
    }
}

/** `get_curve_single_vert` (:1018). */
function curveSingleVert(): CurvesGeometry {
    const curves = new CurvesGeometry(1, 1)
    curves.curveOffsets[1] = 1
    fillCurveTypes(curves, CURVE_TYPE_POLY)
    return curves
}

/** `curve_to_wire_mesh` (:1028). */
export function curveToWireMesh(curves: CurvesGeometry): MeshData | undefined {
    return curveToMeshSweep(curves, curveSingleVert(), undefined, false)
}
