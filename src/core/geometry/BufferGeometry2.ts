import {BufferGeometry, NormalBufferAttributes, NormalOrGLBufferAttributes} from 'three'
import type {IGeometry, IGeometryEvent, IGeometryEventTypes} from '../IGeometry'
import {iGeometryCommons} from './iGeometryCommons'
import type {IObject3D} from '../IObject'

export class BufferGeometry2<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes> extends BufferGeometry<Attributes, IGeometryEvent, IGeometryEventTypes> implements IGeometry<Attributes> {
    assetType: 'geometry' // dont set the value here since its checked in upgradeGeometry
    center2 = iGeometryCommons.center2
    setDirty = iGeometryCommons.setDirty
    refreshUi = iGeometryCommons.refreshUi
    appliedMeshes = new Set<IObject3D>()

    constructor() {
        super()
        iGeometryCommons.upgradeGeometry.call(this)
    }

}
