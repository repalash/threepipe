import {Vector3} from 'three'
import {Box3B} from '../math/Box3B'
import {ICamera, PerspectiveCamera2} from '../../core'

/**
 * Find distance of camera at which the camera's fov fits the given bounding box dimensions
 * @param cam
 * @param box
 */
export function getFittingDistance(cam: ICamera, box: Box3B): number {
    const size = box.getSize(new Vector3())
    let cameraZ = 1
    if (cam.isPerspectiveCamera && size.length() > 0.0001) {
        const aspect = isFinite(cam.aspect) ? cam.aspect : 1
        // get the max side of the bounding box (fits to width OR height as needed )
        const fov = Math.max(1, (cam as PerspectiveCamera2).fov) * (Math.PI / 180)
        const fovh = 2 * Math.atan(Math.tan(fov / 2) * aspect)
        const dx = size.z / 2 + Math.abs(size.x / 2 / Math.tan(fovh / 2))
        const dy = size.z / 2 + Math.abs(size.y / 2 / Math.tan(fov / 2))
        cameraZ = Math.max(dx, dy)
    }
    return cameraZ
}
