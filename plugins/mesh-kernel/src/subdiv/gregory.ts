/**
 * Change of basis from the source points around an irregular face to the 20 points of a Gregory-basis end cap:
 * OpenSubdiv `Far::GregoryConverter` and `CatmarkLimits` (`far/catmarkPatchBuilder.cpp:22-1384`, OpenSubdiv 3.7.0).
 *
 * Rows are kept dense over the source points, with the set of columns each row "has" tracked alongside: OpenSubdiv
 * stores them sparse, and `computeIrregularFacePoint` keeps only the columns already present in the corner and
 * edge points it combines, which this reproduces. Repeated columns (valence-2 interior corners) sum, as
 * `_removeValence2Duplicates` makes them.
 *
 * Point order per corner c (rows 5c..5c+4): P, Ep, Em, Fp, Fm, labelled as in Loop, Schaefer, Ni, Castano 2009.
 */

import {SourcePatch} from './patchBuilder'

class Row {
    readonly w: Float64Array
    readonly has: Uint8Array
    constructor(n: number) { this.w = new Float64Array(n); this.has = new Uint8Array(n) }
    assign(index: number, weight: number): void { this.w[index] += weight; this.has[index] = 1 }
    copy(o: Row): void { this.w.set(o.w); this.has.set(o.has) }
}

/** `CatmarkLimits::computeCoefficient` (`catmarkPatchBuilder.cpp:68`). */
function computeCoefficient(valence: number): number {
    const efTable = [
        0.0, 0.0, 0.0,
        8.1281572906372312e-01, 0.5, 3.6364406329142801e-01,
        2.8751379706077085e-01, 2.3868786685851678e-01, 2.0454364190756097e-01,
        1.7922903958061159e-01, 1.5965737079986253e-01, 1.4404233443011302e-01,
        1.3127568415883017e-01, 1.2063172212675841e-01, 1.1161437506676930e-01,
        1.0387245516114274e-01, 9.7150019090724835e-02, 9.1255917505950648e-02,
        8.6044378511602668e-02, 8.1402211336798411e-02, 7.7240129516184072e-02,
        7.3486719751997026e-02, 7.0084157479797987e-02, 6.6985104030725440e-02,
        6.4150420569810074e-02, 6.1547457638637268e-02, 5.9148757447233989e-02,
        5.6931056818776957e-02, 5.4874512279256417e-02, 5.2962091433796134e-02,
    ]
    if (valence < 30) return efTable[valence]
    const invValence = 1 / valence
    const cosT = Math.cos(2 * Math.PI * invValence)
    const divisor = cosT + 5 + Math.sqrt((cosT + 9) * (cosT + 1))
    return 16 * invValence / divisor
}

/** `CatmarkLimits::ComputeInteriorPointWeights` (`catmarkPatchBuilder.cpp:94`). */
function computeInteriorPointWeights(valence: number, faceInRing: number, pW: Float64Array, epW: Float64Array, emW: Float64Array): void {
    const fValence = valence
    const oneOverValence = 1 / fValence
    const oneOverValPlus5 = 1 / (fValence + 5)
    const pCoeff = oneOverValence * oneOverValPlus5
    const tanCoeff = computeCoefficient(valence) * 0.5 * oneOverValPlus5
    const faceAngle = 2 * Math.PI * oneOverValence
    const weightWidth = 1 + 2 * valence
    const tanWeights = new Float64Array(weightWidth)
    pW[0] = fValence * oneOverValPlus5
    for (let i = 0; i < valence; i++) {
        pW[1 + 2 * i] = pCoeff * 4
        pW[1 + 2 * i + 1] = pCoeff
        const iPrev = (i + valence - 1) % valence
        const iNext = (i + 1) % valence
        const cosICoeff = tanCoeff * Math.cos(faceAngle * i)
        tanWeights[1 + 2 * iPrev] += cosICoeff * 2
        tanWeights[1 + 2 * iPrev + 1] += cosICoeff
        tanWeights[1 + 2 * i] += cosICoeff * 4
        tanWeights[1 + 2 * i + 1] += cosICoeff
        tanWeights[1 + 2 * iNext] += cosICoeff * 2
    }
    const epOffset = 2 * ((valence - faceInRing) % valence)
    const emOffset = 2 * ((valence - faceInRing - 1 + valence) % valence)
    epW[0] = pW[0]
    emW[0] = pW[0]
    for (let i = 1; i < weightWidth; i++) {
        let ip = i + epOffset
        if (ip >= weightWidth) ip -= weightWidth - 1
        let im = i + emOffset
        if (im >= weightWidth) im -= weightWidth - 1
        epW[i] = pW[i] + tanWeights[ip]
        emW[i] = pW[i] + tanWeights[im]
    }
}

