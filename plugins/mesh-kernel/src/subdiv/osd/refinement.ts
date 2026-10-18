/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/refinement.h` and `vtr/refinement.cpp` (Copyright 2014 DreamWorks
 * Animation LLC): the mapping between a parent level and its refined child level, shared by the quad and triangle
 * splits. `printParentToChildMapping` (debugging) is not ported.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 */

import {Crease, isSharp, Options, Rule, SHARPNESS_INFINITE, SHARPNESS_SMOOTH, Split} from './sdc'
import {Level} from './level'
import {FVarLevel} from './fvarLevel'
import {FVarRefinement} from './fvarRefinement'
import {
    ET_BOUNDARY, ET_INF_SHARP, ET_NON_MANIFOLD, ET_SEMI_SHARP, INDEX_INVALID, IndexArray, indexIsValid, resizeVector, VT_BOUNDARY,
    VT_INCID_IRREG_FACE, VT_INCOMPLETE, VT_INF_IRREGULAR, VT_INF_SHARP, VT_INF_SHARP_CREASE, VT_INF_SHARP_EDGES, VT_NON_MANIFOLD,
    VT_SEMI_SHARP, VT_SEMI_SHARP_EDGES, VT_XORDINARY, vtWithRule,
} from './vtrTypes'

/** `Refinement::Options` (`refinement.h:76`). */
export interface RefinementOptions {
    sparse: boolean
    faceVertsFirst: boolean
    minimalTopology: boolean
}

/** `Refinement::SparseTag` (`refinement.h:140`). */
export interface SparseTag {
    selected: boolean
    transitional: number
}

/** `Refinement::ChildTag` (`refinement.h:147`). */
export interface ChildTag {
    incomplete: boolean
    parentType: number
    indexInParent: number
}

const copyTag = (t: ChildTag): ChildTag => ({incomplete: t.incomplete, parentType: t.parentType, indexInParent: t.indexInParent})

/** `Refinement::Relations` (`refinement.h:220`). */
export interface Relations {
    faceVertices: boolean
    faceEdges: boolean
    edgeVertices: boolean
    edgeFaces: boolean
    vertexFaces: boolean
    vertexEdges: boolean
}

const IndexSparseMaskNeighboring = 1 << 0
const IndexSparseMaskSelected = 1 << 1

export abstract class Refinement {
    splitType: Split = Split.TO_QUADS
    regFaceSize = -1
    uniform = false
    faceVertsFirst = false

    childFaceFromFaceCount = 0
    childEdgeFromFaceCount = 0
    childEdgeFromEdgeCount = 0
    childVertFromFaceCount = 0
    childVertFromEdgeCount = 0
    childVertFromVertCount = 0

    firstChildFaceFromFace = 0
    firstChildEdgeFromFace = 0
    firstChildEdgeFromEdge = 0
    firstChildVertFromFace = 0
    firstChildVertFromEdge = 0
    firstChildVertFromVert = 0

    /** Shared with the parent's face-vertex counts and offsets (`shareFaceVertCountsAndOffsets`). */
    faceChildFaceCountsAndOffsets: number[] = []
    faceChildEdgeCountsAndOffsets: number[] = []

    faceChildFaceIndices: number[] = []
    faceChildEdgeIndices: number[] = []
    faceChildVertIndex: number[] = []
    edgeChildEdgeIndices: number[] = []
    edgeChildVertIndex: number[] = []
    vertChildVertIndex: number[] = []

    childFaceParentIndex: number[] = []
    childEdgeParentIndex: number[] = []
    childVertexParentIndex: number[] = []

    childFaceTag: ChildTag[] = []
    childEdgeTag: ChildTag[] = []
    childVertexTag: ChildTag[] = []

    parentFaceTag: SparseTag[] = []
    parentEdgeTag: SparseTag[] = []
    parentVertexTag: SparseTag[] = []

    fvarChannels: FVarRefinement[] = []

    /** `Refinement::Refinement` (`refinement.cpp:31`). */
    constructor(readonly parent: Level, readonly child: Level, readonly options: Options) {
        child.depth = 1 + parent.getDepth()
    }

    getSplitType() { return this.splitType }
    getRegularFaceSize() { return this.regFaceSize }
    getOptions() { return this.options }
    getNumFVarChannels() { return this.fvarChannels.length }
    getFVarRefinement(c: number) { return this.fvarChannels[c] }
    hasFaceVerticesFirst() { return this.faceVertsFirst }

    getNumChildFacesFromFaces() { return this.childFaceFromFaceCount }
    getNumChildEdgesFromFaces() { return this.childEdgeFromFaceCount }
    getNumChildEdgesFromEdges() { return this.childEdgeFromEdgeCount }
    getNumChildVerticesFromFaces() { return this.childVertFromFaceCount }
    getNumChildVerticesFromEdges() { return this.childVertFromEdgeCount }
    getNumChildVerticesFromVertices() { return this.childVertFromVertCount }
    getFirstChildFaceFromFaces() { return this.firstChildFaceFromFace }
    getFirstChildEdgeFromFaces() { return this.firstChildEdgeFromFace }
    getFirstChildEdgeFromEdges() { return this.firstChildEdgeFromEdge }
    getFirstChildVertexFromFaces() { return this.firstChildVertFromFace }
    getFirstChildVertexFromEdges() { return this.firstChildVertFromEdge }
    getFirstChildVertexFromVertices() { return this.firstChildVertFromVert }

    getFaceChildVertex(f: number) { return this.faceChildVertIndex[f] }
    getEdgeChildVertex(e: number) { return this.edgeChildVertIndex[e] }
    getVertexChildVertex(v: number) { return this.vertChildVertIndex[v] }

    getFaceChildFaces(f: number): IndexArray {
        return new IndexArray(this.faceChildFaceIndices, this.faceChildFaceCountsAndOffsets[2 * f + 1], this.faceChildFaceCountsAndOffsets[2 * f])
    }
    getFaceChildEdges(f: number): IndexArray {
        return new IndexArray(this.faceChildEdgeIndices, this.faceChildEdgeCountsAndOffsets[2 * f + 1], this.faceChildEdgeCountsAndOffsets[2 * f])
    }
    getEdgeChildEdges(e: number): IndexArray {
        return new IndexArray(this.edgeChildEdgeIndices, e * 2, 2)
    }

    isChildVertexComplete(v: number) { return !this.childVertexTag[v].incomplete }
    getChildFaceParentFace(f: number) { return this.childFaceParentIndex[f] }
    getChildFaceInParentFace(f: number) { return this.childFaceTag[f].indexInParent }
    getChildEdgeParentIndex(e: number) { return this.childEdgeParentIndex[e] }
    getChildVertexParentIndex(v: number) { return this.childVertexParentIndex[v] }

    getParentFaceSparseTag(f: number) { return this.parentFaceTag[f] }
    getParentEdgeSparseTag(e: number) { return this.parentEdgeTag[e] }
    getParentVertexSparseTag(v: number) { return this.parentVertexTag[v] }
    getChildFaceTag(f: number) { return this.childFaceTag[f] }
    getChildEdgeTag(e: number) { return this.childEdgeTag[e] }
    getChildVertexTag(v: number) { return this.childVertexTag[v] }

    abstract allocateParentChildIndices(): void
    abstract markSparseFaceChildren(): void
    abstract populateFaceVertexRelation(): void
    abstract populateFaceEdgeRelation(): void
    abstract populateEdgeVertexRelation(): void
    abstract populateEdgeFaceRelation(): void
    abstract populateVertexFaceRelation(): void
    abstract populateVertexEdgeRelation(): void

    /** `initializeChildComponentCounts` (:56). */
    initializeChildComponentCounts(): void {
        this.child.faceCount = this.childFaceFromFaceCount
        this.child.edgeCount = this.childEdgeFromFaceCount + this.childEdgeFromEdgeCount
        this.child.vertCount = this.childVertFromFaceCount + this.childVertFromEdgeCount + this.childVertFromVertCount
    }

    /** `initializeSparseSelectionTags` (:64). */
    initializeSparseSelectionTags(): void {
        const make = (n: number) => Array.from({length: n}, () => ({selected: false, transitional: 0}))
        this.parentFaceTag = make(this.parent.getNumFaces())
        this.parentEdgeTag = make(this.parent.getNumEdges())
        this.parentVertexTag = make(this.parent.getNumVertices())
    }

    /** `refine` (:88). */
    refine(refineOptions: RefinementOptions = {sparse: false, faceVertsFirst: false, minimalTopology: false}): void {
        this.uniform = !refineOptions.sparse
        this.faceVertsFirst = refineOptions.faceVertsFirst
        const optionallyRefineFVar = this.parent.getNumFVarChannels() > 0
        this.populateParentToChildMapping()
        this.initializeChildComponentCounts()
        this.populateChildToParentMapping()
        this.propagateComponentTags()
        const relations: Relations = refineOptions.minimalTopology
            ? {faceVertices: true, faceEdges: false, edgeVertices: false, edgeFaces: false, vertexFaces: false, vertexEdges: false}
            : {faceVertices: true, faceEdges: true, edgeVertices: true, edgeFaces: true, vertexFaces: true, vertexEdges: true}
        if (optionallyRefineFVar) relations.vertexFaces = true
        this.subdivideTopology(relations)
        this.subdivideSharpnessValues()
        if (optionallyRefineFVar) this.subdivideFVarChannels()
    }

    /** `populateParentToChildMapping` (:166). */
    populateParentToChildMapping(): void {
        this.allocateParentChildIndices()
        if (!this.uniform) {
            if (this.parentVertexTag.length === 0) throw new Error('Unsupported empty sparse refinement detected in Refinement')
            this.markSparseChildComponentIndices()
        }
        this.populateParentChildIndices()
    }

    /** `populateParentChildIndices` (:220). */
    populateParentChildIndices(): void {
        const seq = this.uniform ? sequenceFullIndexVector : sequenceSparseIndexVector
        this.firstChildFaceFromFace = 0
        this.childFaceFromFaceCount = seq(this.faceChildFaceIndices, this.firstChildFaceFromFace)
        this.firstChildEdgeFromFace = 0
        this.childEdgeFromFaceCount = seq(this.faceChildEdgeIndices, this.firstChildEdgeFromFace)
        this.firstChildEdgeFromEdge = this.childEdgeFromFaceCount
        this.childEdgeFromEdgeCount = seq(this.edgeChildEdgeIndices, this.firstChildEdgeFromEdge)
        if (this.faceVertsFirst) {
            this.firstChildVertFromFace = 0
            this.childVertFromFaceCount = seq(this.faceChildVertIndex, this.firstChildVertFromFace)
            this.firstChildVertFromEdge = this.firstChildVertFromFace + this.childVertFromFaceCount
            this.childVertFromEdgeCount = seq(this.edgeChildVertIndex, this.firstChildVertFromEdge)
            this.firstChildVertFromVert = this.firstChildVertFromEdge + this.childVertFromEdgeCount
            this.childVertFromVertCount = seq(this.vertChildVertIndex, this.firstChildVertFromVert)
        } else {
            this.firstChildVertFromVert = 0
            this.childVertFromVertCount = seq(this.vertChildVertIndex, this.firstChildVertFromVert)
            this.firstChildVertFromFace = this.firstChildVertFromVert + this.childVertFromVertCount
            this.childVertFromFaceCount = seq(this.faceChildVertIndex, this.firstChildVertFromFace)
            this.firstChildVertFromEdge = this.firstChildVertFromFace + this.childVertFromFaceCount
            this.childVertFromEdgeCount = seq(this.edgeChildVertIndex, this.firstChildVertFromEdge)
        }
    }

    /** `populateChildToParentMapping` (:320). */
    populateChildToParentMapping(): void {
        const initial: ChildTag[][] = [0, 1].map(i => [0, 1, 2, 3].map(j => ({incomplete: i === 1, parentType: 0, indexInParent: j})))
        this.populateFaceParentVectors(initial)
        this.populateEdgeParentVectors(initial)
        this.populateVertexParentVectors(initial)
    }

    /** `populateFaceParentVectors` / `populateFaceParentFromParentFaces` (:339). */
    populateFaceParentVectors(initial: ChildTag[][]): void {
        const n = this.child.getNumFaces()
        this.childFaceTag = new Array(n)
        resizeVector(this.childFaceParentIndex, n)
        if (this.uniform) {
            let cFace = this.getFirstChildFaceFromFaces()
            for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace) {
                const cFaces = this.getFaceChildFaces(pFace)
                const tooLarge = cFaces.size > 4
                for (let i = 0; i < cFaces.size; ++i, ++cFace) {
                    this.childFaceTag[cFace] = copyTag(initial[0][tooLarge ? 0 : i])
                    this.childFaceParentIndex[cFace] = pFace
                }
            }
        } else {
            for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace) {
                const incomplete = !this.parentFaceTag[pFace].selected
                const cFaces = this.getFaceChildFaces(pFace)
                const tooLarge = cFaces.size > 4
                for (let i = 0; i < cFaces.size; ++i) {
                    if (!incomplete && cFaces.size === 4) {
                        this.childFaceTag[cFaces.get(i)] = copyTag(initial[0][i])
                        this.childFaceParentIndex[cFaces.get(i)] = pFace
                    } else if (indexIsValid(cFaces.get(i))) {
                        this.childFaceTag[cFaces.get(i)] = copyTag(initial[incomplete ? 1 : 0][tooLarge ? 0 : i])
                        this.childFaceParentIndex[cFaces.get(i)] = pFace
                    }
                }
            }
        }
    }

    /** `populateEdgeParentVectors` and the two fills (:404-500). */
    populateEdgeParentVectors(initial: ChildTag[][]): void {
        const n = this.child.getNumEdges()
        this.childEdgeTag = new Array(n)
        resizeVector(this.childEdgeParentIndex, n)
        // From parent faces.
        if (this.uniform) {
            let cEdge = this.getFirstChildEdgeFromFaces()
            for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace) {
                const cEdges = this.getFaceChildEdges(pFace)
                const tooLarge = cEdges.size > 4
                for (let i = 0; i < cEdges.size; ++i, ++cEdge) {
                    this.childEdgeTag[cEdge] = copyTag(initial[0][tooLarge ? 0 : i])
                    this.childEdgeParentIndex[cEdge] = pFace
                }
            }
        } else {
            for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace) {
                const incomplete = !this.parentFaceTag[pFace].selected
                const cEdges = this.getFaceChildEdges(pFace)
                const tooLarge = cEdges.size > 4
                for (let i = 0; i < cEdges.size; ++i) {
                    if (!incomplete && cEdges.size === 4) {
                        this.childEdgeTag[cEdges.get(i)] = copyTag(initial[0][i])
                        this.childEdgeParentIndex[cEdges.get(i)] = pFace
                    } else if (indexIsValid(cEdges.get(i))) {
                        this.childEdgeTag[cEdges.get(i)] = copyTag(initial[incomplete ? 1 : 0][tooLarge ? 0 : i])
                        this.childEdgeParentIndex[cEdges.get(i)] = pFace
                    }
                }
            }
        }
        // From parent edges.
        if (this.uniform) {
            let cEdge = this.getFirstChildEdgeFromEdges()
            for (let pEdge = 0; pEdge < this.parent.getNumEdges(); ++pEdge, cEdge += 2) {
                this.childEdgeTag[cEdge] = copyTag(initial[0][0])
                this.childEdgeTag[cEdge + 1] = copyTag(initial[0][1])
                this.childEdgeParentIndex[cEdge] = pEdge
                this.childEdgeParentIndex[cEdge + 1] = pEdge
            }
        } else {
            for (let pEdge = 0; pEdge < this.parent.getNumEdges(); ++pEdge) {
                const incomplete = !this.parentEdgeTag[pEdge].selected
                const cEdges = this.getEdgeChildEdges(pEdge)
                for (let i = 0; i < 2; ++i) {
                    if (!incomplete || indexIsValid(cEdges.get(i))) {
                        this.childEdgeTag[cEdges.get(i)] = copyTag(initial[incomplete ? 1 : 0][i])
                        this.childEdgeParentIndex[cEdges.get(i)] = pEdge
                    }
                }
            }
        }
    }

    /** `populateVertexParentVectors` and the three fills (:502-590). */
    populateVertexParentVectors(initial: ChildTag[][]): void {
        const n = this.child.getNumVertices()
        const fill = initial[this.uniform ? 0 : 1][0]
        this.childVertexTag = Array.from({length: n}, () => copyTag(fill))
        resizeVector(this.childVertexParentIndex, n)
        const complete = initial[0][0]
        // From parent faces.
        if (this.getNumChildVerticesFromFaces() !== 0) {
            if (this.uniform) {
                let cVert = this.getFirstChildVertexFromFaces()
                for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace, ++cVert) this.childVertexParentIndex[cVert] = pFace
            } else {
                for (let pFace = 0; pFace < this.parent.getNumFaces(); ++pFace) {
                    const cVert = this.faceChildVertIndex[pFace]
                    if (indexIsValid(cVert)) {
                        if (this.parentFaceTag[pFace].selected) this.childVertexTag[cVert] = copyTag(complete)
                        this.childVertexParentIndex[cVert] = pFace
                    }
                }
            }
        }
        // From parent edges.
        if (this.uniform) {
            let cVert = this.getFirstChildVertexFromEdges()
            for (let pEdge = 0; pEdge < this.parent.getNumEdges(); ++pEdge, ++cVert) this.childVertexParentIndex[cVert] = pEdge
        } else {
            for (let pEdge = 0; pEdge < this.parent.getNumEdges(); ++pEdge) {
                const cVert = this.edgeChildVertIndex[pEdge]
                if (indexIsValid(cVert)) {
                    if (this.parentEdgeTag[pEdge].selected) this.childVertexTag[cVert] = copyTag(complete)
                    this.childVertexParentIndex[cVert] = pEdge
                }
            }
        }
        // From parent vertices.
        if (this.uniform) {
            let cVert = this.getFirstChildVertexFromVertices()
            for (let pVert = 0; pVert < this.parent.getNumVertices(); ++pVert, ++cVert) this.childVertexParentIndex[cVert] = pVert
        } else {
            for (let pVert = 0; pVert < this.parent.getNumVertices(); ++pVert) {
                const cVert = this.vertChildVertIndex[pVert]
                if (indexIsValid(cVert)) {
                    if (this.parentVertexTag[pVert].selected) this.childVertexTag[cVert] = copyTag(complete)
                    this.childVertexParentIndex[cVert] = pVert
                }
            }
        }
    }

    /** `propagateComponentTags` (:602). */
    propagateComponentTags(): void {
        const parent = this.parent, child = this.child
        // `populateFaceTagVectors` (:610).
        resizeVector(child.faceTags, child.getNumFaces())
        for (let cFace = this.getFirstChildFaceFromFaces(), end = cFace + this.getNumChildFacesFromFaces(); cFace < end; ++cFace) {
            child.faceTags[cFace] = parent.faceTags[this.childFaceParentIndex[cFace]]
        }
        // `populateEdgeTagVectors` (:630).
        resizeVector(child.edgeTags, child.getNumEdges())
        for (let cEdge = this.getFirstChildEdgeFromFaces(), end = cEdge + this.getNumChildEdgesFromFaces(); cEdge < end; ++cEdge) child.edgeTags[cEdge] = 0
        for (let cEdge = this.getFirstChildEdgeFromEdges(), end = cEdge + this.getNumChildEdgesFromEdges(); cEdge < end; ++cEdge) {
            child.edgeTags[cEdge] = parent.edgeTags[this.childEdgeParentIndex[cEdge]]
        }
        // `populateVertexTagVectors` (:666).
        resizeVector(child.vertTags, child.getNumVertices())
        // From parent faces (:685).
        if (this.getNumChildVerticesFromFaces() !== 0) {
            const vTag = vtWithRule(0, Rule.SMOOTH)
            for (let cVert = this.getFirstChildVertexFromFaces(), end = cVert + this.getNumChildVerticesFromFaces(); cVert < end; ++cVert) {
                child.vertTags[cVert] = vTag
                if (parent.depth === 0 && parent.getNumFaceVertices(this.childVertexParentIndex[cVert]) !== this.regFaceSize) {
                    child.vertTags[cVert] |= VT_XORDINARY
                }
            }
        }
        // From parent edges (:713).
        for (let pEdge = 0; pEdge < parent.getNumEdges(); ++pEdge) {
            const cVert = this.edgeChildVertIndex[pEdge]
            if (!indexIsValid(cVert)) continue
            const pEdgeTag = parent.edgeTags[pEdge]
            const nonManifold = (pEdgeTag & ET_NON_MANIFOLD) !== 0
            const boundary = (pEdgeTag & ET_BOUNDARY) !== 0
            const semiSharp = (pEdgeTag & ET_SEMI_SHARP) !== 0
            const infSharp = (pEdgeTag & ET_INF_SHARP) !== 0
            let vTag = 0
            if (nonManifold) vTag |= VT_NON_MANIFOLD
            if (boundary) vTag |= VT_BOUNDARY
            if (semiSharp) vTag |= VT_SEMI_SHARP_EDGES
            if (infSharp) vTag |= VT_INF_SHARP_EDGES | VT_INF_SHARP_CREASE
            if (infSharp && nonManifold) vTag |= VT_INF_IRREGULAR
            child.vertTags[cVert] = vtWithRule(vTag, semiSharp || infSharp ? Rule.CREASE : Rule.SMOOTH)
        }
        // From parent vertices (:742).
        for (let cVert = this.getFirstChildVertexFromVertices(), end = cVert + this.getNumChildVerticesFromVertices(); cVert < end; ++cVert) {
            child.vertTags[cVert] = parent.vertTags[this.childVertexParentIndex[cVert]] & ~VT_INCID_IRREG_FACE
        }
        if (!this.uniform) {
            for (let cVert = 0; cVert < child.getNumVertices(); ++cVert) {
                if (this.childVertexTag[cVert].incomplete) child.vertTags[cVert] |= VT_INCOMPLETE
            }
        }
    }

    /** `subdivideTopology` (:763). */
    subdivideTopology(applyTo: Relations): void {
        if (applyTo.faceVertices) this.populateFaceVertexRelation()
        if (applyTo.faceEdges) this.populateFaceEdgeRelation()
        if (applyTo.edgeVertices) this.populateEdgeVertexRelation()
        if (applyTo.edgeFaces) this.populateEdgeFaceRelation()
        if (applyTo.vertexFaces) this.populateVertexFaceRelation()
        if (applyTo.vertexEdges) this.populateVertexEdgeRelation()
        const parent = this.parent, child = this.child
        if (this.splitType === Split.TO_QUADS) {
            child.maxValence = Math.max(parent.maxValence, 4)
            child.maxValence = Math.max(child.maxValence, 2 + parent.maxEdgeFaces)
        } else {
            child.maxValence = Math.max(parent.maxValence, 6)
            child.maxValence = Math.max(child.maxValence, 2 + parent.maxEdgeFaces * 2)
        }
    }

    /** `subdivideSharpnessValues` (:815). */
    subdivideSharpnessValues(): void {
        this.subdivideEdgeSharpness()
        this.subdivideVertexSharpness()
        this.reclassifySemisharpVertices()
    }

    /** `subdivideEdgeSharpness` (:843). */
    subdivideEdgeSharpness(): void {
        const creasing = new Crease(this.options)
        const child = this.child, parent = this.parent
        child.edgeSharpness = new Array(child.getNumEdges()).fill(SHARPNESS_SMOOTH)
        for (let cEdge = this.getFirstChildEdgeFromEdges(), end = cEdge + this.getNumChildEdgesFromEdges(); cEdge < end; ++cEdge) {
            const cEdgeTag = child.edgeTags[cEdge]
            if (cEdgeTag & ET_INF_SHARP) {
                child.edgeSharpness[cEdge] = SHARPNESS_INFINITE
            } else if (cEdgeTag & ET_SEMI_SHARP) {
                const pEdge = this.childEdgeParentIndex[cEdge]
                const pSharpness = parent.edgeSharpness[pEdge]
                let cSharpness: number
                if (creasing.isUniform()) {
                    cSharpness = creasing.subdivideUniformSharpness(pSharpness)
                } else {
                    const pEdgeVerts = parent.getEdgeVertices(pEdge)
                    const pVert = pEdgeVerts.get(this.childEdgeTag[cEdge].indexInParent)
                    const pVertEdges = parent.getVertexEdges(pVert)
                    const s: number[] = []
                    for (let i = 0; i < pVertEdges.size; ++i) s[i] = parent.edgeSharpness[pVertEdges.get(i)]
                    cSharpness = creasing.subdivideEdgeSharpnessAtVertex(pSharpness, pVertEdges.size, s)
                }
                child.edgeSharpness[cEdge] = cSharpness
                if (!isSharp(cSharpness)) child.edgeTags[cEdge] &= ~ET_SEMI_SHARP
            }
        }
    }

    /** `subdivideVertexSharpness` (:888). */
    subdivideVertexSharpness(): void {
        const creasing = new Crease(this.options)
        const child = this.child, parent = this.parent
        child.vertSharpness = new Array(child.getNumVertices()).fill(SHARPNESS_SMOOTH)
        for (let cVert = this.getFirstChildVertexFromVertices(), end = cVert + this.getNumChildVerticesFromVertices(); cVert < end; ++cVert) {
            const cVertTag = child.vertTags[cVert]
            if (cVertTag & VT_INF_SHARP) {
                child.vertSharpness[cVert] = SHARPNESS_INFINITE
            } else if (cVertTag & VT_SEMI_SHARP) {
                const pSharpness = parent.vertSharpness[this.childVertexParentIndex[cVert]]
                const cSharpness = creasing.subdivideVertexSharpness(pSharpness)
                child.vertSharpness[cVert] = cSharpness
                if (!isSharp(cSharpness)) child.vertTags[cVert] &= ~VT_SEMI_SHARP
            }
        }
    }

    /** `reclassifySemisharpVertices` (:920). */
    reclassifySemisharpVertices(): void {
        const creasing = new Crease(this.options)
        const child = this.child, parent = this.parent
        for (let cVert = this.getFirstChildVertexFromEdges(), end = cVert + this.getNumChildVerticesFromEdges(); cVert < end; ++cVert) {
            let cVertTag = child.vertTags[cVert]
            if (!(cVertTag & VT_SEMI_SHARP_EDGES)) continue
            const pEdge = this.childVertexParentIndex[cVert]
            const cEdges = this.getEdgeChildEdges(pEdge)
            const semi = (e: number) => (child.edgeTags[e] & ET_SEMI_SHARP) !== 0
            if (this.childVertexTag[cVert].incomplete) {
                const s = (indexIsValid(cEdges.get(0)) && semi(cEdges.get(0))) || (indexIsValid(cEdges.get(1)) && semi(cEdges.get(1)))
                cVertTag = s ? cVertTag | VT_SEMI_SHARP_EDGES : cVertTag & ~VT_SEMI_SHARP_EDGES
                cVertTag = vtWithRule(cVertTag, s ? Rule.CREASE : Rule.SMOOTH)
            } else {
                const sharpEdgeCount = (semi(cEdges.get(0)) ? 1 : 0) + (semi(cEdges.get(1)) ? 1 : 0)
                cVertTag = sharpEdgeCount > 0 ? cVertTag | VT_SEMI_SHARP_EDGES : cVertTag & ~VT_SEMI_SHARP_EDGES
                cVertTag = vtWithRule(cVertTag, creasing.determineVertexVertexRuleFromCount(0, sharpEdgeCount))
            }
            child.vertTags[cVert] = cVertTag
        }
        for (let cVert = this.getFirstChildVertexFromVertices(), end = cVert + this.getNumChildVerticesFromVertices(); cVert < end; ++cVert) {
            const pVert = this.childVertexParentIndex[cVert]
            const pVertTag = parent.vertTags[pVert]
            if (!(pVertTag & VT_SEMI_SHARP) && !(pVertTag & VT_SEMI_SHARP_EDGES)) continue
            let cVertTag = child.vertTags[cVert]
            const sharpVertexDecayed = (pVertTag & VT_SEMI_SHARP) !== 0 && !(cVertTag & VT_SEMI_SHARP)
            if ((pVertTag & VT_SEMI_SHARP_EDGES) || sharpVertexDecayed) {
                let infSharpEdgeCount = 0
                let semiSharpEdgeCount = 0
                if (child.getNumVertexEdgesTotal() > 0) {
                    const cEdges = child.getVertexEdges(cVert)
                    for (let i = 0; i < cEdges.size; ++i) {
                        const t = child.edgeTags[cEdges.get(i)]
                        infSharpEdgeCount += t & ET_INF_SHARP ? 1 : 0
                        semiSharpEdgeCount += t & ET_SEMI_SHARP ? 1 : 0
                    }
                } else {
                    const pEdges = parent.getVertexEdges(pVert)
                    const pVertInEdge = parent.getVertexEdgeLocalIndices(pVert)
                    for (let i = 0; i < pEdges.size; ++i) {
                        const cEdge = this.getEdgeChildEdges(pEdges.get(i)).get(pVertInEdge.get(i))
                        const t = child.edgeTags[cEdge]
                        infSharpEdgeCount += t & ET_INF_SHARP ? 1 : 0
                        semiSharpEdgeCount += t & ET_SEMI_SHARP ? 1 : 0
                    }
                }
                cVertTag = semiSharpEdgeCount > 0 ? cVertTag | VT_SEMI_SHARP_EDGES : cVertTag & ~VT_SEMI_SHARP_EDGES
                if (!(cVertTag & VT_SEMI_SHARP) && !(cVertTag & VT_INF_SHARP)) {
                    cVertTag = vtWithRule(cVertTag, creasing.determineVertexVertexRuleFromCount(0, infSharpEdgeCount + semiSharpEdgeCount))
                }
                child.vertTags[cVert] = cVertTag
            }
        }
    }

    /** `subdivideFVarChannels` (:1010). */
    subdivideFVarChannels(): void {
        const channelCount = this.parent.getNumFVarChannels()
        for (let channel = 0; channel < channelCount; ++channel) {
            const parentFVar = this.parent.fvarChannels[channel]
            const childFVar = new FVarLevel(this.child)
            const refineFVar = new FVarRefinement(this, parentFVar, childFVar)
            refineFVar.applyRefinement()
            this.child.fvarChannels.push(childFVar)
            this.fvarChannels.push(refineFVar)
        }
    }

    /** `markSparseChildComponentIndices` (:1050). */
    markSparseChildComponentIndices(): void {
        this.markSparseVertexChildren()
        this.markSparseEdgeChildren()
        this.markSparseFaceChildren()
    }

    /** `markSparseVertexChildren` (:1072). */
    markSparseVertexChildren(): void {
        for (let pVert = 0; pVert < this.parent.getNumVertices(); ++pVert) {
            if (this.parentVertexTag[pVert].selected) this.vertChildVertIndex[pVert] = IndexSparseMaskSelected
        }
    }

    /** `markSparseEdgeChildren` (:1088). */
    markSparseEdgeChildren(): void {
        for (let pEdge = 0; pEdge < this.parent.getNumEdges(); ++pEdge) {
            const eChild = 2 * pEdge
            const eVerts = this.parent.getEdgeVertices(pEdge)
            const pEdgeTag = this.parentEdgeTag[pEdge]
            if (pEdgeTag.selected) {
                this.edgeChildEdgeIndices[eChild] = IndexSparseMaskSelected
                this.edgeChildEdgeIndices[eChild + 1] = IndexSparseMaskSelected
                this.edgeChildVertIndex[pEdge] = IndexSparseMaskSelected
            } else {
                if (this.parentVertexTag[eVerts.get(0)].selected) {
                    this.edgeChildEdgeIndices[eChild] = IndexSparseMaskNeighboring
                    this.edgeChildVertIndex[pEdge] = IndexSparseMaskNeighboring
                }
                if (this.parentVertexTag[eVerts.get(1)].selected) {
                    this.edgeChildEdgeIndices[eChild + 1] = IndexSparseMaskNeighboring
                    this.edgeChildVertIndex[pEdge] = IndexSparseMaskNeighboring
                }
            }
            const eFaces = this.parent.getEdgeFaces(pEdge)
            if (eFaces.size === 2) {
                pEdgeTag.transitional = this.parentFaceTag[eFaces.get(0)].selected !== this.parentFaceTag[eFaces.get(1)].selected ? 1 : 0
            } else if (eFaces.size < 2) {
                pEdgeTag.transitional = 0
            } else {
                const isFace0Selected = this.parentFaceTag[eFaces.get(0)].selected
                pEdgeTag.transitional = 0
                for (let i = 1; i < eFaces.size; ++i) {
                    if (this.parentFaceTag[eFaces.get(i)].selected !== isFace0Selected) {
                        pEdgeTag.transitional = 1
                        break
                    }
                }
            }
        }
    }
}

/** `sequenceSparseIndexVector` (:190). */
function sequenceSparseIndexVector(v: number[], baseValue = 0): number {
    let validCount = 0
    for (let i = 0; i < v.length; ++i) v[i] = v[i] !== 0 ? baseValue + validCount++ : INDEX_INVALID
    return validCount
}

/** `sequenceFullIndexVector` (:199). */
function sequenceFullIndexVector(v: number[], baseValue = 0): number {
    for (let i = 0; i < v.length; ++i) v[i] = baseValue++
    return v.length
}

