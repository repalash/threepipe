import type {Object3D} from 'threepipe'
import {Ctx} from './ctx'

// Blender Camera.type — DNA_camera_types.h.
const CAM_PERSP = 0, CAM_ORTHO = 1 // CAM_PANO = 2 → unsupported, falls back to perspective.
// Camera.sensor_fit — DNA_camera_types.h (eCamera_SensorFit).
const SENSOR_FIT_AUTO = 0, SENSOR_FIT_HOR = 1, SENSOR_FIT_VERT = 2

/**
 * Convert a Blender Camera datablock to a three.js camera, following Blender's camera math
 * (`BKE_camera_sensor_size`/`_fit`, `camera.cc`) and the glTF exporter (`cameras.py`).
 *
 * The framing follows `BKE_camera_params_compute_viewplane`: the sensor (and an orthographic camera's
 * `ortho_scale`) spans the render's width or height by the camera's sensor fit, where Auto means the larger
 * one. `renderAspect` is the scene's render width / height; without it the sensor's own aspect is used.
 */
export function createCamera(object: any, ctx: Ctx, renderAspect?: number): Object3D | undefined {
    const cdata = object.data
    if (!cdata) return undefined

    // Near/far: current DNA is clip_start/clip_end; older files used clipsta/clipend. (Was previously read
    // only as clipsta/clipend → always undefined on modern files → silently fell back to 0.1/1000.)
    const near = cdata.clip_start ?? cdata.clipsta ?? 0.1
    const far = cdata.clip_end ?? cdata.clipend ?? 1000

    const sx = cdata.sensor_x || 36, sy = cdata.sensor_y || 24
    const lens = cdata.lens || 50
    const aspect = renderAspect && Number.isFinite(renderAspect) && renderAspect > 0 ? renderAspect : sx / sy
    const sensorFit = typeof cdata.sensor_fit === 'number' ? cdata.sensor_fit : SENSOR_FIT_AUTO
    // Auto: sensor_x spans the larger render axis. Horizontal: sensor_x spans the width. Vertical: sensor_y the height.
    const horizontal = sensorFit === SENSOR_FIT_HOR || sensorFit === SENSOR_FIT_AUTO && aspect >= 1
    const sensor = sensorFit === SENSOR_FIT_VERT ? sy : sx

    let camera: Object3D
    if (cdata.type === CAM_ORTHO) {
        // ortho_scale spans the same axis as the sensor (camera.cc; cameras.py:79-83), default 6.
        const scale = cdata.ortho_scale || 6
        const w = horizontal ? scale : scale * aspect
        const h = horizontal ? scale / aspect : scale
        camera = new ctx.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, near, far)
    } else {
        if (cdata.type !== CAM_PERSP) console.warn('BlendLoader - panoramic camera unsupported, using perspective')
        // three.js PerspectiveCamera.fov is the vertical fov (degrees); Blender's sensor spans the fit axis.
        const half = Math.atan(sensor / (2 * lens))
        const vfov = horizontal ? 2 * Math.atan(Math.tan(half) / aspect) : 2 * half
        camera = new ctx.PerspectiveCamera(vfov * (180 / Math.PI), aspect, near, far)
    }

    // Lens shift (film offset). three.js can apply this via camera.setViewOffset/projection; stash for now.
    if (typeof cdata.shiftx === 'number') camera.userData.shiftX = cdata.shiftx
    if (typeof cdata.shifty === 'number') camera.userData.shiftY = cdata.shifty
    return camera
}
