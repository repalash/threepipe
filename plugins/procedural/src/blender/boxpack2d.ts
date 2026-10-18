/**
 * `BLI_box_pack_2d` (`blenlib/intern/boxpack_2d.cc`, Blender 5.2.2) with `USE_MERGE`, `USE_FREE_STRIP` and
 * `USE_PACK_BIAS`, in float32; vertex sorting uses `BLI_qsort_r` (`blender/sort.ts`).
 */

import {f32} from './f32'
import {bliQsortR} from './sort'

export interface BoxPack {
    x: number
    y: number
    w: number
    h: number
    /** BL, TR, TL, BR. */
    v: BoxVert[]
}

interface BoxVert {
    x: number
    y: number
    free: number
    used: boolean
    index: number
    bias: number
    trb: BoxPack | null
    blb: BoxPack | null
    brb: BoxPack | null
    tlb: BoxPack | null
    isectCache: (BoxPack | null)[]
}

const EPSILON = f32(0.0000001)
const EPSILON_MERGE = f32(0.00001)
const EPSILON_BIAS = f32(0.000001)
const BLF = 1, TRF = 2, TLF = 4, BRF = 8
const CORNERFLAGS = BLF | TRF | TLF | BRF
const BL = 0, TR = 1, TL = 2, BR = 3
const quadFlag = (q: number) => 1 << q

const xminGet = (b: BoxPack) => b.v[BL].x
const xmaxGet = (b: BoxPack) => b.v[TR].x
const yminGet = (b: BoxPack) => b.v[BL].y
const ymaxGet = (b: BoxPack) => b.v[TR].y
const v34xUpdate = (b: BoxPack) => {
    b.v[TL].x = b.v[BL].x
    b.v[BR].x = b.v[TR].x
}
const v34yUpdate = (b: BoxPack) => {
    b.v[TL].y = b.v[TR].y
    b.v[BR].y = b.v[BL].y
}
const xminSet = (b: BoxPack, v: number) => {
    b.v[TR].x = f32(v + b.w)
    b.v[BL].x = v
    v34xUpdate(b)
}
const xmaxSet = (b: BoxPack, v: number) => {
    b.v[BL].x = f32(v - b.w)
    b.v[TR].x = v
    v34xUpdate(b)
}
const yminSet = (b: BoxPack, v: number) => {
    b.v[TR].y = f32(v + b.h)
    b.v[BL].y = v
    v34yUpdate(b)
}
const ymaxSet = (b: BoxPack, v: number) => {
    b.v[BL].y = f32(v - b.h)
    b.v[TR].y = v
    v34yUpdate(b)
}

/** `box_isect` (:162). */
const boxIsect = (a: BoxPack, b: BoxPack) => !(f32(xminGet(a) + EPSILON) >= xmaxGet(b) || f32(yminGet(a) + EPSILON) >= ymaxGet(b) ||
    f32(xmaxGet(a) - EPSILON) <= xminGet(b) || f32(ymaxGet(a) - EPSILON) <= yminGet(b))

/** `vert_bias_update` (:174). */
const biasUpdate = (v: BoxVert) => {
    v.bias = f32(f32(v.x * v.y) * EPSILON_BIAS)
}

const maxff = (a: number, b: number) => (a > b ? a : b)

