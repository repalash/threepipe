import {createLight} from './light'
import {createMesh, setCreateTransform} from './mesh'
import {Object3D} from 'threepipe'

const blenderObjectTypes = {
    mesh: 1,
    lamp: 10,
}

export async function createObjects(file: any) {
    const objects: (Object3D|null)[] = []
    const childMap = new Map<any, Object3D[]>()
    const objMap = new Map<any, Object3D>()
    const blendObjects = file.objects.Object ?? []
    // console.log(bakeGetters(file))
    for (const object of blendObjects) {
        let obj: Object3D | undefined = undefined
        switch (object.type) {
        case blenderObjectTypes.mesh:
            obj = createMesh(object)
            break
        case blenderObjectTypes.lamp:
            obj = createLight(object)
            break
        default:
            console.warn('Unsupported object type', object.type, object, obj)
        }
        if (!obj)
            obj = new Object3D()
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
        }
    }
    if (childMap.size) {
        const vals = [...childMap.values()].flat()
        console.warn('unknown objects with parents, adding to root', vals, childMap)
        objects.push(...vals)
    }
    return objects.filter(o => !!o) as Object3D[]
}
