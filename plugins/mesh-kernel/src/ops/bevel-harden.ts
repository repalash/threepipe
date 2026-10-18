/**
 * Bevel's normal options: `bevel_harden_normals` (`bmesh_bevel.cc:3006`) and
 * `bevel_set_weighted_normal_face_strength` (`:3135`), Blender 5.2.2.
 *
 * Harden Normals gives each corner of a new bevel face the normal of the flat face it leans on (or the average of
 * two bevel faces along a strip), as custom normals, so a beveled block shades like the hard-surface original with
 * only the bevel bending. Blender encodes each wanted normal in the BMesh's loop normal space
 * (`BM_lnorspace_update`, `BKE_lnor_space_custom_normal_to_data`); here the same encoding runs on the mesh the
 * BMesh converts to, whose fan spaces are the BMesh's (Blender relies on the two agreeing, or custom normals would
 * change when edit mode is left).
 *
 * Face Strength writes `__mod_weightednormals_faceweight` for the Weighted Normal modifier's face influence.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMLoop} from '../bmesh/types'
import {edgeIsManifold} from '../bmesh/structure'
import {AttrName, ElemFlag} from '../constants'
import {bmToMesh} from '../bmesh/convert'
import {setValue} from '../bmesh/customdata'
import {CornerFanSpaces, customNormalToData, faceNormalsTrue, normalsCalcCorners} from '../normals'
import {FACE_STRENGTH, FACE_WEIGHT_LAYER} from '../weightedNormal'
import {BevelParams, FKind, getFaceKind} from './bevel-types'
import {bevelEdgesSharpBoundary} from './bevel-boundary'
import {edgeOtherLoop} from './bevel-bmquery'
import {meshNormalsUpdate} from '../bmesh/normals'

type V3 = [number, number, number]

/** `BM_vert_step_fan_loop` (`bmesh_query.cc:473`): the next loop around `l.v` across `eStep`'s other edge. */
function vertStepFanLoop(l: BMLoop, eStep: {e: BMLoop['e']}): BMLoop | null {
    const ePrev = eStep.e
    let eNext
    if (l.e === ePrev) eNext = l.prev.e
    else if (l.prev.e === ePrev) eNext = l.e
    else return null
    if (eNext && edgeIsManifold(eNext)) {
        eStep.e = eNext
        return edgeOtherLoop(eNext, l)
    }
    return null
}

const fno = (l: BMLoop): V3 => [l.f.nx, l.f.ny, l.f.nz]

