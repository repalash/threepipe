// Public surface of the OpenSubdiv port; the Sdc / Vtr / Far internals stay module-private.
export {subdivisionSurface, subdivisionSurfaceEvaluate, fvarInterpolationFromUVSmooth, createSubdivLimitEvaluator} from './subdivisionSurface'
export type {SubdivisionSurfaceOptions, SubdivisionResult, SubdivBoundarySmooth, SubdivUVSmooth, SubdivLimitEvaluator, SubdivLimitEvaluatorOptions} from './subdivisionSurface'
export {creaseToSharpness} from './refiner'
// Blender's `bke::subdiv` on the OpenSubdiv float pipeline (`bke/`, `osd/`): Blender's output order and attribute
// interpolation, used by the geometry-nodes Subdivide Mesh / Subdivision Surface nodes.
export {
    subdivNewFromMesh, facePtexOffsetGet, evalBeginFromMesh, evalLimitPoint, evalFinalPoint, evalFaceVarying, meshUvMapNames,
    fvarInterpolationFromUvSmooth, vtxBoundaryInterpolationFromSubsurf,
} from './bke/subdiv'
export type {Subdiv, SubdivSettings} from './bke/subdiv'
export {subdivToMesh} from './bke/subdivMesh'
export type {ToMeshSettings} from './bke/subdivForeach'
