import {createCamera} from './camera'
import {createLight} from './light'
import {createMesh, setCreateTransform} from './mesh'
import {Object3D} from 'threepipe'

// https://github.com/blender/blender/blob/99a4c93081cc2310a09a14f20a1493e8974c10d2/source/blender/makesdna/DNA_object_types.h#L445
const blenderObjectTypes = {
    empty: 0,
    mesh: 1,
    lamp: 10,
    camera: 11,
}

export async function createObjects(file: any, ctx: any) {
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
            setCreateTransform(object, obj)
            const exChildren = childMap.get(object)
            if (exChildren) {
                for (const exChild of exChildren) {
                    obj.add(exChild)
                }
                childMap.delete(object)
            }
            objMap.set(object, obj)
            if (object.parent === object) {
                console.error('invalid, parent same as object, adding to root', object)
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
        console.warn('unknown objects with parents, adding to root', vals, childMap)
        objects.push(...vals)
    }
    return objects.filter(o => !!o) as Object3D[]
}