/** `CatmarkLimits::ComputeBoundaryPointWeights` (`catmarkPatchBuilder.cpp:186`). */
function computeBoundaryPointWeights(valence: number, faceInRing: number, pW: Float64Array, epW: Float64Array, emW: Float64Array): void {
    const numFaces = valence - 1
    const faceAngle = Math.PI / numFaces
    const weightWidth = 2 * valence
    const N = weightWidth - 1
    pW.fill(0, 0, weightWidth)
    pW[0] = 4 / 6
    pW[1] = 1 / 6
    pW[N] = 1 / 6
    const tBoundaryCoeff1 = 1 / 6, tBoundaryCoeffN = -1 / 6
    const tanWeights = new Float64Array(weightWidth)
    {
        const k = numFaces, theta = faceAngle
        const c = Math.cos(theta), s = Math.sin(theta)
        const div3 = 1 / 3
        const div3kc = 1 / (3 * k + c)
        const gamma = -4 * s * div3kc
        const alpha0k = -((1 + 2 * c) * Math.sqrt(1 + c)) * div3kc / Math.sqrt(1 - c)
        const beta0 = s * div3kc
        tanWeights[0] = gamma * div3
        tanWeights[1] = alpha0k * div3
        tanWeights[2] = beta0 * div3
        tanWeights[N] = alpha0k * div3
        for (let i = 1; i < valence - 1; i++) {
            const sinThetaI = Math.sin(theta * i)
            const sinThetaIplus1 = Math.sin(theta * (i + 1))
            const alpha = 4 * sinThetaI * div3kc
            const beta = (sinThetaI + sinThetaIplus1) * div3kc
            tanWeights[1 + 2 * i] = alpha * div3
            tanWeights[1 + 2 * i + 1] = beta * div3
        }
    }
    if (faceInRing === 0) {
        epW.fill(0, 0, weightWidth)
        epW[0] = 2 / 3
        epW[1] = 1 / 3
    } else {
        const a = faceAngle * faceInRing
        const cosA = Math.cos(a), sinA = Math.sin(a)
        for (let i = 0; i < weightWidth; i++) epW[i] = tanWeights[i] * sinA
        epW[0] += pW[0]
        epW[1] += pW[1] + tBoundaryCoeff1 * cosA
        epW[N] += pW[N] + tBoundaryCoeffN * cosA
    }
    if (faceInRing === numFaces - 1) {
        emW.fill(0, 0, weightWidth)
        emW[0] = 2 / 3
        emW[N] = 1 / 3
    } else {
        const iEdgePrev = (faceInRing + 1) % valence
        const a = faceAngle * iEdgePrev
        const cosA = Math.cos(a), sinA = Math.sin(a)
        for (let i = 0; i < weightWidth; i++) emW[i] = tanWeights[i] * sinA
        emW[0] += pW[0]
        emW[1] += pW[1] + tBoundaryCoeff1 * cosA
        emW[N] += pW[N] + tBoundaryCoeffN * cosA
    }
}

interface CornerTopology {
    isBoundary: boolean
    isSharp: boolean
    isDart: boolean
    isRegular: boolean
    isVal2Int: boolean
    epOnBoundary: boolean
    emOnBoundary: boolean
    fpIsRegular: boolean
    fmIsRegular: boolean
    fpIsCopied: boolean
    fmIsCopied: boolean
    valence: number
    numFaces: number
    faceInRing: number
    faceAngle: number
    cosFaceAngle: number
    sinFaceAngle: number
    ringPoints: number[]
}

/**
 * `GregoryConverter<REAL>(sourcePatch, matrix)`: the 20 x numSourcePoints matrix taking the source points
 * (ordered as `SourcePatch` defines them) to the Gregory-basis points.
 */
