/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/topologyRefiner.h`, `far/topologyRefiner.cpp`,
 * `far/topologyRefinerFactory.h` and `far/topologyRefinerFactory.cpp` (Copyright 2014 DreamWorks Animation LLC).
 * and `vtr/sparseSelector.h/.cpp` (feature-adaptive refinement for the limit surface, subplan 15e phase 2).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 */

import {Crease, FVarLinearInterpolation, isInfinite, isSemiSharp, isSharp, Options, Rule, SchemeType, SchemeTypeTraits, SHARPNESS_INFINITE, Split, VtxBoundaryInterpolation} from './sdc'
import {Level} from './level'
import {FVarLevel} from './fvarLevel'
import {QuadRefinement} from './quadRefinement'
import type {Refinement} from './refinement'
import {
    ET_BOUNDARY, ET_INF_SHARP, ET_NON_MANIFOLD, ET_SEMI_SHARP, FT_HOLE, IndexArray, VALENCE_LIMIT, VT_BOUNDARY, VT_CORNER, VT_INCID_IRREG_FACE,
    VT_INCOMPLETE, VT_INF_IRREGULAR, VT_INF_SHARP, VT_INF_SHARP_CREASE, VT_INF_SHARP_EDGES, VT_NON_MANIFOLD, VT_SEMI_SHARP,
    VT_SEMI_SHARP_EDGES, VT_XORDINARY, vtRule, vtWithRule,
} from './vtrTypes'

/** `TopologyRefiner::UniformOptions` (`topologyRefiner.h:103`). */
export interface UniformOptions {
    refinementLevel: number
    orderVerticesFromFacesFirst: boolean
    fullTopologyInLastLevel: boolean
}

export function uniformOptions(level: number): UniformOptions {
    return {refinementLevel: level & 0xf, orderVerticesFromFacesFirst: false, fullTopologyInLastLevel: false}
}

/** `Far::TopologyLevel` (`topologyLevel.h`): the public view of a refinement level. */
export class TopologyLevel {
    constructor(readonly level: Level, readonly refToParent: Refinement | undefined, readonly refToChild: Refinement | undefined) {}

    getNumVertices() { return this.level.getNumVertices() }
    getNumFaces() { return this.level.getNumFaces() }
    getNumEdges() { return this.level.getNumEdges() }
    getNumFaceVertices() { return this.level.getNumFaceVerticesTotal() }
    getFaceVertices(f: number): IndexArray { return this.level.getFaceVertices(f) }
    getFaceEdges(f: number): IndexArray { return this.level.getFaceEdges(f) }
    getEdgeVertices(e: number): IndexArray { return this.level.getEdgeVertices(e) }
    getEdgeFaces(e: number): IndexArray { return this.level.getEdgeFaces(e) }
    getVertexFaces(v: number): IndexArray { return this.level.getVertexFaces(v) }
    getVertexEdges(v: number): IndexArray { return this.level.getVertexEdges(v) }
    getEdgeSharpness(e: number) { return this.level.getEdgeSharpness(e) }
    getVertexSharpness(v: number) { return this.level.getVertexSharpness(v) }
    isFaceHole(f: number) { return this.level.isFaceHole(f) }
    getNumFVarValues(channel = 0) { return this.level.getNumFVarValues(channel) }
    getFaceFVarValues(f: number, channel = 0): IndexArray { return this.level.getFaceFVarValues(f, channel) }
    findEdge(v0: number, v1: number) { return this.level.findEdge(v0, v1) }
    getFaceChildFaces(f: number): IndexArray { return this.refToChild!.getFaceChildFaces(f) }
}

/** `Far::TopologyRefiner` (`topologyRefiner.h:50`). */
export class TopologyRefiner {
    isUniform = true
    hasHoles = false
    hasIrregFaces = false
    readonly regFaceSize: number
    maxLevel = 0
    uniformOptions: UniformOptions = uniformOptions(0)
    totalVertices = 0
    totalEdges = 0
    totalFaces = 0
    totalFaceVertices = 0
    maxValence = 0
    levels: Level[] = []
    refinements: Refinement[] = []
    farLevels: TopologyLevel[] = []

    /** `TopologyRefiner::TopologyRefiner(schemeType, schemeOptions)` (:29). */
    constructor(readonly subdivType: SchemeType, readonly subdivOptions: Options) {
        this.regFaceSize = SchemeTypeTraits.getRegularFaceSize(subdivType)
        this.levels.push(new Level())
        this.assembleFarLevels()
    }

    getSchemeType() { return this.subdivType }
    getSchemeOptions() { return this.subdivOptions }
    getIsUniform() { return this.isUniform }
    getNumLevels() { return this.farLevels.length }
    getMaxLevel() { return this.maxLevel }
    getMaxValence() { return this.maxValence }
    getHasHoles() { return this.hasHoles }
    getNumVerticesTotal() { return this.totalVertices }
    getNumEdgesTotal() { return this.totalEdges }
    getNumFacesTotal() { return this.totalFaces }
    getNumFaceVerticesTotal() { return this.totalFaceVertices }
    getLevel(l: number): TopologyLevel { return this.farLevels[l] }
    getVtrLevel(l: number): Level { return this.levels[l] }
    getRefinement(l: number): Refinement { return this.refinements[l] }
    getNumFVarChannels() { return this.levels[0].getNumFVarChannels() }
    getFVarLinearInterpolation(channel = 0): FVarLinearInterpolation { return this.levels[0].getFVarOptions(channel).fvarLinearInterpolation }

    /** `GetNumFVarValuesTotal` (:173). */
    getNumFVarValuesTotal(channel = 0): number {
        let sum = 0
        for (const l of this.levels) sum += l.getNumFVarValues(channel)
        return sum
    }

    /** `initializeInventory` (:103). */
    initializeInventory(): void {
        const base = this.levels[0]
        this.totalVertices = base.getNumVertices()
        this.totalEdges = base.getNumEdges()
        this.totalFaces = base.getNumFaces()
        this.totalFaceVertices = base.getNumFaceVerticesTotal()
        this.maxValence = base.getMaxValence()
    }

    /** `updateInventory` (:125). */
    updateInventory(newLevel: Level): void {
        this.totalVertices += newLevel.getNumVertices()
        this.totalEdges += newLevel.getNumEdges()
        this.totalFaces += newLevel.getNumFaces()
        this.totalFaceVertices += newLevel.getNumFaceVerticesTotal()
        this.maxValence = Math.max(this.maxValence, newLevel.getMaxValence())
    }

    /** `assembleFarLevels` (:146). */
    assembleFarLevels(): void {
        const n = this.refinements.length
        this.farLevels = []
        for (let i = 0; i <= n; i++) this.farLevels.push(new TopologyLevel(this.levels[i], i > 0 ? this.refinements[i - 1] : undefined, i < n ? this.refinements[i] : undefined))
    }

    /** `RefineUniform` (:183). */
    refineUniform(options: UniformOptions): void {
        if (this.levels[0].getNumVertices() === 0) throw new Error('Failure in TopologyRefiner::RefineUniform() -- base level is uninitialized.')
        if (this.refinements.length) throw new Error('Failure in TopologyRefiner::RefineUniform() -- previous refinements already applied.')
        this.uniformOptions = options
        this.isUniform = true
        this.maxLevel = options.refinementLevel
        const splitType = SchemeTypeTraits.getTopologicalSplitType(this.subdivType)
        if (splitType !== Split.TO_QUADS) throw new Error('OpenSubdiv: Vtr::TriRefinement (Loop scheme) is not ported')
        for (let i = 1; i <= options.refinementLevel; ++i) {
            const minimalTopology = options.fullTopologyInLastLevel ? false : i === options.refinementLevel
            const parentLevel = this.levels[i - 1]
            const childLevel = new Level()
            const refinement = new QuadRefinement(parentLevel, childLevel, this.subdivOptions)
            refinement.refine({sparse: false, faceVertsFirst: options.orderVerticesFromFacesFirst, minimalTopology})
            this.levels.push(childLevel)
            this.updateInventory(childLevel)
            this.refinements.push(refinement)
        }
        this.assembleFarLevels()
    }

    adaptiveOptions: AdaptiveOptions = adaptiveOptions(0)

    /** `appendLevel` (:149). */
    appendLevel(newLevel: Level): void {
        this.levels.push(newLevel)
        this.updateInventory(newLevel)
    }

    /** `RefineAdaptive(options, baseFacesToRefine)` (:330). */
    refineAdaptive(options: AdaptiveOptions, baseFacesToRefine: number[] = []): void {
        if (this.levels[0].getNumVertices() === 0) throw new Error('Failure in TopologyRefiner::RefineAdaptive() -- base level is uninitialized.')
        if (this.refinements.length) throw new Error('Failure in TopologyRefiner::RefineAdaptive() -- previous refinements already applied.')
        this.isUniform = false
        this.adaptiveOptions = options
        const nonLinearScheme = SchemeTypeTraits.getLocalNeighborhoodSize(this.subdivType)
        const shallowLevel = Math.min(options.secondaryLevel, options.isolationLevel)
        const deeperLevel = options.isolationLevel
        const potentialMaxLevel = nonLinearScheme ? deeperLevel : (this.hasIrregFaces ? 1 : 0)
        const moreFeaturesMask = initializeFeatures(options, this.regFaceSize)
        const lessFeaturesMask = {...moreFeaturesMask}
        if (shallowLevel < potentialMaxLevel) reduceFeatures(lessFeaturesMask, options)
        if (moreFeaturesMask.selectFVarFeatures && nonLinearScheme) {
            let nonLinearChannelsPresent = false
            for (let channel = 0; channel < this.levels[0].getNumFVarChannels(); ++channel) {
                nonLinearChannelsPresent ||= !this.levels[0].getFVarLevel(channel).isLinear
            }
            if (!nonLinearChannelsPresent) {
                moreFeaturesMask.selectFVarFeatures = false
                lessFeaturesMask.selectFVarFeatures = false
            }
        }
        const refineOptions = {sparse: true, minimalTopology: false, faceVertsFirst: options.orderVerticesFromFacesFirst}
        const splitType = SchemeTypeTraits.getTopologicalSplitType(this.subdivType)
        if (splitType !== Split.TO_QUADS) throw new Error('OpenSubdiv: Vtr::TriRefinement (Loop scheme) is not ported')
        for (let i = 1; i <= potentialMaxLevel; ++i) {
            const parentLevel = this.levels[i - 1]
            const childLevel = new Level()
            const refinement = new QuadRefinement(parentLevel, childLevel, this.subdivOptions)
            const selector = new SparseSelector(refinement)
            const levelFeatures = i <= shallowLevel ? moreFeaturesMask : lessFeaturesMask
            if (i > 1) this.selectFeatureAdaptiveComponents(selector, levelFeatures, [])
            else if (nonLinearScheme) this.selectFeatureAdaptiveComponents(selector, levelFeatures, baseFacesToRefine)
            else this.selectLinearIrregularFaces(selector, baseFacesToRefine)
            if (selector.isSelectionEmpty()) break
            refinement.refine(refineOptions)
            this.appendLevel(childLevel)
            this.refinements.push(refinement)
        }
        this.maxLevel = this.refinements.length
        this.assembleFarLevels()
    }

    /** `selectFeatureAdaptiveComponents` (:740). */
    selectFeatureAdaptiveComponents(selector: SparseSelector, featureMask: FeatureMask, facesToRefine: number[]): void {
        const level = selector.getRefinement().parent
        const numFacesToRefine = facesToRefine.length ? facesToRefine.length : level.getNumFaces()
        const numFVarChannels = featureMask.selectFVarFeatures ? level.getNumFVarChannels() : 0
        for (let fIndex = 0; fIndex < numFacesToRefine; ++fIndex) {
            const face = facesToRefine.length ? facesToRefine[fIndex] : fIndex
            if (this.hasHoles && level.isFaceHole(face)) continue
            let selectFace = doesFaceHaveFeatures(level, face, featureMask, this.regFaceSize)
            if (!selectFace && featureMask.selectFVarFeatures) {
                for (let channel = 0; !selectFace && channel < numFVarChannels; ++channel) {
                    if (!level.doesFaceFVarTopologyMatch(face, channel)) {
                        selectFace = doesFaceHaveDistinctFaceVaryingFeatures(level, face, featureMask, channel)
                    }
                }
            }
            if (selectFace) selector.selectFace(face)
        }
    }

    /** `selectLinearIrregularFaces` (:788). */
    selectLinearIrregularFaces(selector: SparseSelector, facesToRefine: number[]): void {
        const level = selector.getRefinement().parent
        const numFacesToRefine = facesToRefine.length ? facesToRefine.length : level.getNumFaces()
        for (let fIndex = 0; fIndex < numFacesToRefine; ++fIndex) {
            const face = facesToRefine.length ? facesToRefine[fIndex] : fIndex
            if (this.hasHoles && level.isFaceHole(face)) continue
            if (level.getFaceVertices(face).size !== this.regFaceSize) selector.selectFace(face)
        }
    }
}

/** `TopologyRefiner::AdaptiveOptions` (`topologyRefiner.h:139`). */
export interface AdaptiveOptions {
    isolationLevel: number
    secondaryLevel: number
    useSingleCreasePatch: boolean
    useInfSharpPatch: boolean
    considerFVarChannels: boolean
    orderVerticesFromFacesFirst: boolean
}

export function adaptiveOptions(level: number): AdaptiveOptions {
    return {isolationLevel: level & 0xf, secondaryLevel: 0xf, useSingleCreasePatch: false, useInfSharpPatch: false, considerFVarChannels: false,
        orderVerticesFromFacesFirst: false}
}

// region feature-adaptive selection (`topologyRefiner.cpp:259-737`)

/** `internal::FeatureMask` (:270). */
export interface FeatureMask {
    selectXOrdinaryInterior: boolean
    selectXOrdinaryBoundary: boolean
    selectSemiSharpSingle: boolean
    selectSemiSharpNonSingle: boolean
    selectInfSharpRegularCrease: boolean
    selectInfSharpRegularCorner: boolean
    selectInfSharpIrregularDart: boolean
    selectInfSharpIrregularCrease: boolean
    selectInfSharpIrregularCorner: boolean
    selectUnisolatedInteriorEdge: boolean
    selectNonManifold: boolean
    selectFVarFeatures: boolean
}

/** `FeatureMask::InitializeFeatures` (:311). */
function initializeFeatures(options: AdaptiveOptions, regFaceSize: number): FeatureMask {
    const useSingleCreasePatch = options.useSingleCreasePatch && regFaceSize === 4
    return {
        selectXOrdinaryInterior: true,
        selectXOrdinaryBoundary: true,
        selectSemiSharpSingle: !useSingleCreasePatch,
        selectSemiSharpNonSingle: true,
        selectInfSharpRegularCrease: !(options.useInfSharpPatch || useSingleCreasePatch),
        selectInfSharpRegularCorner: !options.useInfSharpPatch,
        selectInfSharpIrregularDart: true,
        selectInfSharpIrregularCrease: true,
        selectInfSharpIrregularCorner: true,
        selectUnisolatedInteriorEdge: useSingleCreasePatch && !options.useInfSharpPatch,
        selectNonManifold: true,
        selectFVarFeatures: options.considerFVarChannels,
    }
}

/** `FeatureMask::ReduceFeatures` (:350). */
function reduceFeatures(m: FeatureMask, options: AdaptiveOptions): void {
    m.selectXOrdinaryInterior = false
    m.selectXOrdinaryBoundary = false
    if (options.useInfSharpPatch) {
        m.selectInfSharpRegularCrease = false
        m.selectInfSharpRegularCorner = false
        m.selectInfSharpIrregularDart = false
        m.selectInfSharpIrregularCrease = false
    }
}

/** `doesInfSharpVTagHaveFeatures` (:493). */
function doesInfSharpVTagHaveFeatures(compVTag: number, featureMask: FeatureMask): boolean {
    const rule = vtRule(compVTag)
    if (compVTag & VT_INF_IRREGULAR) {
        if (rule & Rule.CORNER) return featureMask.selectInfSharpIrregularCorner
        else if (rule & Rule.CREASE) return compVTag & VT_BOUNDARY ? featureMask.selectXOrdinaryBoundary : featureMask.selectInfSharpIrregularCrease
        else if (rule & Rule.DART) return featureMask.selectInfSharpIrregularDart
    } else if (compVTag & VT_BOUNDARY) {
        if (rule & Rule.CORNER) return compVTag & VT_CORNER ? false : featureMask.selectInfSharpRegularCorner
        else return false
    } else {
        if (rule & Rule.CORNER) return featureMask.selectInfSharpRegularCorner
        else return featureMask.selectInfSharpRegularCrease
    }
    return false
}

/** `doesInfSharpFaceHaveFeatures` (:531). */
function doesInfSharpFaceHaveFeatures(compVTag: number, vTags: number[], numVerts: number, featureMask: FeatureMask): boolean {
    const isolateQuadBoundaries = false
    const atLeastOneSmoothCorner = (vtRule(compVTag) & Rule.SMOOTH) !== 0
    if (numVerts === 4) {
        if (atLeastOneSmoothCorner) return doesInfSharpVTagHaveFeatures(compVTag, featureMask)
        else if (isolateQuadBoundaries) return true
        else if (featureMask.selectUnisolatedInteriorEdge) {
            for (let i = 0; i < 4; ++i) if (vTags[i] & VT_INF_SHARP_EDGES && !(vTags[i] & VT_BOUNDARY)) return true
        }
    } else {
        if (atLeastOneSmoothCorner && !(compVTag & VT_BOUNDARY)) return doesInfSharpVTagHaveFeatures(compVTag, featureMask)
    }
    for (let i = 0; i < numVerts; ++i) {
        if (!(vtRule(vTags[i]) & Rule.SMOOTH)) {
            if (doesInfSharpVTagHaveFeatures(vTags[i], featureMask)) return true
        }
    }
    return false
}

/** `Level::VTag::BitwiseOr` (`level.h:100`). */
function vTagBitwiseOr(vTags: number[], size: number): number {
    let t = vTags[0]
    for (let i = 1; i < size; ++i) t |= vTags[i]
    return t
}

/** `doesFaceHaveFeatures` (:597). */
function doesFaceHaveFeatures(level: Level, face: number, featureMask: FeatureMask, regFaceSize: number): boolean {
    const fVerts = level.getFaceVertices(face)
    if (fVerts.size !== regFaceSize) return true
    const vTags: number[] = []
    level.getFaceVTags(face, vTags)
    const compFaceVTag = vTagBitwiseOr(vTags, fVerts.size)
    if (compFaceVTag & VT_INCID_IRREG_FACE) return true
    if (compFaceVTag & VT_INCOMPLETE) return false
    if (compFaceVTag & VT_NON_MANIFOLD && featureMask.selectNonManifold) return true
    const compRule = vtRule(compFaceVTag)
    if (compFaceVTag & VT_XORDINARY && featureMask.selectXOrdinaryInterior) {
        if (compRule === Rule.SMOOTH) return true
        else if (level.getDepth() < 2) {
            for (let i = 0; i < fVerts.size; ++i) {
                if (vTags[i] & VT_XORDINARY && vtRule(vTags[i]) === Rule.SMOOTH) return true
            }
        }
    }
    if (compRule === Rule.SMOOTH) return false
    if (compFaceVTag & (VT_SEMI_SHARP | VT_SEMI_SHARP_EDGES)) {
        if (featureMask.selectSemiSharpSingle && featureMask.selectSemiSharpNonSingle) return true
        else if (level.isSingleCreasePatch(face)) return featureMask.selectSemiSharpSingle
        else return featureMask.selectSemiSharpNonSingle
    }
    if (compFaceVTag & (VT_INF_SHARP | VT_INF_SHARP_EDGES)) return doesInfSharpFaceHaveFeatures(compFaceVTag, vTags, fVerts.size, featureMask)
    return false
}

/** `doesFaceHaveDistinctFaceVaryingFeatures` (:691). */
function doesFaceHaveDistinctFaceVaryingFeatures(level: Level, face: number, featureMask: FeatureMask, fvarChannel: number): boolean {
    const fVerts = level.getFaceVertices(face)
    const vTags: number[] = []
    for (let i = 0; i < fVerts.size; ++i) vTags[i] = level.getVertexCompositeFVarVTag(fVerts.get(i), fvarChannel)
    const compVTag = vTagBitwiseOr(vTags, fVerts.size)
    if (compVTag & VT_INCOMPLETE) return false
    if (compVTag & VT_NON_MANIFOLD && featureMask.selectNonManifold) return true
    if (compVTag & VT_XORDINARY && featureMask.selectXOrdinaryInterior) return true
    return doesInfSharpFaceHaveFeatures(compVTag, vTags, fVerts.size, featureMask)
}

/** `Vtr::internal::SparseSelector` (`vtr/sparseSelector.h`, `.cpp`). */
export class SparseSelector {
    private selected = false
    constructor(private readonly refine: Refinement) {}

    getRefinement(): Refinement { return this.refine }
    isSelectionEmpty() { return !this.selected }

    /** `initializeSelection` (:29). */
    private initializeSelection(): void {
        if (!this.selected) {
            this.refine.initializeSparseSelectionTags()
            this.selected = true
        }
    }

    selectVertex(parentVertex: number): void {
        this.initializeSelection()
        this.refine.getParentVertexSparseTag(parentVertex).selected = true
    }

    selectEdge(parentEdge: number): void {
        this.initializeSelection()
        if (!this.refine.getParentEdgeSparseTag(parentEdge).selected) {
            this.refine.getParentEdgeSparseTag(parentEdge).selected = true
            const eVerts = this.refine.parent.getEdgeVertices(parentEdge)
            this.refine.getParentVertexSparseTag(eVerts.get(0)).selected = true
            this.refine.getParentVertexSparseTag(eVerts.get(1)).selected = true
        }
    }

    selectFace(parentFace: number): void {
        this.initializeSelection()
        if (!this.refine.getParentFaceSparseTag(parentFace).selected) {
            this.refine.getParentFaceSparseTag(parentFace).selected = true
            const fEdges = this.refine.parent.getFaceEdges(parentFace)
            const fVerts = this.refine.parent.getFaceVertices(parentFace)
            for (let i = 0; i < fVerts.size; ++i) {
                this.refine.getParentEdgeSparseTag(fEdges.get(i)).selected = true
                this.refine.getParentVertexSparseTag(fVerts.get(i)).selected = true
            }
        }
    }
}

// endregion

// region TopologyRefinerFactory

/** `TopologyRefinerFactoryBase::Options` (`topologyRefinerFactory.h:49`). */
export interface FactoryOptions {
    schemeType: SchemeType
    schemeOptions: Options
    validateFullTopology: boolean
}

/**
 * The client half of `TopologyRefinerFactory<MESH>` (`topologyRefinerFactory.h:163`): the specialisations a mesh
 * representation provides. Each returns false on failure.
 */
export interface TopologyRefinerFactoryMesh {
    resizeComponentTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean
    assignComponentTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean
    assignComponentTags(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean
    assignFaceVaryingTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean
}

/** `TopologyRefinerFactory<MESH>` / `TopologyRefinerFactoryBase` (`topologyRefinerFactory.h`, `.cpp`). */
export class TopologyRefinerFactory {
    /** `Create(mesh, options)` (:293): undefined when the topology is rejected. */
    static create(mesh: TopologyRefinerFactoryMesh, options: FactoryOptions): TopologyRefiner | undefined {
        const refiner = new TopologyRefiner(options.schemeType, options.schemeOptions)
        if (!new TopologyRefinerFactory().populateBaseLevel(refiner, mesh, options)) return undefined
        return refiner
    }

    /** `populateBaseLevel` (:313). */
    populateBaseLevel(refiner: TopologyRefiner, mesh: TopologyRefinerFactoryMesh, options: FactoryOptions): boolean {
        if (!mesh.resizeComponentTopology(refiner, this)) return false
        if (!this.prepareComponentTopologySizing(refiner)) return false
        if (!mesh.assignComponentTopology(refiner, this)) return false
        if (!this.prepareComponentTopologyAssignment(refiner, options.validateFullTopology)) return false
        if (!mesh.assignComponentTags(refiner, this)) return false
        if (!this.prepareComponentTagsAndSharpness(refiner)) return false
        if (!mesh.assignFaceVaryingTopology(refiner, this)) return false
        if (!this.prepareFaceVaryingChannels(refiner)) return false
        return true
    }

    // region base level access (`topologyRefinerFactory.h:340-480`)
    setNumBaseFaces(r: TopologyRefiner, n: number) { r.levels[0].resizeFaces(n) }
    setNumBaseEdges(r: TopologyRefiner, n: number) { r.levels[0].resizeEdges(n) }
    setNumBaseVertices(r: TopologyRefiner, n: number) { r.levels[0].resizeVertices(n) }
    getNumBaseFaces(r: TopologyRefiner) { return r.levels[0].getNumFaces() }
    getNumBaseEdges(r: TopologyRefiner) { return r.levels[0].getNumEdges() }
    getNumBaseVertices(r: TopologyRefiner) { return r.levels[0].getNumVertices() }
    setNumBaseFaceVertices(r: TopologyRefiner, f: number, count: number) {
        r.levels[0].resizeFaceVerticesOf(f, count)
        r.hasIrregFaces = r.hasIrregFaces || count !== r.regFaceSize
    }
    setNumBaseEdgeFaces(r: TopologyRefiner, e: number, count: number) { r.levels[0].resizeEdgeFacesOf(e, count) }
    setNumBaseVertexFaces(r: TopologyRefiner, v: number, count: number) { r.levels[0].resizeVertexFacesOf(v, count) }
    setNumBaseVertexEdges(r: TopologyRefiner, v: number, count: number) { r.levels[0].resizeVertexEdgesOf(v, count) }
    getBaseFaceVertices(r: TopologyRefiner, f: number) { return r.levels[0].getFaceVertices(f) }
    getBaseFaceEdges(r: TopologyRefiner, f: number) { return r.levels[0].getFaceEdges(f) }
    getBaseEdgeVertices(r: TopologyRefiner, e: number) { return r.levels[0].getEdgeVertices(e) }
    getBaseEdgeFaces(r: TopologyRefiner, e: number) { return r.levels[0].getEdgeFaces(e) }
    getBaseVertexFaces(r: TopologyRefiner, v: number) { return r.levels[0].getVertexFaces(v) }
    getBaseVertexEdges(r: TopologyRefiner, v: number) { return r.levels[0].getVertexEdges(v) }
    findBaseEdge(r: TopologyRefiner, v0: number, v1: number) { return r.levels[0].findEdge(v0, v1) }
    populateBaseLocalIndices(r: TopologyRefiner) { r.levels[0].populateLocalIndices() }
    setBaseEdgeNonManifold(r: TopologyRefiner, e: number, b: boolean) { r.levels[0].setEdgeNonManifold(e, b) }
    setBaseVertexNonManifold(r: TopologyRefiner, v: number, b: boolean) { r.levels[0].setVertexNonManifold(v, b) }
    setBaseEdgeSharpness(r: TopologyRefiner, e: number, s: number) { r.levels[0].setEdgeSharpness(e, s) }
    setBaseVertexSharpness(r: TopologyRefiner, v: number, s: number) { r.levels[0].setVertexSharpness(v, s) }
    setBaseFaceHole(r: TopologyRefiner, f: number, b: boolean) {
        r.levels[0].setFaceHole(f, b)
        r.hasHoles = r.hasHoles || b
    }
    createBaseFVarChannel(r: TopologyRefiner, numValues: number, fvarOptions?: Options): number {
        let options = r.subdivOptions
        if (fvarOptions) {
            options = r.subdivOptions.clone()
            options.fvarLinearInterpolation = fvarOptions.fvarLinearInterpolation
        }
        return r.levels[0].createFVarChannel(numValues, options, level => new FVarLevel(level))
    }
    getBaseFaceFVarValues(r: TopologyRefiner, f: number, channel = 0) { return r.levels[0].getFaceFVarValues(f, channel) }
    // endregion

    /** `prepareComponentTopologySizing` (`topologyRefinerFactory.cpp:30`). */
    prepareComponentTopologySizing(refiner: TopologyRefiner): boolean {
        const base = refiner.levels[0]
        const vCount = base.getNumVertices()
        const fCount = base.getNumFaces()
        if (vCount === 0) throw new Error('Failure in TopologyRefinerFactory<>::Create() -- mesh contains no vertices.')
        if (fCount === 0) throw new Error('Failure in TopologyRefinerFactory<>::Create() -- meshes without faces not yet supported.')
        if (base.getMaxValence() > VALENCE_LIMIT) throw new Error(`Failure in TopologyRefinerFactory<>::Create() -- face with ${base.getMaxValence()} vertices > ${VALENCE_LIMIT} max.`)
        const fVertCount = base.getNumFaceVertices(fCount - 1) + base.getOffsetOfFaceVertices(fCount - 1)
        if (fVertCount === 0) throw new Error('Failure in TopologyRefinerFactory<>::Create() -- mesh contains no face-vertices.')
        if (refiner.getSchemeType() === SchemeType.LOOP && fVertCount !== 3 * fCount) throw new Error('Failure in TopologyRefinerFactory<>::Create() -- non-triangular faces not supported by Loop scheme.')
        base.resizeFaceVertices(fVertCount)
        const eCount = base.getNumEdges()
        if (eCount > 0) {
            base.resizeFaceEdges(base.getNumFaceVerticesTotal())
            base.resizeEdgeVertices()
            base.resizeEdgeFaces(base.getNumEdgeFaces(eCount - 1) + base.getOffsetOfEdgeFaces(eCount - 1))
            base.resizeVertexFaces(base.getNumVertexFaces(vCount - 1) + base.getOffsetOfVertexFaces(vCount - 1))
            base.resizeVertexEdges(base.getNumVertexEdges(vCount - 1) + base.getOffsetOfVertexEdges(vCount - 1))
        }
        return true
    }

    /** `prepareComponentTopologyAssignment` (`topologyRefinerFactory.cpp:100`). */
    prepareComponentTopologyAssignment(refiner: TopologyRefiner, fullValidation: boolean): boolean {
        const base = refiner.levels[0]
        const completeMissingTopology = base.getNumEdges() === 0
        if (completeMissingTopology) {
            if (!base.completeTopologyFromFaceVertices()) throw new Error(`Failure in TopologyRefinerFactory<>::Create() -- vertex with valence ${base.getMaxValence()} > ${VALENCE_LIMIT} max.`)
        } else if (base.getMaxValence() === 0) {
            throw new Error('Failure in TopologyRefinerFactory<>::Create() -- maximum valence not assigned.')
        }
        if (fullValidation) throw new Error('OpenSubdiv: Vtr::Level::validateTopology is not ported (Blender sets validateFullTopology = false)')
        refiner.initializeInventory()
        return true
    }

    /** `prepareComponentTagsAndSharpness` (`topologyRefinerFactory.cpp:155`). */
    prepareComponentTagsAndSharpness(refiner: TopologyRefiner): boolean {
        const base = refiner.levels[0]
        const options = refiner.getSchemeOptions()
        const creasing = new Crease(options)
        const makeBoundaryFacesHoles = options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.NONE &&
            SchemeTypeTraits.getLocalNeighborhoodSize(refiner.getSchemeType()) > 0
        const sharpenCornerVerts = options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.EDGE_AND_CORNER
        const sharpenNonManFeatures = true
        if (makeBoundaryFacesHoles) {
            for (let v = 0; v < base.getNumVertices(); ++v) {
                const vEdges = base.getVertexEdges(v)
                const vFaces = base.getVertexFaces(v)
                if (vEdges.size === vFaces.size && !(base.getVertexTag(v) & VT_NON_MANIFOLD)) continue
                let excludeFaces = false
                for (let i = 0; !excludeFaces && i < vEdges.size; ++i) {
                    excludeFaces = base.getNumEdgeFaces(vEdges.get(i)) === 1 && !isInfinite(base.getEdgeSharpness(vEdges.get(i)))
                }
                if (excludeFaces) {
                    for (let i = 0; i < vFaces.size; ++i) base.faceTags[vFaces.get(i)] |= FT_HOLE
                    refiner.hasHoles = true
                }
            }
        }
        for (let e = 0; e < base.getNumEdges(); ++e) {
            let eTag = base.edgeTags[e]
            const boundary = base.getNumEdgeFaces(e) < 2
            eTag = boundary ? eTag | ET_BOUNDARY : eTag & ~ET_BOUNDARY
            if (boundary || ((eTag & ET_NON_MANIFOLD) && sharpenNonManFeatures)) base.edgeSharpness[e] = SHARPNESS_INFINITE
            const s = base.edgeSharpness[e]
            const infSharp = isInfinite(s)
            eTag = infSharp ? eTag | ET_INF_SHARP : eTag & ~ET_INF_SHARP
            eTag = isSharp(s) && !infSharp ? eTag | ET_SEMI_SHARP : eTag & ~ET_SEMI_SHARP
            base.edgeTags[e] = eTag
        }
        const schemeRegularInteriorValence = SchemeTypeTraits.getRegularVertexValence(refiner.getSchemeType())
        const schemeRegularBoundaryValence = schemeRegularInteriorValence / 2
        for (let v = 0; v < base.getNumVertices(); ++v) {
            let vTag = base.vertTags[v]
            const vEdges = base.getVertexEdges(v)
            const vFaces = base.getVertexFaces(v)
            let boundaryEdgeCount = 0, infSharpEdgeCount = 0, semiSharpEdgeCount = 0, nonManifoldEdgeCount = 0
            for (let i = 0; i < vEdges.size; ++i) {
                const eTag = base.edgeTags[vEdges.get(i)]
                boundaryEdgeCount += eTag & ET_BOUNDARY ? 1 : 0
                infSharpEdgeCount += eTag & ET_INF_SHARP ? 1 : 0
                semiSharpEdgeCount += eTag & ET_SEMI_SHARP ? 1 : 0
                nonManifoldEdgeCount += eTag & ET_NON_MANIFOLD ? 1 : 0
            }
            const sharpEdgeCount = infSharpEdgeCount + semiSharpEdgeCount
            const isTopologicalCorner = vFaces.size === 1 && vEdges.size === 2
            const isSharpenedCorner = isTopologicalCorner && sharpenCornerVerts
            if (isSharpenedCorner) {
                base.vertSharpness[v] = SHARPNESS_INFINITE
            } else if ((vTag & VT_NON_MANIFOLD) && sharpenNonManFeatures && !isInfinite(base.vertSharpness[v])) {
                const isNonManCrease = nonManifoldEdgeCount === 2 && boundaryEdgeCount === 0 && vFaces.size > vEdges.size && base.testVertexNonManifoldCrease(v)
                if (!isNonManCrease) base.vertSharpness[v] = SHARPNESS_INFINITE
            }
            const vSharpness = base.vertSharpness[v]
            const set = (bit: number, on: boolean) => { vTag = on ? vTag | bit : vTag & ~bit }
            set(VT_INF_SHARP, isInfinite(vSharpness))
            set(VT_SEMI_SHARP, isSemiSharp(vSharpness))
            set(VT_SEMI_SHARP_EDGES, semiSharpEdgeCount > 0)
            vTag = vtWithRule(vTag, creasing.determineVertexVertexRuleFromCount(vSharpness, sharpEdgeCount))
            set(VT_BOUNDARY, boundaryEdgeCount > 0)
            set(VT_CORNER, isTopologicalCorner && (vTag & VT_INF_SHARP) !== 0)
            if (vTag & VT_NON_MANIFOLD) set(VT_XORDINARY, false)
            else if (vTag & VT_CORNER) set(VT_XORDINARY, false)
            else if (vTag & VT_BOUNDARY) set(VT_XORDINARY, vFaces.size !== schemeRegularBoundaryValence)
            else set(VT_XORDINARY, vFaces.size !== schemeRegularInteriorValence)
            set(VT_INCOMPLETE, false)
            set(VT_INF_SHARP_EDGES, infSharpEdgeCount > 0)
            set(VT_INF_SHARP_CREASE, false)
            set(VT_INF_IRREGULAR, (vTag & VT_INF_SHARP) !== 0 || (vTag & VT_INF_SHARP_EDGES) !== 0)
            if (vTag & VT_INF_SHARP_EDGES) {
                const infRule = creasing.determineVertexVertexRuleFromCount(vTag & VT_INF_SHARP ? vSharpness : 0, infSharpEdgeCount)
                if (infRule === Rule.CREASE) {
                    set(VT_INF_SHARP_CREASE, true)
                    if (!(vTag & VT_XORDINARY) && !(vTag & VT_NON_MANIFOLD)) {
                        if (vTag & VT_BOUNDARY) {
                            set(VT_INF_IRREGULAR, false)
                        } else if (schemeRegularInteriorValence === 4) {
                            set(VT_INF_IRREGULAR, (base.edgeTags[vEdges.get(0)] & ET_INF_SHARP) !== (base.edgeTags[vEdges.get(2)] & ET_INF_SHARP))
                        } else if (schemeRegularInteriorValence === 6) {
                            set(VT_INF_IRREGULAR, (base.edgeTags[vEdges.get(0)] & ET_INF_SHARP) !== (base.edgeTags[vEdges.get(3)] & ET_INF_SHARP) ||
                                (base.edgeTags[vEdges.get(1)] & ET_INF_SHARP) !== (base.edgeTags[vEdges.get(4)] & ET_INF_SHARP))
                        }
                    }
                } else if (infRule === Rule.CORNER) {
                    if (infSharpEdgeCount === vEdges.size && (vEdges.size > 2 || (vTag & VT_INF_SHARP))) set(VT_INF_IRREGULAR, false)
                }
            }
            if (refiner.hasIrregFaces) {
                for (let i = 0; i < vFaces.size; ++i) {
                    if (base.getFaceVertices(vFaces.get(i)).size !== refiner.regFaceSize) {
                        set(VT_INCID_IRREG_FACE, true)
                        break
                    }
                }
            }
            base.vertTags[v] = vTag
        }
        return true
    }

    /** `prepareFaceVaryingChannels` (`topologyRefinerFactory.cpp:405`). */
    prepareFaceVaryingChannels(refiner: TopologyRefiner): boolean {
        const base = refiner.levels[0]
        const regBoundaryValence = SchemeTypeTraits.getRegularVertexValence(refiner.getSchemeType()) / 2
        for (let channel = 0; channel < refiner.getNumFVarChannels(); ++channel) {
            if (base.getNumFVarValues(channel) === 0) throw new Error(`Failure in TopologyRefinerFactory<>::Create() -- face-varying channel ${channel} has no values.`)
            base.completeFVarChannelTopology(channel, regBoundaryValence)
        }
        return true
    }
}
// endregion
