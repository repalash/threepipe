/**
 * The knife and its building blocks - see `knife.ts`. The BLI maths in `geom.ts` stays internal.
 */
export {KnifeTool, knifeProject, KMAXDIST, KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT} from './knife'
export type {
    KnifeVert, KnifeEdge, KnifeLineHit, KnifePosData, KnifeMeasureData, KnifeMode, KnifeModalItem, KnifeEvent,
    KnifeStatus, KnifeToolOptions, KnifeDrawData,
} from './knife'
export {KnifeAngleSnap, KnifeAxis, KnifeAxisMode, KnifeMeasurement} from './knife'
export {KnifeView} from './view'
export type {KnifeViewParams} from './view'
export {faceSplitEdgenet, faceSplitEdgenetConnectIslands, vertSpliceCheckDoubleFace} from './edgenet'
