import {NormalBufferAttributes, NormalOrGLBufferAttributes} from 'three'
import type {IGeometry, IGeometryEventMap, IGeometryUserData} from '../IGeometry'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry'
import {iGeometryCommons} from './iGeometryCommons'
import type {IObject3D} from '../IObject'

export class LineSegmentsGeometry2<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes, TE extends IGeometryEventMap = IGeometryEventMap> extends LineSegmentsGeometry<Attributes, TE> implements IGeometry<Attributes, TE> {
    assetType: 'geometry' // dont set the value here since its checked in upgradeGeometry
    center2 = iGeometryCommons.center2
    setDirty = iGeometryCommons.setDirty
    refreshUi = iGeometryCommons.refreshUi
    appliedMeshes = new Set<IObject3D>()
    declare userData: IGeometryUserData

    constructor() {
        super()
        iGeometryCommons.upgradeGeometry.call(this)
    }
}
