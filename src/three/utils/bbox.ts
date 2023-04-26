import {Box2, BufferAttribute, Camera, InterleavedBufferAttribute, Mesh, Object3D, Vector2, Vector3} from 'three'

export function computeScreenSpaceBoundingBox(obj: Object3D, camera: Camera) {
    let min: Vector2|undefined
    let max: Vector2|undefined

    // Is this an array of objects?
    if (Array.isArray(obj)) {
        for (const oo of obj) {
            const box2 = computeScreenSpaceBoundingBox(oo, camera)
            if (min === undefined || max === undefined) {
                min = box2.min.clone()
                max = box2.max.clone()
            } else {
                min.min(box2.min)
                max.max(box2.max)
            }
        }
    }

    // Does this object have geometry?
    const mesh = obj as Mesh
    if (mesh.geometry !== undefined) {
        const vertices = (mesh.geometry as any).vertices // legacy Geometry support
        if (vertices === undefined
            && mesh.geometry.attributes !== undefined
            && 'position' in mesh.geometry.attributes) {
            // Buffered geometry
            const vertex = new Vector3()
            const pos = mesh.geometry.attributes.position as any as BufferAttribute | InterleavedBufferAttribute
            for (let i = 0; i < pos.count * pos.itemSize; i += pos.itemSize) {
                vertex.set(pos.array[i], pos.array[i + 1], pos.array[1 + 2])
                const vertexWorldCoord = vertex.applyMatrix4(obj.matrixWorld)
                const vertexScreenSpace = vertexWorldCoord.project(camera)
                const vertexScreenSpaced = new Vector2(vertexScreenSpace.x, vertexScreenSpace.y)
                if (min === undefined || max === undefined) {
                    min = vertexScreenSpaced.clone()
                    max = vertexScreenSpaced.clone()
                } else {
                    min.min(vertexScreenSpaced)
                    max.max(vertexScreenSpaced)
                }
            }
        } else {
            // legacy Geometry support
            for (const vertex of vertices) {
                const vertexWorldCoord = vertex.clone().applyMatrix4(obj.matrixWorld)
                const vertexScreenSpace = vertexWorldCoord.project(camera)
                const vertexScreenSpaced = new Vector2(vertexScreenSpace.x, vertexScreenSpace.y)
                if (min === undefined || max === undefined) {
                    min = vertexScreenSpaced.clone()
                    max = vertexScreenSpaced.clone()
                } else {
                    min.min(vertexScreenSpaced)
                    max.max(vertexScreenSpaced)
                }
            }
        }
    }

    // Does this object have children?
    if (obj.children !== undefined) {
        for (const oo of obj.children) {
            const box2 = computeScreenSpaceBoundingBox(oo, camera)
            if (min === undefined || max === undefined) {
                min = box2.min.clone()
                max = box2.max.clone()
            } else {
                min.min(box2.min)
                max.max(box2.max)
            }
        }
    }

    return new Box2(min, max)
}
