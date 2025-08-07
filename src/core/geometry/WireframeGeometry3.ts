import {
    BufferGeometry,
    NormalBufferAttributes,
    NormalOrGLBufferAttributes,
} from 'three'
import type {IGeometry, IGeometryEventMap, IGeometryUserData} from '../IGeometry'
import {WireframeGeometry2} from 'three/examples/jsm/lines/WireframeGeometry2.js'
import {iGeometryCommons} from './iGeometryCommons'
import type {IObject3D} from '../IObject'

export class WireframeGeometry3<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes, TE extends IGeometryEventMap = IGeometryEventMap> extends WireframeGeometry2<Attributes, TE> implements IGeometry<Attributes, TE> {
    assetType: 'geometry' // dont set the value here since its checked in upgradeGeometry
    center2 = iGeometryCommons.center2
    setDirty = iGeometryCommons.setDirty
    refreshUi = iGeometryCommons.refreshUi
    appliedMeshes = new Set<IObject3D>()
    declare userData: IGeometryUserData

    constructor(geometry: BufferGeometry) {
        super(geometry)
        iGeometryCommons.upgradeGeometry.call(this)
    }
}
