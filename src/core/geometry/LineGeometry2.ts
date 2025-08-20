import {InterleavedBufferAttribute, NormalBufferAttributes, NormalOrGLBufferAttributes} from 'three'
import type {IGeometry, IGeometryEventMap, IGeometryUserData} from '../IGeometry'
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js'
import {iGeometryCommons} from './iGeometryCommons'
import type {IObject3D} from '../IObject'

export class LineGeometry2<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes, TE extends IGeometryEventMap = IGeometryEventMap> extends LineGeometry<Attributes, TE> implements IGeometry<Attributes, TE> {
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

    getPositions() {
        return pairsToPoints(this.attributes.instanceStart as InterleavedBufferAttribute)
    }

    getColors() {
        return pairsToPoints(this.attributes.instanceColorStart as InterleavedBufferAttribute)
    }

}

/**
 * converts pairs format back to [ x1, y1, z1,  x2, y2, z2, ... ] format.
 * inverse of LineGeometry.setPositions
 *
 * @param start
 */
function pairsToPoints(start?: InterleavedBufferAttribute) {
    const segments = start?.data.array
    if (!segments) return null

    const length = segments.length / 2 + 3
    const positions = new Float32Array(length)

    positions[0] = segments[0]
    positions[1] = segments[1]
    positions[2] = segments[2]

    // every second point from pairs
    for (let i = 3; i < length; i += 3) {

        const segmentIndex = 2 * i - 3
        positions[i] = segments[segmentIndex]
        positions[i + 1] = segments[segmentIndex + 1]
        positions[i + 2] = segments[segmentIndex + 2]

    }

    return positions
}

