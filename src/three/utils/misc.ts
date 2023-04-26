import {BufferGeometry, MathUtils} from 'three'
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Convert geometry to BufferGeometry with indexed attributes.
 */
export function toIndexedGeometry(geometry: BufferGeometry, tolerance = -1) {
    return mergeVertices(geometry, tolerance)
}

export function generateUUID() {
    return MathUtils.generateUUID()
}
