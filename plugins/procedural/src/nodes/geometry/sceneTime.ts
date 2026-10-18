/**
 * Scene Time (`GeometryNodeInputSceneTime`) - `nodes/geometry/nodes/node_geo_input_scene_time.cc` (:18-29).
 */

import {f32} from '../../blender/f32'
import {GField} from '../../fields'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeInputSceneTime',
    label: 'Scene Time',
    declare(b) {
        b.output('FLOAT', 'Seconds')
        b.output('FLOAT', 'Frame')
    },
    execute(p) {
        const {ctime, frameRate} = p.options.time ?? {ctime: 1, frameRate: 24}
        p.dependsOn('scene-time', `${ctime}/${frameRate}`)
        const frame = f32(ctime)
        // `float(scene_ctime / frame_rate)`: the division in double, `frame_rate = double(fps) / double(fps_base)`.
        p.set('Seconds', GField.constant('float', [f32(frame / frameRate)]))
        p.set('Frame', GField.constant('float', [frame]))
    },
})
