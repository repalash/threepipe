/**
 * Blender's Weighted Normal modifier: a port of `modifiers/intern/MOD_weighted_normal.cc` (Blender 5.2.2).
 *
 * Each vertex (or, with `keepSharp`, each smooth fan) gets a normal that mixes its faces' normals weighted by face
 * area, corner angle, or both; with `weight` above 50 the larger values dominate (the n-th distinct value is
 * divided by `weight^n`), at 50 every face counts the same. The result is stored as custom normals
 * (`custom_normal`, corner `int16x2`), so hard-surface parts shade flat on their big faces and the bevels take
 * the bend.
 *
 * Not ported: the vertex-group filter (`defgrp_name`, `INVERT_VGROUP`), as the kernel has no vertex groups.
 */

import {MeshData} from './MeshData'
import {AttrDomain, AttrName} from './constants'
import {CornerFanSpaces, customNormalsSet, faceNormalsTrue, meshVertNormals, normalsCalcCorners, vertToFaceMap} from './normals'
import {angleNormalizedV3V3} from './math/geom'
import type {Vec3} from './math'

export type WeightedNormalMode = 'FACE_AREA' | 'CORNER_ANGLE' | 'FACE_AREA_WITH_ANGLE'

export interface WeightedNormalOptions {
    /** `mode`. Default `FACE_AREA`. */
    mode?: WeightedNormalMode
    /** `weight`, 1..100. Default 50 (every face equal). */
    weight?: number
    /** `thresh`: values closer than this count as equal. Default 0.01. */
    threshold?: number
    /** `KEEP_SHARP`: mix per smooth fan instead of per vertex. Default false. */
    keepSharp?: boolean
    /** `FACE_INFLUENCE`: only the strongest faces (by `__mod_weightednormals_faceweight`) contribute. Default false. */
    useFaceInfluence?: boolean
}

/** `MOD_WEIGHTEDNORMALS_FACEWEIGHT_CDLAYER_ID` (`DNA_modifier_types.h:2385`), the face strength layer bevel writes. */
export const FACE_WEIGHT_LAYER = '__mod_weightednormals_faceweight'
/** `FACE_STRENGTH_WEAK / MEDIUM / STRONG` (`bmesh_operators.hh:141`). */
export const FACE_STRENGTH = {WEAK: -16384, MEDIUM: 0, STRONG: 16384} as const

const CLNORS_VALID_VEC_LEN = 1e-6
const NUM_CACHED_INVERSE_POWERS_OF_WEIGHT = 128

interface Item { normal: [number, number, number], loopsNum: number, currVal: number, currStrength: number }

/** `face_area_calc` (`mesh_evaluate.cc:67`): half the length of the Newell vector (`area_poly_v3`, `area_tri_v3`). */
function faceArea(mesh: MeshData, f: number): number {
    const P = mesh.positions, CV = mesh.cornerVerts, s = mesh.faceOffsets[f], e = mesh.faceOffsets[f + 1]
    let x = 0, y = 0, z = 0
    if (e - s === 3) {
        const a = CV[s] * 3, b = CV[s + 1] * 3, c = CV[s + 2] * 3
        const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2]
        const vx = P[b] - P[c], vy = P[b + 1] - P[c + 1], vz = P[b + 2] - P[c + 2]
        x = uy * vz - uz * vy; y = uz * vx - ux * vz; z = ux * vy - uy * vx
    } else {
        let prev = CV[e - 1] * 3
        for (let k = s; k < e; k++) {
            const cur = CV[k] * 3
            x += (P[prev + 1] - P[cur + 1]) * (P[prev + 2] + P[cur + 2])
            y += (P[prev + 2] - P[cur + 2]) * (P[prev] + P[cur])
            z += (P[prev] - P[cur]) * (P[prev + 1] + P[cur + 1])
            prev = cur
        }
    }
    return Math.hypot(x, y, z) * 0.5
}

/** `face_angles_calc` (`mesh_evaluate.cc:201`): the interior angle at each corner. */
function faceAngles(mesh: MeshData, f: number, out: number[]): void {
    const P = mesh.positions, CV = mesh.cornerVerts, s = mesh.faceOffsets[f], n = mesh.faceOffsets[f + 1] - s
    const p = (i: number): Vec3 => [P[3 * CV[s + i]], P[3 * CV[s + i] + 1], P[3 * CV[s + i] + 2]]
    const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-35 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0] }
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    let iThis = n - 1, iNext = 0
    let norPrev = norm(sub(p(iThis - 1), p(iThis)))
    out.length = n
    while (iNext < n) {
        const norNext = norm(sub(p(iThis), p(iNext)))
        out[iThis] = angleNormalizedV3V3(norPrev, norNext)
        norPrev = norNext
        iThis = iNext
        iNext++
    }
}

/**
 * `modify_mesh` (`MOD_weighted_normal.cc:466`): a copy of `mesh` with weighted custom normals (and the sharp edges
 * the custom-normal encoding adds).
 */
