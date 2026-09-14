import {createCamera} from './camera'
import {createLight} from './light'
import {createMesh} from './mesh'
import {Euler, EulerOrder, IObject3D, Matrix4, Object3D, Quaternion, Vector3} from 'threepipe'
import {Ctx} from './ctx'

// https://github.com/blender/blender/blob/99a4c93081cc2310a09a14f20a1493e8974c10d2/source/blender/makesdna/DNA_object_types.h#L445
const blenderObjectTypes = {
    empty: 0,
    mesh: 1,
    lamp: 10,
    camera: 11,
}

export async function createObjects(file: any, ctx: Ctx) {
    const objects: (Object3D|null)[] = []
    const childMap = new Map<any, Object3D[]>()
    const objMap = new Map<any, Object3D>()
    const blendObjects = file.objects.Object ?? []
    const loaded = new WeakMap()
    // console.log(bakeGetters(file))
    for (const object of blendObjects) {
        if (loaded.has(object)) {
            console.warn('BlendLoader - duplicate object')
            continue
        }
        let obj: Object3D | undefined = undefined
        switch (object.type) {
        case blenderObjectTypes.empty:
            obj = new ctx.Object3D()
            break
        case blenderObjectTypes.mesh:
            obj = createMesh(object, loaded, ctx)
            break
        case blenderObjectTypes.lamp:
            obj = createLight(object, ctx)
            break
        case blenderObjectTypes.camera:
            obj = createCamera(object, ctx)
            break
        default:
            obj = new ctx.Object3D()
            console.warn('Unsupported object type', object.type, object, obj)
        }
        if (obj) {
            setTransform(object, obj as any)
            const exChildren = childMap.get(object)
            if (exChildren) {
                for (const exChild of exChildren) {
                    obj.add(exChild)
                }
                childMap.delete(object)
            }
            objMap.set(object, obj)
            if (object.parent === object) {
                console.error('BlendLoader - invalid, parent same as object, adding to root', object)
                objects.push(obj)
            } else if (!object.parent) { // just in case
                objects.push(obj)
            } else {
                const parent = objMap.get(object.parent)
                if (!parent) {
                    // Parent not loaded yet — stash under the PARENT key so it's picked up when the parent
                    // loads (line ~47 reads childMap.get(object)). Was keyed by the child → never re-nested.
                    const chi = childMap.get(object.parent) ?? []
                    chi.push(obj)
                    childMap.set(object.parent, chi)
                } else {
                    parent.add(obj)
                }
            }
            loaded.set(object, obj)
        }
    }
    if (childMap.size) {
        const vals = [...childMap.values()].flat()
        console.warn('BlendLoader - unknown objects with parents, adding to root', vals, childMap)
        objects.push(...vals)
    }
    return objects.filter(o => !!o) as Object3D[]
}


// https://github.com/blender/blender/blob/458e224587e8c45da20841a283cc1b41adc98950/source/blender/makesdna/DNA_action_types.h#L526
const eulerModes: Record<number, EulerOrder> = {
    [1]: 'XYZ',
    [2]: 'XZY',
    [3]: 'YXZ',
    [4]: 'YZX',
    [5]: 'ZXY',
    [6]: 'ZYX',
}

// Z-up (Blender) → Y-up (three) basis change: (x,y,z) → (x, z, -y), i.e. a -90° rotation about X. The
// geometry verts get the same C, so a Blender transform M maps to C·M·C⁻¹ in three space.
const ZUP_TO_YUP = new Matrix4().makeRotationX(-Math.PI / 2)
const YUP_TO_ZUP = new Matrix4().makeRotationX(Math.PI / 2)
// Blender cameras/lamps point down local -Z; three cameras render along -Z and our Sun/Spot lights aim via
// a target child at local -Z, so both need this extra -90° X (matches the glTF exporter's node correction).
const FORWARD_FIX = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)

// A Blender rotation (basis or delta) → Quaternion in Blender space, per rotmode. (BKE_object_rot_to_mat3:
// euler 1..6 / axis-angle -1 / quat 0; Blender quat is [w,x,y,z].)
function blenderRot(rotmode: number, quat: any, rot: any, axis: any, angle: number): Quaternion {
    const q = new Quaternion()
    if (!rotmode) {
        if (quat) q.set(quat[1], quat[2], quat[3], quat[0]).normalize()
    } else if (rotmode < 0) {
        if (axis && (axis[0] || axis[1] || axis[2])) q.setFromAxisAngle(new Vector3(axis[0], axis[1], axis[2]).normalize(), angle || 0)
    } else {
        const order = (eulerModes[rotmode] ?? 'XYZ').split('').reverse().join('') as EulerOrder
        if (rot) q.setFromEuler(new Euler(rot[0], rot[1], rot[2], order))
    }
    return q
}

// Blender object → its LOCAL (parent-relative basis) matrix, ported from BKE_object_to_mat4 +
// BKE_object_rot_to_mat3: T(loc+dloc) · (Rdelta · Rbasis) · S(size·dscale).
function blenderLocalMatrix(object: any): Matrix4 {
    const dloc = object.dloc, dscale = object.dscale, size = object.size ?? object.scale ?? [1, 1, 1]
    const pos = new Vector3(object.loc[0] + (dloc?.[0] || 0), object.loc[1] + (dloc?.[1] || 0), object.loc[2] + (dloc?.[2] || 0))
    const scl = new Vector3(size[0] * (dscale?.[0] ?? 1), size[1] * (dscale?.[1] ?? 1), size[2] * (dscale?.[2] ?? 1))
    const rBasis = blenderRot(object.rotmode || 0, object.quat, object.rot, object.rotAxis, object.rotAngle)
    const rDelta = blenderRot(object.rotmode || 0, object.dquat, object.drot, object.drotAxis, object.drotAngle)
    return new Matrix4().compose(pos, rDelta.multiply(rBasis), scl) // delta pre-multiplies (dmat·rmat)
}

// Blender column-major float[4][4] (as [col][row]) → three Matrix4 (three .elements is also column-major).
function mat4FromBlender(m: any): Matrix4 | null {
    if (!m || !m[0]) return null
    const e: number[] = []
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) e.push(m[c][r])
    return new Matrix4().fromArray(e)
}

function setTransform(object: any, obj: IObject3D) {
    obj.name = object.aname
    // Faithful port of Blender's solve_parenting: world = parent · parentinv · localTRS. The three parent
    // already carries C·parent·C⁻¹, so the three LOCAL matrix is C · (parentinv · localTRS) · C⁻¹. This
    // folds in parentinv + delta transforms that the old basis-only path dropped (parented/delta objects).
    const m = blenderLocalMatrix(object)
    if (object.parent) {
        const pinv = mat4FromBlender(object.parentinv)
        if (pinv) m.premultiply(pinv) // parentinv · localTRS
    }
    m.premultiply(ZUP_TO_YUP).multiply(YUP_TO_ZUP) // C · m · C⁻¹
    m.decompose(obj.position, obj.quaternion, obj.scale)
    if (object.type === blenderObjectTypes.camera || object.type === blenderObjectTypes.lamp)
        obj.quaternion.multiply(FORWARD_FIX)

    obj.updateMatrix()
    if (obj.setDirty) obj.setDirty()
}
