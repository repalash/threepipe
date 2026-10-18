import {MeshData} from '../MeshData'
import {AttrDomain} from '../constants'
import {faceNormalsTrue} from '../normals'

/**
 * `axis_dominant_v3` (`blenlib/intern/math_geom_inline.cc:45`): the two axes to project onto, dropping the
 * largest component of `axis`; ties go to z, then y.
 */
export function axisDominantV3(axis: ArrayLike<number>): [number, number] {
    const xn = Math.abs(axis[0]), yn = Math.abs(axis[1]), zn = Math.abs(axis[2])
    if (zn >= xn && zn >= yn) return [0, 1]
    if (yn >= xn && yn >= zn) return [0, 2]
    return [1, 2]
}

export interface CubeProjectOptions {
    /** World size of the cube, i.e. of one UV unit. Blender's `cube_size`; 0 means 1. */
    cubeSize?: number
    /** Projection centre. Default the origin (Blender uses the transform centre, `uv_map_transform_center`). */
    center?: ArrayLike<number>
    /** Faces to project; default every face. */
    faces?: ArrayLike<number>
    /** Corner float2 layer to write, created if missing. Default `uv`. */
    layer?: string
}

/**
 * Blender's Cube Projection, `uvedit_unwrap_cube_project` (`editors/uvedit/uvedit_unwrap_ops.cc:4245`): each face
 * is projected along the axis its normal is closest to, `uv = 0.5 + (co - center) / cube_size` on the other two
 * axes. The operator's clip/correct pass (`uv_map_clip_correct`) is a no-op with its defaults and no image, and is
 * not ported. Face normals are Newell's, in float, as BMesh's `efa->no`.
 */
export function uvCubeProject(mesh: MeshData, options: CubeProjectOptions = {}): void {
    const cubeSize = options.cubeSize ? options.cubeSize : 1
    const center = options.center ?? [0, 0, 0]
    const uv = mesh.attributes.ensure(options.layer ?? 'uv', AttrDomain.Corner, 'float2').data
    const P = mesh.positions, CV = mesh.cornerVerts, O = mesh.faceOffsets
    const fno = faceNormalsTrue(mesh)
    const faces = options.faces ?? Array.from({length: mesh.facesNum}, (_, i) => i)
    for (let k = 0; k < faces.length; k++) {
        const f = faces[k]
        const [cox, coy] = axisDominantV3([fno[3 * f], fno[3 * f + 1], fno[3 * f + 2]])
        for (let c = O[f]; c < O[f + 1]; c++) {
            const v = CV[c]
            uv[2 * c] = Math.fround(0.5 + Math.fround(Math.fround(P[3 * v + cox] - center[cox]) / cubeSize))
            uv[2 * c + 1] = Math.fround(0.5 + Math.fround(Math.fround(P[3 * v + coy] - center[coy]) / cubeSize))
        }
    }
}