export function gregoryConversionMatrix(sp: SourcePatch): Float64Array[] {
    const width = sp.numSourcePoints
    const corners: CornerTopology[] = []
    for (let c = 0; c < 4; c++) {
        const src = sp.corners[c]
        const valence = src.numFaces + (src.boundary ? 1 : 0)
        const isRegular = (src.numFaces << (src.boundary ? 1 : 0)) === 4 && !src.sharp
        let faceAngle: number, cosFaceAngle: number, sinFaceAngle: number
        if (isRegular) {
            faceAngle = Math.PI / 2; cosFaceAngle = 0; sinFaceAngle = 1
        } else {
            faceAngle = (src.boundary ? Math.PI : 2 * Math.PI) / src.numFaces
            cosFaceAngle = Math.cos(faceAngle)
            sinFaceAngle = Math.sin(faceAngle)
        }
        const ringPoints: number[] = []
        sp.getCornerRingPoints(c, ringPoints)
        corners.push({
            isBoundary: src.boundary, isSharp: src.sharp, isDart: src.dart, isRegular, isVal2Int: src.val2Interior,
            epOnBoundary: false, emOnBoundary: false, fpIsRegular: false, fmIsRegular: false, fpIsCopied: false, fmIsCopied: false,
            valence, numFaces: src.numFaces, faceInRing: src.patchFace, faceAngle, cosFaceAngle, sinFaceAngle, ringPoints,
        })
    }
    for (let c = 0; c < 4; c++) {
        const corner = corners[c]
        const cNext = (c + 1) & 3, cPrev = (c + 3) & 3
        corner.epOnBoundary = false
        corner.emOnBoundary = false
        corner.fpIsRegular = corner.isRegular && corners[cNext].isRegular
        corner.fmIsRegular = corner.isRegular && corners[cPrev].isRegular
        corner.fpIsCopied = false
        corner.fmIsCopied = false
        if (corner.isBoundary) {
            corner.epOnBoundary = corner.faceInRing === 0
            corner.emOnBoundary = corner.faceInRing === corner.numFaces - 1
            if (corner.numFaces > 1) {
                if (corner.epOnBoundary) { corner.fpIsRegular = corner.fmIsRegular; corner.fpIsCopied = !corner.fpIsRegular }
                if (corner.emOnBoundary) { corner.fmIsRegular = corner.fpIsRegular; corner.fmIsCopied = !corner.fmIsRegular }
            } else {
                corner.fpIsRegular = true
                corner.fmIsRegular = true
            }
        }
    }

    const rows = Array.from({length: 20}, () => new Row(width))
    // corner and edge points first: face points combine edge points of adjacent corners
    for (let c = 0; c < 4; c++) {
        if (corners[c].isRegular) assignRegularEdgePoints(c, corners, rows)
        else computeIrregularEdgePoints(c, corners, rows)
    }
    for (let c = 0; c < 4; c++) {
        if (corners[c].fpIsRegular || corners[c].fmIsRegular) assignRegularFacePoints(c, corners, rows)
        if (!corners[c].fpIsRegular || !corners[c].fmIsRegular) computeIrregularFacePoints(c, corners, rows, width)
    }
    return rows.map(r => r.w)
}

