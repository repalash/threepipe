import {createCamera} from './camera'
import {createLight} from './light'
import {createMesh} from './mesh'
import {Euler, EulerOrder, IObject3D, Object3D, Quaternion, Vector3} from 'threepipe'
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
                    const chi = childMap.get(object.parent) ?? []
                    chi.push(obj)
                    childMap.set(object, chi)
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

function setTransform(object: any, obj: IObject3D) {
    obj.name = object.aname
    obj.scale.set(object.size[0], object.size[2], object.size[1])
    obj.position.set(object.loc[0], object.loc[2], -object.loc[1])

    if (!object.rotmode || object.rotmode === 0) {
        // const quat = new Quaternion()
        obj.quaternion.set(object.quat[1], object.quat[3], -object.quat[2], object.quat[0]) // wxyz
    } else {
        // console.log(object.rotmode)
        // const order = eulerModes[4]
        const order = eulerModes[object.rotmode] ?? 'XYZ'
        const quat = new Quaternion().setFromEuler(new Euler(object.rot[0], object.rot[1], object.rot[2], order.split('').reverse().join('') as any))
        obj.quaternion.set(quat.x, quat.z, -quat.y, quat.w) // wxyz
    }
    // because camera is rotated 90d in blender
    if (object.type === blenderObjectTypes.camera)
        obj.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2))

    obj.updateMatrix()
    if (obj.setDirty) obj.setDirty()
}
