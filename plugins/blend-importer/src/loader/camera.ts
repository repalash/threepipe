import {Object3D} from 'threepipe'
import {Ctx} from './ctx'

// Blender Camera.type — DNA_camera_types.h.
const CAM_PERSP = 0, CAM_ORTHO = 1 // CAM_PANO = 2 → unsupported, falls back to perspective.
// Camera.sensor_fit — DNA_camera_types.h (eCamera_SensorFit).
const SENSOR_FIT_AUTO = 0, SENSOR_FIT_VERT = 2

/**
 * Convert a Blender Camera datablock to a three.js camera, following Blender's camera math
 * (`BKE_camera_sensor_size`/`_fit`, `camera.cc`) and the glTF exporter (`cameras.py`).
 *
 * NOTE: the precise FOV/ortho framing depends on the Scene's RENDER resolution (Blender fits the sensor
 * to the larger render axis). That isn't threaded into the loader yet, so the camera's own sensor aspect
 * is used as the aspect — exact for AUTO/VERTICAL fits and when render aspect == sensor aspect. TODO:
 * pass Scene render resolution (and designate the active camera) for HORIZONTAL-fit precision.
 */
export function createCamera(object: any, ctx: Ctx): Object3D | undefined {
    const cdata = object.data
    if (!cdata) return undefined

    // Near/far: current DNA is clip_start/clip_end; older files used clipsta/clipend. (Was previously read
    // only as clipsta/clipend → always undefined on modern files → silently fell back to 0.1/1000.)
    const near = cdata.clip_start ?? cdata.clipsta ?? 0.1
    const far = cdata.clip_end ?? cdata.clipend ?? 1000

    const sx = cdata.sensor_x || 36, sy = cdata.sensor_y || 24
    const lens = cdata.lens || 50
    const aspect = sx / sy
    let fit = typeof cdata.sensor_fit === 'number' ? cdata.sensor_fit : SENSOR_FIT_AUTO
    if (fit === SENSOR_FIT_AUTO) fit = aspect >= 1 ? 1 /* HOR */ : SENSOR_FIT_VERT

    let camera: Object3D
    if (cdata.type === CAM_ORTHO) {
        // ortho_scale maps to the LARGER of width/height (camera.cc; cameras.py:79-83) — default 6.
        const scale = cdata.ortho_scale || 6
        const w = aspect >= 1 ? scale : scale * aspect
        const h = aspect >= 1 ? scale / aspect : scale
        camera = new ctx.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, near, far)
    } else {
        if (cdata.type !== CAM_PERSP) console.warn('BlendLoader - panoramic camera unsupported, using perspective')
        // three.js PerspectiveCamera.fov is the VERTICAL fov (degrees); Blender's fov is along the fit axis.
        let vfov: number
        if (fit === SENSOR_FIT_VERT) vfov = 2 * Math.atan(sy / (2 * lens))
        else { const hfov = 2 * Math.atan(sx / (2 * lens)); vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) }
        camera = new ctx.PerspectiveCamera(vfov * (180 / Math.PI), aspect, near, far)
    }

    // Lens shift (film offset). three.js can apply this via camera.setViewOffset/projection; stash for now.
    if (typeof cdata.shiftx === 'number') camera.userData.shiftX = cdata.shiftx
    if (typeof cdata.shifty === 'number') camera.userData.shiftY = cdata.shifty
    return camera
}