/** `GregoryConverter::assignRegularEdgePoints` (`catmarkPatchBuilder.cpp:988`). */
function assignRegularEdgePoints(c: number, corners: CornerTopology[], rows: Row[]): void {
    const p = rows[5 * c], ep = rows[5 * c + 1], em = rows[5 * c + 2]
    const corner = corners[c]
    const ring = corner.ringPoints
    if (!corner.isBoundary) {
        p.assign(c, 4 / 9)
        p.assign(ring[0], 1 / 9); p.assign(ring[2], 1 / 9); p.assign(ring[4], 1 / 9); p.assign(ring[6], 1 / 9)
        p.assign(ring[1], 1 / 36); p.assign(ring[3], 1 / 36); p.assign(ring[5], 1 / 36); p.assign(ring[7], 1 / 36)
        const iEdgeEp = 2 * corner.faceInRing
        const iEdgeEm = 2 * ((corner.faceInRing + 1) & 3)
        const iEdgeOp = 2 * ((corner.faceInRing + 2) & 3)
        const iEdgeOm = 2 * ((corner.faceInRing + 3) & 3)
        ep.assign(c, 4 / 9)
        ep.assign(ring[iEdgeEp], 2 / 9)
        ep.assign(ring[iEdgeEm], 1 / 9)
        ep.assign(ring[iEdgeOm], 1 / 9)
        ep.assign(ring[iEdgeEp + 1], 1 / 18)
        ep.assign(ring[iEdgeOm + 1], 1 / 18)
        em.assign(c, 4 / 9)
        em.assign(ring[iEdgeEm], 2 / 9)
        em.assign(ring[iEdgeEp], 1 / 9)
        em.assign(ring[iEdgeOp], 1 / 9)
        em.assign(ring[iEdgeEp + 1], 1 / 18)
        em.assign(ring[iEdgeEm + 1], 1 / 18)
    } else {
        const eBoundary = corner.epOnBoundary ? ep : em
        const eInterior = corner.epOnBoundary ? em : ep
        const iBoundary = corner.epOnBoundary ? 0 : 4
        p.assign(c, 2 / 3)
        p.assign(ring[0], 1 / 6)
        p.assign(ring[4], 1 / 6)
        eBoundary.assign(c, 2 / 3)
        eBoundary.assign(ring[iBoundary], 1 / 3)
        eInterior.assign(c, 4 / 9)
        eInterior.assign(ring[2], 2 / 9)
        eInterior.assign(ring[0], 1 / 9)
        eInterior.assign(ring[4], 1 / 9)
        eInterior.assign(ring[1], 1 / 18)
        eInterior.assign(ring[3], 1 / 18)
    }
}

/** `GregoryConverter::computeIrregularEdgePoints` (`catmarkPatchBuilder.cpp:1058`). */
function computeIrregularEdgePoints(c: number, corners: CornerTopology[], rows: Row[]): void {
    const p = rows[5 * c], ep = rows[5 * c + 1], em = rows[5 * c + 2]
    const corner = corners[c]
    if (corner.isSharp) {
        p.assign(c, 1)
        // "approximating these for now, pending future investigation" (OpenSubdiv)
        ep.assign(c, 2 / 3); ep.assign((c + 1) & 3, 1 / 3)
        em.assign(c, 2 / 3); em.assign((c + 3) & 3, 1 / 3)
    } else if (!corner.isBoundary) {
        // computeIrregularInteriorEdgePoints (:1119)
        const valence = corner.valence
        const weightWidth = 1 + 2 * valence
        const pW = new Float64Array(weightWidth), epW = new Float64Array(weightWidth), emW = new Float64Array(weightWidth)
        computeInteriorPointWeights(valence, corner.faceInRing, pW, epW, emW)
        p.assign(c, pW[0]); ep.assign(c, epW[0]); em.assign(c, emW[0])
        for (let i = 1; i < weightWidth; i++) {
            const r = corner.ringPoints[i - 1]
            p.assign(r, pW[i]); ep.assign(r, epW[i]); em.assign(r, emW[i])
        }
    } else if (corner.numFaces > 1) {
        // computeIrregularBoundaryEdgePoints (:1165)
        const valence = corner.valence
        const weightWidth = 1 + corner.valence + corner.numFaces
        const pW = new Float64Array(weightWidth), epW = new Float64Array(weightWidth), emW = new Float64Array(weightWidth)
        computeBoundaryPointWeights(valence, corner.faceInRing, pW, epW, emW)
        const N = weightWidth - 1
        const p1 = corner.ringPoints[0], pN = corner.ringPoints[2 * (valence - 1)]
        p.assign(c, pW[0]); p.assign(p1, pW[1]); p.assign(pN, pW[N])
        ep.assign(c, epW[0])
        if (corner.epOnBoundary) ep.assign(p1, epW[1])
        else for (let i = 1; i < weightWidth; i++) ep.assign(corner.ringPoints[i - 1], epW[i])
        em.assign(c, emW[0])
        if (corner.emOnBoundary) em.assign(pN, emW[N])
        // OpenSubdiv loops to i <= weightWidth here, one entry past the row, into the first entry of the Fp row
        // which is assigned afterwards in every case; the entries within the row are these:
        else for (let i = 1; i < weightWidth; i++) em.assign(corner.ringPoints[i - 1], emW[i])
    } else {
        // the irregular/smooth corner case
        p.assign(c, 4 / 6); p.assign((c + 1) & 3, 1 / 6); p.assign((c + 3) & 3, 1 / 6)
        ep.assign(c, 2 / 3); ep.assign((c + 1) & 3, 1 / 3)
        em.assign(c, 2 / 3); em.assign((c + 3) & 3, 1 / 3)
    }
}

