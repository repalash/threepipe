/**
 * Feature selection for adaptive refinement: OpenSubdiv `Far::internal::FeatureMask` and the face tests of
 * `far/topologyRefiner.cpp:259-737` (OpenSubdiv 3.7.0). A face is refined further while it carries a feature that
 * a regular B-spline patch cannot represent (extraordinary vertices, semi-sharp creases, irregular inf-sharp
 * features, non-manifold vertices, and face-varying boundaries when asked to).
 *
 * Tags are the level's vertex tags with the rule above them ({@link Level.getVertexTag}), so a face's composite tag
 * is a plain OR like `VTag::BitwiseOr`.
 */

import {Level, tagRule, VTag} from './level'
import {Rule} from './sdc'
import type {AdaptiveOptions} from './refiner'

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

/** `FeatureMask::InitializeFeatures` (`topologyRefiner.cpp:310`), `useSingleCreasePatch` off as in Blender. */
export function initializeFeatures(options: AdaptiveOptions): FeatureMask {
    const useSingleCreasePatch = false
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

const has = (tag: number, bit: number) => (tag & bit) !== 0

/** `doesInfSharpVTagHaveFeatures` (`topologyRefiner.cpp:505`). */
function doesInfSharpVTagHaveFeatures(tag: number, mask: FeatureMask): boolean {
    const rule = tagRule(tag)
    if (has(tag, VTag.InfIrregular)) {
        if (rule & Rule.Corner) return mask.selectInfSharpIrregularCorner
        if (rule & Rule.Crease) return has(tag, VTag.Boundary) ? mask.selectXOrdinaryBoundary : mask.selectInfSharpIrregularCrease
        if (rule & Rule.Dart) return mask.selectInfSharpIrregularDart
    } else if (has(tag, VTag.Boundary)) {
        // regular boundary features are never selected, except a boundary crease sharpened (a Corner) by an interior edge
        if (rule & Rule.Corner) return has(tag, VTag.Corner) ? false : mask.selectInfSharpRegularCorner
        return false
    } else {
        if (rule & Rule.Corner) return mask.selectInfSharpRegularCorner
        return mask.selectInfSharpRegularCrease
    }
    return false
}

/** `doesInfSharpFaceHaveFeatures` (`topologyRefiner.cpp:539`). */
function doesInfSharpFaceHaveFeatures(compTag: number, vTags: number[], numVerts: number, mask: FeatureMask): boolean {
    const isolateQuadBoundaries = false
    const atLeastOneSmoothCorner = (tagRule(compTag) & Rule.Smooth) !== 0
    if (numVerts === 4) {
        if (atLeastOneSmoothCorner) return doesInfSharpVTagHaveFeatures(compTag, mask)
        else if (isolateQuadBoundaries) return true
        else if (mask.selectUnisolatedInteriorEdge) {
            for (let i = 0; i < 4; i++) if (has(vTags[i], VTag.InfSharpEdges) && !has(vTags[i], VTag.Boundary)) return true
        }
    } else if (atLeastOneSmoothCorner && !has(compTag, VTag.Boundary)) {
        return doesInfSharpVTagHaveFeatures(compTag, mask)
    }
    for (let i = 0; i < numVerts; i++) {
        if (!(tagRule(vTags[i]) & Rule.Smooth)) {
            if (doesInfSharpVTagHaveFeatures(vTags[i], mask)) return true
        }
    }
    return false
}

const vTagsScratch: number[] = []

/** `doesFaceHaveFeatures` (`topologyRefiner.cpp:599`). */
export function doesFaceHaveFeatures(level: Level, face: number, mask: FeatureMask, regFaceSize: number): boolean {
    const fVerts = level.getFaceVertices(face)
    if (fVerts.length !== regFaceSize) return true // irregular faces (base level) are always included
    const vTags = level.getFaceVTags(face, vTagsScratch)
    let comp = 0
    for (const t of vTags) comp |= t
    if (has(comp, VTag.IncidIrregFace)) return true
    if (has(comp, VTag.Incomplete)) return false
    if (has(comp, VTag.NonManifold) && mask.selectNonManifold) return true
    if (has(comp, VTag.Xordinary) && mask.selectXOrdinaryInterior) {
        if (tagRule(comp) === Rule.Smooth) return true
        if (level.depth < 2) {
            for (let i = 0; i < fVerts.length; i++) {
                if (has(vTags[i], VTag.Xordinary) && tagRule(vTags[i]) === Rule.Smooth) return true
            }
        }
    }
    if (tagRule(comp) === Rule.Smooth) return false
    if (has(comp, VTag.SemiSharp) || has(comp, VTag.SemiSharpEdges)) {
        // both semi-sharp selections are on without single-crease patches: select (isSingleCreasePatch is not reached)
        if (mask.selectSemiSharpSingle && mask.selectSemiSharpNonSingle) return true
        return mask.selectSemiSharpNonSingle
    }
    if (has(comp, VTag.InfSharp) || has(comp, VTag.InfSharpEdges)) {
        return doesInfSharpFaceHaveFeatures(comp, vTags, fVerts.length, mask)
    }
    return false
}

/** `doesFaceHaveDistinctFaceVaryingFeatures` (`topologyRefiner.cpp:663`). */
export function doesFaceHaveDistinctFaceVaryingFeatures(level: Level, face: number, mask: FeatureMask, fvc: number): boolean {
    const fVerts = level.getFaceVertices(face)
    const vTags: number[] = []
    for (let i = 0; i < fVerts.length; i++) vTags.push(level.getVertexCompositeFVarVTag(fVerts[i], fvc))
    let comp = 0
    for (const t of vTags) comp |= t
    if (has(comp, VTag.Incomplete)) return false
    if (has(comp, VTag.NonManifold) && mask.selectNonManifold) return true
    if (has(comp, VTag.Xordinary) && mask.selectXOrdinaryInterior) return true
    return doesInfSharpFaceHaveFeatures(comp, vTags, fVerts.length, mask)
}
