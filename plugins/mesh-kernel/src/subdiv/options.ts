/** Subdivision Surface modifier settings (`DNA_modifier_types.h`: `eSubsurfBoundarySmooth`, `eSubsurfUVSmooth`). */

export type SubdivBoundarySmooth = 'ALL' | 'PRESERVE_CORNERS'
export type SubdivUVSmooth = 'NONE' | 'PRESERVE_CORNERS' | 'PRESERVE_CORNERS_AND_JUNCTIONS'
    | 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE' | 'PRESERVE_BOUNDARIES' | 'SMOOTH_ALL'