/** `GregoryConverter::assignRegularFacePoints` (`catmarkPatchBuilder.cpp:1307`). */
function assignRegularFacePoints(c: number, corners: CornerTopology[], rows: Row[]): void {
    const fp = rows[5 * c + 3], fm = rows[5 * c + 4]
    const corner = corners[c]
    const cNext = (c + 1) & 3, cOpp = (c + 2) & 3, cPrev = (c + 3) & 3
    if (corner.fpIsRegular) {
        fp.assign(c, 4 / 9); fp.assign(cPrev, 2 / 9); fp.assign(cNext, 2 / 9); fp.assign(cOpp, 1 / 9)
    }
    if (corner.fmIsRegular) {
        fm.assign(c, 4 / 9); fm.assign(cPrev, 2 / 9); fm.assign(cNext, 2 / 9); fm.assign(cOpp, 1 / 9)
    }
}

/** `GregoryConverter::computeIrregularFacePoint` (`catmarkPatchBuilder.cpp:1252`). */
function computeIrregularFacePoint(
    cNear: number, edgeInNearRing: number, cFar: number, p: Row, eNear: Row, eFar: Row, fNear: Row, sign: number,
    corners: CornerTopology[], width: number,
): void {
    const near = corners[cNear], far = corners[cFar]
    const valence = near.valence
    const cosNear = near.cosFaceAngle, cosFar = far.cosFaceAngle
    const pCoeff = cosFar / 3
    const eNearCoeff = (3 - 2 * cosNear - cosFar) / 3
    const eFarCoeff = 2 * cosNear / 3
    const row = new Float64Array(width), mask = new Uint8Array(width)
    for (let i = 0; i < width; i++) {
        if (p.has[i]) { row[i] += pCoeff * p.w[i]; mask[i] = 1 }
        if (eNear.has[i]) { row[i] += eNearCoeff * eNear.w[i]; mask[i] = 1 }
        if (eFar.has[i]) { row[i] += eFarCoeff * eFar.w[i]; mask[i] = 1 }
    }
    // R about the interior edge: the two pairs of points opposite it
    const iEdgeInterior = edgeInNearRing
    const iEdgePrev = (iEdgeInterior + valence - 1) % valence
    const iEdgeNext = (iEdgeInterior + 1) % valence
    row[near.ringPoints[2 * iEdgePrev]] += -sign / 9
    row[near.ringPoints[2 * iEdgePrev + 1]] += -sign / 18
    row[near.ringPoints[2 * iEdgeInterior + 1]] += sign / 18
    row[near.ringPoints[2 * iEdgeNext]] += sign / 9
    // only the columns already present survive (the sparse row is built from the mask)
    for (let i = 0; i < width; i++) if (mask[i]) fNear.assign(i, row[i])
}

/** `GregoryConverter::computeIrregularFacePoints` (`catmarkPatchBuilder.cpp:1337`). */
function computeIrregularFacePoints(c: number, corners: CornerTopology[], rows: Row[], width: number): void {
    const corner = corners[c]
    const cNext = (c + 1) & 3, cPrev = (c + 3) & 3
    const epPrev = rows[5 * cPrev + 1], em = rows[5 * c + 2], p = rows[5 * c], ep = rows[5 * c + 1], emNext = rows[5 * cNext + 2]
    const fp = rows[5 * c + 3], fm = rows[5 * c + 4]
    if (!corner.fpIsRegular && !corner.fpIsCopied) {
        computeIrregularFacePoint(c, corner.faceInRing, cNext, p, ep, emNext, fp, 1, corners, width)
    }
    if (!corner.fmIsRegular && !corner.fmIsCopied) {
        computeIrregularFacePoint(c, (corner.faceInRing + 1) % corner.valence, cPrev, p, em, epPrev, fm, -1, corners, width)
    }
    if (corner.fpIsCopied) fp.copy(fm)
    if (corner.fmIsCopied) fm.copy(fp)
}
