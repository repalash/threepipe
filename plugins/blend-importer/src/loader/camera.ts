import {Object3D} from 'threepipe'

export function createCamera(object: any, ctx: any): Object3D | undefined {
    const cdata = object.data
    // console.log(bakeGetters(object))
    if (!cdata) return undefined

    // Blender camera types: 0 = Perspective, 1 = Orthographic
    const type = cdata.type
    let camera: Object3D
    if (type === 0) {
        // Perspective
        camera = new ctx.PerspectiveCamera(
            cdata.lens || 50, // fov or lens
            (cdata.sensor_x || 36) / (cdata.sensor_y || 24), // aspect
            cdata.clipsta || 0.1, // near
            cdata.clipend || 1000 // far
        )
        // Set additional properties if needed
        camera.position.set(0, 0, 0)
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
        camera.position.set(0, 0, 0)
        if ('shiftx' in cdata) camera.userData.shiftX = cdata.shiftx
        if ('shifty' in cdata) camera.userData.shiftY = cdata.shifty
    } else {
        // Unknown camera type
        camera = new ctx.PerspectiveCamera()
        console.warn('Unsupported camera type', type)
    }

    return camera
}
