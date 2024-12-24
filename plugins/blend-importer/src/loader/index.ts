import {createLight} from './light'
import {createMesh} from './mesh'
import {Object3D} from 'threepipe'

const blenderObjectTypes = {
    mesh: 1,
    lamp: 10,
}

export async function createObjects(file: any) {
    const objects: (Object3D|null)[] = []
    const blendObjects = file.objects.Object
    for (const object of blendObjects) {
        switch (object.type) {
        case blenderObjectTypes.mesh:
            objects.push(createMesh(object))
            break
        case blenderObjectTypes.lamp:
            objects.push(createLight(object))
            break
        default:
            console.warn('Unsupported object type', object.type)
        }
    }
    return objects.filter(o => !!o) as Object3D[]
}
