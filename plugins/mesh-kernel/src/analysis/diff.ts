/**
 * Edit locality: what changed between two snapshots of a mesh, split into what the edit *claimed* and
 * the *collateral* - everything else that changed.
 *
 * The 2025-26 editing benchmarks agree that the dominant failure of an agent's edit is not the target
 * edit but damage elsewhere (BenchCAD: about 64% of nominally successful edits corrupt unrelated
 * features; EditHero scores edit chains on how well unedited parts survive). A render does not show
 * that; this does.
 *
 * Elements are matched by geometry, not by index, because nearly every topology operator renumbers:
 * a vertex is "kept" when a vertex at the same position (within `tolerance`) exists after; a face when a
 * face over the same positions, in the same winding, exists after; an edge likewise. Matching is a
 * multiset match in ascending index order, so it is deterministic. Index changes of kept elements are
 * reported separately (`renumbered`), since an agent holding indices from an earlier `inspect` needs to
 * know they went stale even when the geometry did not move.
 *
 * Attribute layers are compared on the matched elements: a UV layer that silently lost values on faces
 * the edit never touched is collateral damage too, and a layer that disappeared is reported as removed.
 */

import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, attrDomainName, ATTR_TYPE_INFO} from '../constants'

export interface DiffSelection {
    verts?: ArrayLike<number>
    edges?: ArrayLike<number>
    faces?: ArrayLike<number>
}

export interface MeshDiffOptions {
    /**
     * What the edit said it would change, as indices into `before`. `'all'` (the default) claims the
     * whole mesh - nothing can be collateral; `'none'` claims nothing - every change is collateral.
     * A selection is grown by one ring: faces using any claimed vertex are claimed, because every local
     * operator (extrude, bevel, inset, ...) rewrites the faces around what it was given.
     */
    claim?: DiffSelection | 'all' | 'none'
    /** How many rings to grow a selection claim by: 1 (default) or 0 for exactly what was given. */
    ring?: 0 | 1
    /** Position tolerance for matching. Default `1e-6` times the larger bounding-box diagonal (min 1e-6). */
    tolerance?: number
    /** Cap on index lists in the result. Default 200. */
    listLimit?: number
}

export interface ElementDiff {
    before: number
    after: number
    /** Elements of `before` with an identical counterpart in `after`. */
    kept: number
    /** Elements of `before` with no counterpart: deleted, moved or reshaped. */
    removed: number
    /** Elements of `after` with no counterpart in `before`. */
    added: number
    /** Kept elements whose index changed. */
    renumbered: number
}

export interface LayerDiff {
    name: string
    domain: string
    type: string
    status: 'unchanged' | 'changed' | 'added' | 'removed' | 'retyped'
    /** Matched elements whose value differs. */
    changed: number
    /** Of those, the ones outside the claim. */
    collateral: number
}

export interface MeshDiff {
    identical: boolean
    /** No collateral geometry change, no collateral layer change, no removed layer. */
    local: boolean
    verts: ElementDiff
    edges: ElementDiff
    faces: ElementDiff
    claimed: {all: boolean, verts: number, faces: number}
    /** Changed elements of `before` outside the claim. `verts` / `faces` list indices (capped). */
    collateral: {verts: number[], faces: number[], vertCount: number, faceCount: number}
    layers: LayerDiff[]
    tolerance: number
}

function diag(mesh: MeshData): number {
    const p = mesh.positions
    if (!mesh.vertsNum) return 0
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < mesh.vertsNum; i++) {
        for (let k = 0; k < 3; k++) {
            const v = p[i * 3 + k]
            if (v < min[k]) min[k] = v
            if (v > max[k]) max[k] = v
        }
    }
    return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
}

function vertKeys(mesh: MeshData, tol: number): string[] {
    const p = mesh.positions
    const out = new Array<string>(mesh.vertsNum)
    for (let i = 0; i < mesh.vertsNum; i++) {
        // `+ 0` folds -0 into 0, so a coordinate that rounds to zero has one key.
        out[i] = `${Math.round(p[i * 3] / tol) + 0},${Math.round(p[i * 3 + 1] / tol) + 0},${Math.round(p[i * 3 + 2] / tol) + 0}`
    }
    return out
}

/** A face's key: its vertex keys from the smallest, in winding order. Also returns that rotation. */
function faceKey(mesh: MeshData, f: number, vk: string[]): {key: string, rot: number} {
    const start = mesh.faceOffsets[f]
    const n = mesh.faceOffsets[f + 1] - start
    const cv = mesh.cornerVerts
    let rot = 0
    for (let k = 1; k < n; k++) if (vk[cv[start + k]] < vk[cv[start + rot]]) rot = k
    const parts: string[] = []
    for (let k = 0; k < n; k++) parts.push(vk[cv[start + (k + rot) % n]])
    return {key: parts.join('|'), rot}
}

