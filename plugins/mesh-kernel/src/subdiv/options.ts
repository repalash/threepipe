/** Subdivision settings shared by the modifier API and the limit evaluator. */

import {FVarLinearInterpolation} from './sdc'

export type SubdivBoundarySmooth = 'ALL' | 'PRESERVE_CORNERS'
export type SubdivUVSmooth = 'NONE' | 'PRESERVE_CORNERS' | 'PRESERVE_CORNERS_AND_JUNCTIONS'
    | 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE' | 'PRESERVE_BOUNDARIES' | 'SMOOTH_ALL'

/** `subdiv.cc:47` `fvar_interpolation_from_uv_smooth`. */
export function fvarInterpolationFromUVSmooth(uvSmooth: SubdivUVSmooth): FVarLinearInterpolation {
    switch (uvSmooth) {
    case 'NONE': return FVarLinearInterpolation.All
    case 'PRESERVE_CORNERS': return FVarLinearInterpolation.CornersOnly
    case 'PRESERVE_CORNERS_AND_JUNCTIONS': return FVarLinearInterpolation.CornersPlus1
    case 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE': return FVarLinearInterpolation.CornersPlus2
    case 'PRESERVE_BOUNDARIES': return FVarLinearInterpolation.Boundaries
    case 'SMOOTH_ALL': return FVarLinearInterpolation.None
    }
}