/** `BLI_box_pack_2d(boxes, len, sort_boxes = false)`: sets each box's `x`, `y`; returns `[tot_x, tot_y]`. */
export function boxPack2d(boxes: BoxPack[]): [number, number] {
    const len = boxes.length
    let totX = 0, totY = 0
    if (!len) return [totX, totY]
    const verts: BoxVert[] = []
    const mkVert = (free: number, which: 'trb' | 'blb' | 'brb' | 'tlb', box: BoxPack): BoxVert => {
        const v: BoxVert = {x: 0, y: 0, free, used: false, index: verts.length, bias: 0, trb: null, blb: null, brb: null, tlb: null, isectCache: [null, null, null, null]}
        v[which] = box
        verts.push(v)
        return v
    }
    for (const box of boxes) {
        box.v = []
        box.v[BL] = mkVert(CORNERFLAGS & ~TRF, 'trb', box)
        box.v[TR] = mkVert(CORNERFLAGS & ~BLF, 'blb', box)
        box.v[TL] = mkVert(CORNERFLAGS & ~BRF, 'brb', box)
        box.v[BR] = mkVert(CORNERFLAGS & ~TLF, 'tlb', box)
    }
    const packIndices: number[] = new Array(3 * len)
    let box = boxes[0]
    box.v[BL].free = 0
    box.v[BR].free &= ~(BLF | BRF)
    box.v[TL].free &= ~(BLF | TLF)
    totX = box.w
    totY = box.h
    xminSet(box, 0)
    yminSet(box, 0)
    box.x = box.y = 0
    for (let i = 0; i < 4; i++) {
        box.v[i].used = true
        biasUpdate(box.v[i])
    }
    for (let i = 0; i < 3; i++) packIndices[i] = box.v[i + 1].index
    let packLen = 3

    for (let boxIndex = 1; boxIndex < len; boxIndex++) {
        box = boxes[boxIndex]
        const bw = box.w, bh = box.h
        // `vertex_sort` (:217).
        const view = packIndices.slice(0, packLen)
        bliQsortR(view, (i1, i2) => {
            const v1 = verts[i1], v2 = verts[i2]
            if (v1.free === 0 && v2.free === 0) return 0
            if (v1.free === 0) return 1
            if (v2.free === 0) return -1
            let a1 = maxff(f32(v1.x + bw), f32(v1.y + bh))
            let a2 = maxff(f32(v2.x + bw), f32(v2.y + bh))
            a1 = f32(a1 + v1.bias)
            a2 = f32(a2 + v2.bias)
            return a1 > a2 ? 1 : a1 < a2 ? -1 : 0
        })
        for (let i = 0; i < packLen; i++) packIndices[i] = view[i]
        // `USE_FREE_STRIP`.
        let i = packLen - 1
        while (i !== 0 && verts[packIndices[i]].free === 0) i--
        packLen = i + 1

        let isect = true
        for (i = 0; i < packLen && isect; i++) {
            const vert = verts[packIndices[i]]
            for (let j = 0; j < 4 && isect; j++) {
                if (!(vert.free & quadFlag(j))) continue
                switch (j) {
                case BL:
                    xmaxSet(box, vert.x)
                    ymaxSet(box, vert.y)
                    break
                case TR:
                    xminSet(box, vert.x)
                    yminSet(box, vert.y)
                    break
                case TL:
                    xmaxSet(box, vert.x)
                    yminSet(box, vert.y)
                    break
                case BR:
                    xminSet(box, vert.x)
                    ymaxSet(box, vert.y)
                    break
                }
                isect = false
                if (xminGet(box) < 0 || yminGet(box) < 0 || (vert.isectCache[j] && boxIsect(box, vert.isectCache[j]!))) {
                    isect = true
                } else {
                    for (let t = 0; t < boxIndex; t++) {
                        const test = boxes[t]
                        if (boxIsect(box, test)) {
                            vert.isectCache[j] = test
                            isect = true
                            break
                        }
                    }
                }
                if (isect) continue
                totX = maxff(xmaxGet(box), totX)
                totY = maxff(ymaxGet(box), totY)
                vert.free &= ~quadFlag(j)
                switch (j) {
                case TR:
                    box.v[BL] = vert
                    vert.trb = box
                    break
                case TL:
                    box.v[BR] = vert
                    vert.tlb = box
                    break
                case BR:
                    box.v[TL] = vert
                    vert.brb = box
                    break
                case BL:
                    box.v[TR] = vert
                    vert.blb = box
                    break
                }
                if (xminGet(box) <= 0) {
                    box.v[TL].free &= ~(TLF | BLF)
                    box.v[BL].free &= ~(TLF | BLF)
                } else if (yminGet(box) <= 0) {
                    box.v[BL].free &= ~(BRF | BLF)
                    box.v[BR].free &= ~(BRF | BLF)
                }
                /**
                 * `USE_MERGE` blocks: `A`/`B` are vertex slots of two boxes; the unused one is replaced by the used one.
                 * (`BLI_assert(A->used != B->used)` is compiled out in release builds; the branch below is what runs.)
                 */
                const merge = (boxA: BoxPack, slotA: number, boxB: BoxPack, slotB: number, mask: number) => {
                    const A = boxA.v[slotA], B = boxB.v[slotB]
                    if (A.used) {
                        A.free &= B.free & ~mask
                        boxB.v[slotB] = A
                    } else {
                        B.free &= A.free & ~mask
                        boxA.v[slotA] = B
                    }
                }
                if (vert.tlb && vert.trb && (box === vert.tlb || box === vert.trb)) {
                    if (Math.abs(f32(vert.tlb.h - vert.trb.h)) < EPSILON_MERGE) merge(vert.trb, TL, vert.tlb, TR, BLF | BRF)
                    else if (vert.tlb.h > vert.trb.h) vert.trb.v[TL].free &= ~(TLF | BLF)
                    else vert.tlb.v[TR].free &= ~(TRF | BRF)
                } else if (vert.blb && vert.brb && (box === vert.blb || box === vert.brb)) {
                    if (Math.abs(f32(vert.blb.h - vert.brb.h)) < EPSILON_MERGE) merge(vert.blb, BR, vert.brb, BL, TRF | TLF)
                    else if (vert.blb.h > vert.brb.h) vert.brb.v[BL].free &= ~(TLF | BLF)
                    else vert.blb.v[BR].free &= ~(TRF | BRF)
                }
                if (vert.tlb && vert.blb && (box === vert.tlb || box === vert.blb)) {
                    if (Math.abs(f32(vert.tlb.w - vert.blb.w)) < EPSILON_MERGE) merge(vert.blb, TL, vert.tlb, BL, TRF | BRF)
                    else if (vert.tlb.w > vert.blb.w) vert.blb.v[TL].free &= ~(TLF | TRF)
                    else vert.tlb.v[BL].free &= ~(BLF | BRF)
                } else if (vert.trb && vert.brb && (box === vert.trb || box === vert.brb)) {
                    if (Math.abs(f32(vert.trb.w - vert.brb.w)) < EPSILON_MERGE) merge(vert.brb, TR, vert.trb, BR, TLF | BLF)
                    else if (vert.trb.w > vert.brb.w) vert.brb.v[TR].free &= ~(TLF | TRF)
                    else vert.trb.v[BR].free &= ~(BLF | BRF)
                }
                for (let k = 0; k < 4; k++) {
                    if (!box.v[k].used) {
                        box.v[k].used = true
                        biasUpdate(box.v[k])
                        packIndices[packLen++] = box.v[k].index
                    }
                }
                box.x = xminGet(box)
                box.y = yminGet(box)
            }
        }
    }
    return [totX, totY]
}
