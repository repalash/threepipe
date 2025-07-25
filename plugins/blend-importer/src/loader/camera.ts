import {Object3D} from 'threepipe'
import {Ctx} from './ctx'

export function createCamera(object: any, ctx: Ctx): Object3D | undefined {
    const cdata = object.data
    // console.log(bakeGetters(object))
    if (!cdata) return undefined

    // Blender camera types: 0 = Perspective, 1 = Orthographic
    const type = cdata.type
    let camera: Object3D
    if (type === 0) {
        // Perspective
        // Convert lens (mm) to field of view (fov) in degrees (vfov)
        const sensorWidth = cdata.sensor_x || 36
        const sensorHeight = cdata.sensor_y || 24
        const lens = cdata.lens || 50
        const fov = 2 * Math.atan(sensorHeight / (2 * lens)) * (180 / Math.PI)

        camera = new ctx.PerspectiveCamera(
            fov,
            sensorWidth / sensorHeight,
            cdata.clipsta || 0.1,
            cdata.clipend || 1000
        )
        if ('shiftx' in cdata) camera.userData.shiftX = cdata.shiftx // todo?
        if ('shiftx' in cdata) camera.userData.shiftX = cdata.shiftx // todo?
        if ('shifty' in cdata) camera.userData.shiftY = cdata.shifty
    } else if (type === 1) {
        // Orthographic
        const scale = cdata.ortho_scale || 1
        const aspect = (cdata.sensor_x || 36) / (cdata.sensor_y || 24)
        const left = -scale * aspect / 2
        const right = scale * aspect / 2
        const top = scale / 2
        const bottom = -scale / 2
        camera = new ctx.OrthographicCamera(
            left, right, top, bottom,
            cdata.clipsta || 0.1,
            cdata.clipend || 1000
        )
        if ('shiftx' in cdata) camera.userData.shiftX = cdata.shiftx
        if ('shifty' in cdata) camera.userData.shiftY = cdata.shifty
    } else {
        // Unknown camera type
        camera = new ctx.PerspectiveCamera()
        console.warn('Unsupported camera type', type)
    }

    // const obj = new Object3D()
    // camera.rotation.x = -Math.PI / 2
    // obj.add(camera)

    return camera
}