export function weightedNormal(mesh: MeshData, options: WeightedNormalOptions = {}): MeshData {
    const result = mesh.clone()
    const mode = options.mode ?? 'FACE_AREA'
    const wInt = Math.round(options.weight ?? 50)
    const thresh = options.threshold ?? 0.01
    const keepSharp = options.keepSharp ?? false
    let weight = wInt / 50
    if (wInt === 100) weight = 32767
    else if (wInt === 1) weight = 1 / 32767
    else if ((weight - 1) * 25 > 1) weight = (weight - 1) * 25

    const sharpEdges = result.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
    const existing = result.attributes.get(AttrName.customNormal)
    if (existing && !(existing.domain === AttrDomain.Corner && existing.type === 'int16x2')) result.attributes.remove(AttrName.customNormal)
    const clnors = result.attributes.ensure(AttrName.customNormal, AttrDomain.Corner, 'int16x2').data as Int16Array
    const map = vertToFaceMap(result)
    const vertNormals = meshVertNormals(mesh)
    const faceNormals = faceNormalsTrue(mesh)
    const sharpFaces = result.attributes.get(AttrName.sharpFace)?.data ?? null
    const strength = result.attributes.get(FACE_WEIGHT_LAYER)
    const faceStrength = strength && strength.domain === AttrDomain.Face ? strength.data : null
    const useFaceInfluence = (options.useFaceInfluence ?? false) && !!faceStrength

    const cornerFace = new Int32Array(result.cornersNum)
    for (let f = 0; f < result.facesNum; f++) for (let c = result.faceOffsets[f]; c < result.faceOffsets[f + 1]; c++) cornerFace[c] = f

    // mode values, sorted in decreasing order (wn_face_area / wn_corner_angle / wn_face_with_angle)
    const pairs: {val: number, index: number}[] = []
    const angles: number[] = []
    if (mode === 'FACE_AREA') {
        for (let f = 0; f < result.facesNum; f++) pairs.push({val: faceArea(result, f), index: f})
    } else {
        for (let f = 0; f < result.facesNum; f++) {
            const area = mode === 'FACE_AREA_WITH_ANGLE' ? faceArea(result, f) : 1
            faceAngles(result, f, angles)
            for (let k = 0; k < angles.length; k++) {
                const val = Math.PI - angles[k]
                pairs.push({val: mode === 'FACE_AREA_WITH_ANGLE' ? val * area : val, index: result.faceOffsets[f] + k})
            }
        }
    }
    pairs.sort((a, b) => (a.val < b.val ? 1 : a.val > b.val ? -1 : 0))

    // apply_weights_vertex_normal (:166)
    const spaces: CornerFanSpaces = {spaces: [], cornerSpace: new Int32Array(0), cornersBySpace: []}
    let cornerNormals: Float32Array | null = null
    let items: Item[]
    const newItem = (): Item => ({normal: [0, 0, 0], loopsNum: 0, currVal: 0, currStrength: FACE_STRENGTH.WEAK})
    if (keepSharp) {
        cornerNormals = new Float32Array(result.cornersNum * 3)
        normalsCalcCorners(result, faceNormals, sharpEdges, sharpFaces, clnors, spaces, cornerNormals, map)
        items = spaces.spaces.map(newItem)
    } else {
        items = Array.from({length: result.vertsNum}, newItem)
    }
    const inversePowers = new Float64Array(NUM_CACHED_INVERSE_POWERS_OF_WEIGHT)
    const aggregate = (item: Item, face: number, currVal: number) => {
        if (useFaceInfluence) {
            // check_item_face_strength (:97)
            const s = faceStrength![face]
            if (s > item.currStrength) { item.currStrength = s; item.currVal = 0; item.loopsNum = 0; item.normal = [0, 0, 0] }
            if (s !== item.currStrength) return
        }
        if (item.currVal === 0) item.currVal = currVal
        if (!(Math.abs(item.currVal - currVal) <= thresh)) { item.loopsNum++; item.currVal = currVal }
        const n = item.loopsNum
        let inv: number
        if (n < NUM_CACHED_INVERSE_POWERS_OF_WEIGHT) {
            if (inversePowers[n] === 0) inversePowers[n] = 1 / Math.pow(weight, n)
            inv = inversePowers[n]
        } else {
            inv = 1 / Math.pow(weight, n)
        }
        const k = currVal * inv
        item.normal[0] += faceNormals[3 * face] * k
        item.normal[1] += faceNormals[3 * face + 1] * k
        item.normal[2] += faceNormals[3 * face + 2] * k
    }
    const itemOf = (corner: number) => (keepSharp ? items[spaces.cornerSpace[corner]] : items[result.cornerVerts[corner]])
    if (mode === 'FACE_AREA') {
        for (const {val, index: f} of pairs) {
            for (let c = result.faceOffsets[f]; c < result.faceOffsets[f + 1]; c++) aggregate(itemOf(c), f, val)
        }
    } else {
        for (const {val, index: c} of pairs) aggregate(itemOf(c), cornerFace[c], val)
    }
    for (const item of items) {
        const l = Math.hypot(item.normal[0], item.normal[1], item.normal[2])
        if (l < CLNORS_VALID_VEC_LEN) item.normal = [0, 0, 0]
        else item.normal = [item.normal[0] / l, item.normal[1] / l, item.normal[2] / l]
    }
    const isZero = (v: number[]) => v[0] === 0 && v[1] === 0 && v[2] === 0
    if (keepSharp) {
        for (let c = 0; c < result.cornersNum; c++) {
            const item = items[spaces.cornerSpace[c]]
            if (!isZero(item.normal)) cornerNormals!.set(item.normal, 3 * c)
        }
        customNormalsSet(result, map, vertNormals, faceNormals, sharpFaces, false, cornerNormals!, sharpEdges, clnors)
    } else {
        // no vertex groups: per-vertex normals through normals_corner_custom_set_from_verts
        const vn = new Float32Array(result.vertsNum * 3)
        for (let c = 0; c < result.cornersNum; c++) {
            const v = result.cornerVerts[c]
            vn.set(items[v].normal, 3 * v)
        }
        customNormalsSet(result, map, vertNormals, faceNormals, sharpFaces, true, vn, sharpEdges, clnors)
    }
    return result
}
