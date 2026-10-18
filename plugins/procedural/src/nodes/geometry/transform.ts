/**
 * Transform Geometry (`GeometryNodeTransform`) - `nodes/geometry/nodes/node_geo_transform_geometry.cc`
 * (declaration :25, `use_translate` :57, `node_geo_exec` :88), on `geometry::transform_geometry` /
 * `translate_geometry` (`src/geometry/transform.ts`).
 */

import {f32} from '../../blender/f32'
import {mat4FromLocQuatScale} from '../../blender/math/matrix'
import {transformGeometry, translateGeometry} from '../../geometry/transform'
import {registerNodeType} from '../../runtime/registry'

/** `compare_ff(a, b, max_diff)`: `fabsf(a - b) <= max_diff`. */
const compareFF = (a: number, b: number, maxDiff: number) => Math.abs(f32(a - b)) <= maxDiff

/** `use_translate` (:57): no rotation (imaginary part squared length <= 1e-10) and unit scale. */
function useTranslate(q: readonly number[], s: readonly number[]): boolean {
    const lenSq = f32(f32(f32(q[1] * q[1]) + f32(q[2] * q[2])) + f32(q[3] * q[3]))
    if (lenSq > f32(1e-10)) return false
    const eps = f32(1e-9)
    return compareFF(s[0], 1, eps) && compareFF(s[1], 1, eps) && compareFF(s[2], 1, eps)
}

registerNodeType({
    idname: 'GeometryNodeTransform',
    label: 'Transform Geometry',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        // Menu values are the item names (`mode_items` :15: Components, Matrix).
        b.input('MENU', 'Mode').default('Components')
        b.input('VECTOR', 'Translation').subtype('TRANSLATION')
        b.input('ROTATION', 'Rotation')
        b.input('VECTOR', 'Scale').default([1, 1, 1]).subtype('XYZ')
        b.input('MATRIX', 'Transform')
    },
    execute(p) {
        const mode = p.string('Mode')
        const geometry = p.geometry('Geometry')
        if (mode === 'Matrix') {
            transformGeometry(geometry, p.single('Transform'))
        } else if (mode === 'Components') {
            const translation = p.vector('Translation')
            const rotation = p.single('Rotation')
            const scale = p.vector('Scale')
            if (useTranslate(rotation, scale)) translateGeometry(geometry, translation)
            else transformGeometry(geometry, mat4FromLocQuatScale(translation, rotation, scale))
        } else {
            throw new Error(`procedural: Transform Geometry mode '${mode}' is not a menu item`)
        }
        p.set('Geometry', geometry)
    },
})
