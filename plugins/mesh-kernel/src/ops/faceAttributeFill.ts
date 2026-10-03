/**
 * Fill faces with the attributes (and winding) of their adjacent faces.
 *
 * Port of `source/blender/bmesh/operators/bmo_fill_attribute.cc` (`bmo_face_attribute_fill_exec`,
 * `bmesh_face_attribute_fill`, `bm_face_copy_shared_all`, `bm_loop_is_all_radial_tag`,
 * `bm_loop_is_face_untag`) and the helper it calls, `BM_face_copy_shared`
 * (`bmesh/intern/bmesh_construct.cc:79`). Blender's edit-mode "Fill" runs this after
 * `triangle_fill` so the new faces take the material, smooth flag, UVs and winding of the surface
 * they close.
 *
 * Blender 3.4.1 (`bmo_fill_attribute.c`) has the same logic; only the `BM_elem_attrs_copy` signature
 * changed.
 *
 * `BLI_LINKSTACK_*` is a singly linked LIFO stack (push and pop at the head); arrays used as stacks
 * (`push` / `pop` at the end) visit in the same order.
 */

import {BMElem, BMFace, BMLoop} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {BMCustomDataLayout, copyElemHeader, getValue, setValue} from '../bmesh/customdata'
import {faceNormalFlip} from '../bmesh/flip'
import {ElemFlag} from '../constants'

const BM_ELEM_TAG = ElemFlag.Tag

const tagTest = (f: BMFace): boolean => (f.hflag & BM_ELEM_TAG) !== 0

/** `bm_loop_is_all_radial_tag` (`bmo_fill_attribute.cc:22`): are all other loops' faces tagged? */
function loopIsAllRadialTag(l: BMLoop): boolean {
    let lIter = l.radialNext!
    do {
        if (!tagTest(lIter.f)) return false
    } while ((lIter = lIter.radialNext!) !== l)
    return true
}

/**
 * `CustomData_bmesh_copy_block(data, src_block, &dst_block)`: the whole block of `dst` replaced by
 * `src`'s, defaults included. `copyElemAttrs` (`bmesh/customdata.ts`) skips a source that has no block yet, which
 * would leave `dst`'s old values where Blender writes defaults, so the copy goes layer by layer.
 */
function copyBlock(src: BMElem, dst: BMElem, layout: BMCustomDataLayout): void {
    for (const layer of layout.layers) setValue(dst, layout, layer, getValue(src, layer))
}

/**
 * `BM_elem_attrs_copy(bm, f_src, f_dst)` for faces (`bmesh_construct.cc:406`): custom data, header
 * flags except selection, the cached normal and the material index.
 */
function faceAttrsCopy(bm: BMesh, src: BMFace, dst: BMFace): void {
    if (src === dst) return
    copyBlock(src, dst, bm.pdata)
    copyElemHeader(src, dst, 'face')
    dst.matNr = src.matNr
}

/**
 * `BM_face_copy_shared` (`bmesh_construct.cc:79`): copy each corner's data from the adjacent face's
 * matching corner, across every edge with another face, where `filter` accepts the source loop.
 * Blender marks written corners with `_FLAG_OVERLAP` so the first edge to reach a corner wins; a set
 * does the same.
 */
function faceCopyShared(bm: BMesh, f: BMFace, filter: ((l: BMLoop) => boolean) | null): void {
    const overlap = new Set<BMLoop>()
    const lFirst = f.lFirst
    let lIter = lFirst
    do {
        const lOther = lIter.radialNext

        if (lOther && lOther !== lIter) {
            const lDst: BMLoop[] = [lIter, lIter.next]
            let lSrc: BMLoop[]
            if (lOther.v === lIter.v) lSrc = [lOther, lOther.next]
            else lSrc = [lOther.next, lOther]

            for (let j = 0; j < 2; j++) {
                if (!overlap.has(lDst[j])) {
                    if (filter === null || filter(lSrc[j])) {
                        copyBlock(lSrc[j], lDst[j], bm.ldata)
                        overlap.add(lDst[j])
                    }
                }
            }
        }
    } while ((lIter = lIter.next) !== lFirst)
}