function edgeKey(mesh: MeshData, e: number, vk: string[]): string {
    const a = vk[mesh.edgeVerts[e * 2]]
    const b = vk[mesh.edgeVerts[e * 2 + 1]]
    return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Multiset match of `before` keys into `after` keys, lowest indices first. `-1` for no match. */
function match(before: string[], after: string[]): Int32Array {
    const pool = new Map<string, number[]>()
    for (let i = 0; i < after.length; i++) {
        const list = pool.get(after[i])
        if (list) list.push(i)
        else pool.set(after[i], [i])
    }
    const out = new Int32Array(before.length).fill(-1)
    const cursor = new Map<string, number>()
    for (let i = 0; i < before.length; i++) {
        const list = pool.get(before[i])
        if (!list) continue
        const c = cursor.get(before[i]) ?? 0
        if (c < list.length) {
            out[i] = list[c]
            cursor.set(before[i], c + 1)
        }
    }
    return out
}

function elementDiff(m: Int32Array, afterCount: number): ElementDiff {
    let kept = 0
    let renumbered = 0
    for (let i = 0; i < m.length; i++) {
        if (m[i] < 0) continue
        kept++
        if (m[i] !== i) renumbered++
    }
    return {before: m.length, after: afterCount, kept, removed: m.length - kept, added: afterCount - kept, renumbered}
}

/**
 * Compare two snapshots of one mesh. `before` and `after` are not modified.
 *
 * ```ts
 * const before = mesh.clone()
 * extrudeFaces(mesh, [3])
 * const d = diffMeshData(before, mesh, {claim: {faces: [3]}})
 * d.local          // true when nothing outside face 3's neighbourhood changed
 * ```
 */
export function diffMeshData(before: MeshData, after: MeshData, options: MeshDiffOptions = {}): MeshDiff {
    const tol = options.tolerance ?? Math.max(1e-6, 1e-6 * Math.max(diag(before), diag(after)))
    const limit = options.listLimit ?? 200
    const vkB = vertKeys(before, tol)
    const vkA = vertKeys(after, tol)
    const vMatch = match(vkB, vkA)

    const fkB = Array.from({length: before.facesNum}, (_, f) => faceKey(before, f, vkB))
    const fkA = Array.from({length: after.facesNum}, (_, f) => faceKey(after, f, vkA))
    const fMatch = match(fkB.map(k => k.key), fkA.map(k => k.key))

    const ekB = Array.from({length: before.edgesNum}, (_, e) => edgeKey(before, e, vkB))
    const ekA = Array.from({length: after.edgesNum}, (_, e) => edgeKey(after, e, vkA))
    const eMatch = match(ekB, ekA)

    // --- the claim, grown by one ring --------------------------------------------------------
    const claim = options.claim ?? 'all'
    const all = claim === 'all'
    const claimedVert = new Uint8Array(before.vertsNum)
    const claimedFace = new Uint8Array(before.facesNum)
    if (all) {
        claimedVert.fill(1)
        claimedFace.fill(1)
    } else if (claim !== 'none') {
        const seed = new Uint8Array(before.vertsNum)
        const mark = (v: number) => {
            if (v >= 0 && v < before.vertsNum) seed[v] = 1
        }
        for (const v of Array.from(claim.verts ?? [])) mark(v)
        for (const e of Array.from(claim.edges ?? [])) {
            if (e < 0 || e >= before.edgesNum) continue
            mark(before.edgeVerts[e * 2])
            mark(before.edgeVerts[e * 2 + 1])
        }
        for (const f of Array.from(claim.faces ?? [])) {
            if (f < 0 || f >= before.facesNum) continue
            claimedFace[f] = 1
            for (const v of before.faceVerts(f)) mark(v)
        }
        for (let f = 0; f < before.facesNum && options.ring !== 0; f++) {
            if (claimedFace[f]) continue
            const start = before.faceOffsets[f]
            const end = before.faceOffsets[f + 1]
            for (let c = start; c < end; c++) {
                if (seed[before.cornerVerts[c]]) {
                    claimedFace[f] = 1
                    break
                }
            }
        }
        for (let v = 0; v < before.vertsNum; v++) if (seed[v]) claimedVert[v] = 1
        for (let f = 0; f < before.facesNum; f++) {
            if (!claimedFace[f]) continue
            for (const v of before.faceVerts(f)) claimedVert[v] = 1
        }
    }
    let claimedVerts = 0
    let claimedFaces = 0
    for (let v = 0; v < before.vertsNum; v++) claimedVerts += claimedVert[v]
    for (let f = 0; f < before.facesNum; f++) claimedFaces += claimedFace[f]

    // --- collateral geometry -----------------------------------------------------------------
    const collateralVerts: number[] = []
    const collateralFaces: number[] = []
    let collateralVertCount = 0
    let collateralFaceCount = 0
    for (let v = 0; v < before.vertsNum; v++) {
        if (vMatch[v] >= 0 || claimedVert[v]) continue
        collateralVertCount++
        if (collateralVerts.length < limit) collateralVerts.push(v)
    }
    for (let f = 0; f < before.facesNum; f++) {
        if (fMatch[f] >= 0 || claimedFace[f]) continue
        collateralFaceCount++
        if (collateralFaces.length < limit) collateralFaces.push(f)
    }

    // --- attribute layers --------------------------------------------------------------------
    const userLayer = (name: string) => !name.startsWith('.') && name !== AttrName.position
    const layersB = new Map(before.attributes.layers().filter(l => userLayer(l.name)).map(l => [l.name, l]))
    const layersA = new Map(after.attributes.layers().filter(l => userLayer(l.name)).map(l => [l.name, l]))
    const layers: LayerDiff[] = []
    const names = [...new Set([...layersB.keys(), ...layersA.keys()])].sort()
    for (const name of names) {
        const lb = layersB.get(name)
        const la = layersA.get(name)
        const ref = (lb ?? la)!
        const base = {name, domain: attrDomainName(ref.domain), type: ref.type, changed: 0, collateral: 0}
        if (!lb) {
            layers.push({...base, status: 'added'})
            continue
        }
        if (!la) {
            // Every element that carried a value lost it.
            const count = before.attributes.domainSizes[lb.domain]
            layers.push({...base, status: 'removed', changed: count, collateral: all ? 0 : count})
            continue
        }
        if (la.domain !== lb.domain || la.type !== lb.type) {
            layers.push({...base, status: 'retyped'})
            continue
        }
        const comps = ATTR_TYPE_INFO[lb.type].components
        const differs = (ib: number, ia: number) => {
            for (let k = 0; k < comps; k++) {
                if (Math.abs(lb.data[ib * comps + k] - la.data[ia * comps + k]) > 1e-6) return true
            }
            return false
        }
        let changed = 0
        let collateral = 0
        const note = (isClaimed: boolean) => {
            changed++
            if (!isClaimed) collateral++
        }
        if (lb.domain === AttrDomain.Point) {
            for (let v = 0; v < before.vertsNum; v++) {
                if (vMatch[v] >= 0 && differs(v, vMatch[v])) note(!!claimedVert[v])
            }
        } else if (lb.domain === AttrDomain.Edge) {
            for (let e = 0; e < before.edgesNum; e++) {
                if (eMatch[e] < 0 || !differs(e, eMatch[e])) continue
                note(!!(claimedVert[before.edgeVerts[e * 2]] || claimedVert[before.edgeVerts[e * 2 + 1]]))
            }
        } else if (lb.domain === AttrDomain.Face) {
            for (let f = 0; f < before.facesNum; f++) {
                if (fMatch[f] >= 0 && differs(f, fMatch[f])) note(!!claimedFace[f])
            }
        } else {
            for (let f = 0; f < before.facesNum; f++) {
                const g = fMatch[f]
                if (g < 0) continue
                const sb = before.faceOffsets[f]
                const n = before.faceOffsets[f + 1] - sb
                const sa = after.faceOffsets[g]
                const rb = fkB[f].rot
                const ra = fkA[g].rot
                for (let k = 0; k < n; k++) {
                    if (differs(sb + (k + rb) % n, sa + (k + ra) % n)) {
                        note(!!claimedFace[f])
                        break
                    }
                }
            }
        }
        layers.push({...base, status: changed ? 'changed' : 'unchanged', changed, collateral})
    }

    const verts = elementDiff(vMatch, after.vertsNum)
    const edges = elementDiff(eMatch, after.edgesNum)
    const faces = elementDiff(fMatch, after.facesNum)
    const identical = verts.removed === 0 && verts.added === 0 && verts.renumbered === 0
        && faces.removed === 0 && faces.added === 0 && faces.renumbered === 0
        && edges.removed === 0 && edges.added === 0 && edges.renumbered === 0
        && layers.every(l => l.status === 'unchanged')
    const local = collateralVertCount === 0 && collateralFaceCount === 0
        && layers.every(l => l.collateral === 0 && l.status !== 'removed' && l.status !== 'retyped')
    return {
        identical,
        local,
        verts, edges, faces,
        claimed: {all, verts: claimedVerts, faces: claimedFaces},
        collateral: {verts: collateralVerts, faces: collateralFaces, vertCount: collateralVertCount, faceCount: collateralFaceCount},
        layers,
        tolerance: tol,
    }
}
