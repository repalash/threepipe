import {
    Box2,
    Box3,
    BufferAttribute,
    BufferGeometry,
    Camera,
    InterleavedBufferAttribute,
    Mesh,
    Object3D,
    Vector3,
} from 'three'
import type {IObject3D} from '../../core'

export class Box3B extends Box3 {
    private static _box = new Box3B()
    private _vector = new Vector3()

    expandByObject(object: Object3D|IObject3D, precise = false, ignoreInvisible = false, ignoreObject?: (obj: Object3D)=>boolean): this {
        if (object.userData?.bboxVisible === false) return this
        if (!object.visible && ignoreInvisible) return this
        if (ignoreObject && ignoreObject(object)) return this

        // copied the whole function from three.js to pass in ignoreInvisible, support precise

        // Computes the world-axis-aligned bounding box of an object (including its children),
        // accounting for both the object's, and children's, world transforms

        object.updateWorldMatrix(false, false)

        // InstancedMesh has boundingBox = null, so it can be computed
        if ((object as IObject3D).boundingBox !== undefined) {

            if (/* (object as IObject3D).boundingBox === null && */typeof (object as IObject3D).computeBoundingBox === 'function') {

                (object as IObject3D).computeBoundingBox!()

            }

            if ((object as IObject3D).boundingBox !== null) {

                Box3B._box.copy((object as IObject3D).boundingBox!)
                Box3B._box.applyMatrix4(object.matrixWorld)

                this.union(Box3B._box)

            } else {
                console.warn('Box3B - Unable to compute bounds for', object)
            }

        } else {

            const geometry = (object as Mesh).geometry

            if (geometry !== undefined) {
                // checking for computeBoundingBox to support when overridden in subclass.
                if (precise && geometry.attributes != undefined && geometry.attributes.position !== undefined && Object.getPrototypeOf(geometry).computeBoundingBox === BufferGeometry.prototype.computeBoundingBox) {
                    // in case of precise, apply the matrix to positions before expanding the box
                    // todo add precise option to computeBoundingBox
                    const position = geometry.attributes.position as any as BufferAttribute | InterleavedBufferAttribute
                    for (let i = 0, l = position.count; i < l; i++) {
                        this._vector.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld)
                        this.expandByPoint(this._vector)
                    }
                } else {
                    if (geometry.boundingBox === null)
                        geometry.computeBoundingBox()
                    if (geometry.boundingBox) {
                        Box3B._box.copy(geometry.boundingBox)
                        Box3B._box.applyMatrix4(object.matrixWorld)

                        this.union(Box3B._box)
                    } else {
                        console.warn('Box3B - Unable to compute bounds for', object, geometry)
                    }

                }
            }
        }
        const children = object.children

        for (let i = 0, l = children.length; i < l; i++) {

            this.expandByObject(children[ i ], precise, ignoreInvisible)

        }

        return this
    }

    expandByObjects(objects: (Object3D|IObject3D)[], precise = false, ignoreInvisible = false): this {
        for (let i = 0, l = objects.length; i < l; i++) this.expandByObject(objects[i], precise, ignoreInvisible)
        return this
    }
    /**
     * Get corner points.
     */
    getPoints(): Vector3[] {
        return [
            new Vector3(this.min.x, this.min.y, this.min.z), // 000
            new Vector3(this.min.x, this.min.y, this.max.z), // 001
            new Vector3(this.min.x, this.max.y, this.min.z), // 010
            new Vector3(this.min.x, this.max.y, this.max.z), // 011
            new Vector3(this.max.x, this.min.y, this.min.z), // 100
            new Vector3(this.max.x, this.min.y, this.max.z), // 101
            new Vector3(this.max.x, this.max.y, this.min.z), // 110
            new Vector3(this.max.x, this.max.y, this.max.z), // 111
        ]
    }

    getScreenSpaceBounds(camera: Camera): Box2 {
        const vertices = this.getPoints()
        const box = new Box2()
        for (const vertex of vertices) {
            const vertexScreenSpace = vertex.project(camera)
            box.min.min(vertexScreenSpace as any)
            box.max.max(vertexScreenSpace as any)
        }
        return box
    }

}