/** `bevel_harden_normals` (`bmesh_bevel.cc:3006`). */
export function bevelHardenNormals(bp: BevelParams, bm: BMesh): void {
    if (bp.offset === 0) return
    meshNormalsUpdate(bm)
    let layer = bm.ldata.get(AttrName.customNormal)
    if (!layer) bevelEdgesSharpBoundary(bm, bp)
    if (layer && layer.type !== 'int16x2') return // the attribute exists with another type: leave it, as Blender does
    // BM_lnorspace_update adds the corner `custom_normal` layer when it is missing
    layer = bm.addLayer('loop', AttrName.customNormal, 'int16x2')

    const wanted = new Map<BMLoop, V3>()
    for (const f of bm.faces) {
        const fkind = getFaceKind(bp, f)
        if (fkind === FKind.ORIG || fkind === FKind.RECON) continue
        for (const l of f.eachLoop()) {
            const step = {e: l.prev.e}
            const lprev = vertStepFanLoop(l, step)
            step.e = l.e
            const lnext = vertStepFanLoop(l, step)
            const fprevkind = lprev ? getFaceKind(bp, lprev.f) : FKind.NONE
            const fnextkind = lnext ? getFaceKind(bp, lnext.f) : FKind.NONE
            let pnorm: V3 | null = null
            let sum = false
            const tag = (x: BMLoop) => x.testFlag(ElemFlag.TagAlt) // BM_ELEM_LONG_TAG
            if (fkind === FKind.EDGE) {
                if (fprevkind === FKind.EDGE && tag(l)) { const a = fno(l), b = fno(lprev!); pnorm = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; sum = true }
                else if (fnextkind === FKind.EDGE && tag(lnext!)) { const a = fno(l), b = fno(lnext!); pnorm = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; sum = true }
                else if (fprevkind === FKind.RECON && tag(l)) pnorm = fno(lprev!)
                else if (fnextkind === FKind.RECON && tag(l.prev)) pnorm = fno(lnext!)
            } else if (fkind === FKind.VERT) {
                if (fprevkind === FKind.VERT && fnextkind === FKind.VERT) pnorm = [l.v.nx, l.v.ny, l.v.nz]
                else if (fprevkind === FKind.RECON) pnorm = fno(lprev!)
                else if (fnextkind === FKind.RECON) pnorm = fno(lnext!)
                else {
                    let lprevprev: BMLoop | null = null, lnextnext: BMLoop | null = null
                    if (lprev) { const s = {e: lprev.prev.e}; lprevprev = vertStepFanLoop(lprev, s) }
                    if (lnext) { const s = {e: lnext.e}; lnextnext = vertStepFanLoop(lnext, s) }
                    const fprevprevkind = lprevprev ? getFaceKind(bp, lprevprev.f) : FKind.NONE
                    const fnextnextkind = lnextnext ? getFaceKind(bp, lnextnext.f) : FKind.NONE
                    if (fprevkind === FKind.EDGE && fprevprevkind === FKind.RECON) pnorm = fno(lprevprev!)
                    else if (fprevkind === FKind.EDGE && fnextkind === FKind.VERT && fprevprevkind === FKind.EDGE) {
                        const a = fno(lprev!), b = fno(lprevprev!); pnorm = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; sum = true
                    } else if (fnextkind === FKind.EDGE && fprevkind === FKind.VERT && fnextnextkind === FKind.EDGE) {
                        const a = fno(lnext!), b = fno(lnextnext!); pnorm = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; sum = true
                    }
                }
            }
            if (!pnorm) continue
            if (sum) {
                const len = Math.hypot(pnorm[0], pnorm[1], pnorm[2])
                pnorm = len > 1e-35 ? [pnorm[0] / len, pnorm[1] / len, pnorm[2] / len] : [0, 0, 0]
            }
            wanted.set(l, pnorm)
        }
    }
    if (!wanted.size) return

    // the corner fan spaces of the mesh this BMesh becomes (bmToMesh numbers corners face by face, loop by loop)
    const mesh = bmToMesh(bm)
    const spaces: CornerFanSpaces = {spaces: [], cornerSpace: new Int32Array(0), cornersBySpace: []}
    const scratch = new Float32Array(mesh.cornersNum * 3)
    normalsCalcCorners(
        mesh, faceNormalsTrue(mesh), mesh.attributes.get(AttrName.sharpEdge)?.data ?? null,
        mesh.attributes.get(AttrName.sharpFace)?.data ?? null, mesh.attributes.get(AttrName.customNormal)?.data ?? null,
        spaces, scratch,
    )
    let corner = 0
    for (const f of bm.faces) {
        for (const l of f.eachLoop()) {
            const n = wanted.get(l)
            if (n) {
                const si = spaces.cornerSpace[corner]
                if (si >= 0) setValue(l, bm.ldata, layer, customNormalToData(spaces.spaces[si], n))
            }
            corner++
        }
    }
}

/** `BevelModifierFaceStrengthMode` / the operator's `face_strength_mode`. */
export type BevelFaceStrengthMode = 'NONE' | 'NEW' | 'AFFECTED' | 'ALL'
const FACE_STRENGTH_MODE: Record<BevelFaceStrengthMode, number> = {NONE: 0, NEW: 1, AFFECTED: 2, ALL: 3}

/** `bevel_set_weighted_normal_face_strength` (`bmesh_bevel.cc:3135`). */
export function bevelSetWeightedNormalFaceStrength(bm: BMesh, bp: BevelParams, mode: BevelFaceStrengthMode): void {
    const m = FACE_STRENGTH_MODE[mode]
    const layer = bm.addLayer('face', FACE_WEIGHT_LAYER, 'int32')
    for (const f of bm.faces) {
        const fkind = getFaceKind(bp, f)
        let strength = 0, set = true
        switch (fkind) {
        case FKind.VERT: strength = FACE_STRENGTH.WEAK; set = m >= FACE_STRENGTH_MODE.NEW; break
        case FKind.EDGE: strength = FACE_STRENGTH.MEDIUM; set = m >= FACE_STRENGTH_MODE.NEW; break
        case FKind.RECON: strength = FACE_STRENGTH.STRONG; set = m >= FACE_STRENGTH_MODE.AFFECTED; break
        case FKind.ORIG: strength = FACE_STRENGTH.STRONG; set = m === FACE_STRENGTH_MODE.ALL; break
        default: set = false
        }
        if (set) setValue(f, bm.pdata, layer, [strength])
    }
}