/** `bm_loop_is_face_untag` (`bmo_fill_attribute.cc:38`). */
const loopIsFaceUntag = (l: BMLoop): boolean => !tagTest(l.f)

/** `bm_face_copy_shared_all` (`bmo_fill_attribute.cc:46`): copy everything from an untagged neighbour. */
function faceCopySharedAll(bm: BMesh, l: BMLoop, useNormals: boolean, useData: boolean): void {
    let lOther = l.radialNext!
    const f = l.f
    while (tagTest(lOther.f)) lOther = lOther.radialNext!
    const fOther = lOther.f

    if (useData) {
        /* copy face-attrs */
        faceAttrsCopy(bm, fOther, f)

        /* copy loop-attrs */
        faceCopyShared(bm, f, loopIsFaceUntag)
    }

    if (useNormals) {
        /* copy winding (flipping) */
        if (l.v === lOther.v) faceNormalFlip(f)
    }
}

/** `bmesh_face_attribute_fill` (`bmo_fill_attribute.cc:77`): flood fill from the untagged faces. */
function bmeshFaceAttributeFill(bm: BMesh, useNormals: boolean, useData: boolean): number {
    let loopQueuePrev: BMLoop[] = []
    let loopQueueNext: BMLoop[] = []

    let faceTot = 0

    for (const f of bm.faces) {
        if (tagTest(f)) {
            const lFirst = f.lFirst
            let lIter = lFirst
            do {
                if (!loopIsAllRadialTag(lIter)) loopQueuePrev.push(lIter)
            } while ((lIter = lIter.next) !== lFirst)
        }
    }

    while (loopQueuePrev.length) {
        let l: BMLoop | undefined
        while ((l = loopQueuePrev.pop())) {
            /* check we're still un-assigned */
            if (tagTest(l.f)) {
                l.f.hflag &= ~BM_ELEM_TAG

                let lIter = l.next
                do {
                    let lRadialIter = lIter.radialNext!
                    if (lRadialIter !== lIter) {
                        do {
                            if (tagTest(lRadialIter.f)) loopQueueNext.push(lRadialIter)
                        } while ((lRadialIter = lRadialIter.radialNext!) !== lIter)
                    }
                } while ((lIter = lIter.next) !== l)

                /* do last because of face flipping */
                faceCopySharedAll(bm, l, useNormals, useData)
                faceTot += 1
            }
        }

        // BLI_LINKSTACK_SWAP
        const tmp = loopQueuePrev
        loopQueuePrev = loopQueueNext
        loopQueueNext = tmp
    }

    return faceTot
}

export interface FaceAttributeFillOptions {
    /** Copy the winding of the adjacent face (flip faces that disagree). Blender's `use_normals`. */
    useNormals?: boolean
    /** Copy face and corner attributes from the adjacent face. Blender's `use_data`. */
    useData?: boolean
}

export interface FaceAttributeFillResult {
    /** Faces that could not be reached from an untagged neighbour. Blender's `faces_fail.out`. */
    facesFail: BMFace[]
}

/**
 * Fill `faces` with the attributes of the faces next to them, flood-filling inward from the
 * boundary with the rest of the mesh.
 *
 * Port of `bmo_face_attribute_fill_exec` (`bmo_fill_attribute.cc:138`). Like Blender it clears
 * `BM_ELEM_TAG` on every face first and leaves it set on the faces that failed.
 */
export function faceAttributeFill(bm: BMesh, faces: readonly BMFace[], options: FaceAttributeFillOptions = {}): FaceAttributeFillResult {
    const useNormals = options.useNormals ?? false
    const useData = options.useData ?? false

    // BM_mesh_elem_hflag_disable_all(bm, BM_FACE, BM_ELEM_TAG, false)
    for (const f of bm.faces) f.hflag &= ~BM_ELEM_TAG

    /* do inline */
    for (const f of faces) f.hflag |= BM_ELEM_TAG

    /* now we can copy adjacent data */
    const faceTot = bmeshFaceAttributeFill(bm, useNormals, useData)

    const facesFail: BMFace[] = []
    if (faceTot !== faces.length) {
        /* any remaining tags will be skipped */
        for (const f of bm.faces) if (tagTest(f)) facesFail.push(f)
    }
    return {facesFail}
}
