import {Box2, Box3, BufferGeometry, Camera, Mesh, Object3D, Vector3} from 'three'
import type {IObject3D} from '../../core'

export class Box3B extends Box3 {
    private static _box = new Box3B()
    private _vector = new Vector3()

    expandByObject(object: Object3D|IObject3D, precise = false, ignoreInvisible = false, ignoreObject?: (obj: Object3D)=>boolean): this {
        if (object.userData?.bboxVisible === false) return this
        if (!object.visible && ignoreInvisible) return this
        if (ignoreObject && ignoreObject(object)) return this

        // copied the whole function from three.js to pass in ignoreInvisible. add else block to support custom computeBoundingBox without BufferGeometry

        // Computes the world-axis-aligned bounding box of an object (including its children),
        // accounting for both the object's, and children's, world transforms

        object.updateWorldMatrix(false, false)

        const geometry = (object as IObject3D).geometry

        if (geometry !== undefined) {

            const positionAttribute = geometry.getAttribute('position')

            // precise AABB computation based on vertex data requires at least a position attribute.
            // instancing isn't supported so far and uses the normal (conservative) code path.

            if (precise === true && positionAttribute !== undefined && Object.getPrototypeOf(geometry).computeBoundingBox === BufferGeometry.prototype.computeBoundingBox) {

                for (let i = 0, l = positionAttribute.count; i < l; i++) {

                    if ((object as Mesh).isMesh === true) {

                        (object as Mesh).getVertexPosition(i, this._vector)

                    } else {

                        this._vector.fromBufferAttribute(positionAttribute, i)

                    }

                    this._vector.applyMatrix4(object.matrixWorld)
                    this.expandByPoint(this._vector)

                }

            } else {

                if ((object as IObject3D).boundingBox !== undefined) {

                    // object-level bounding box

                    if ((precise || (object as IObject3D).boundingBox === null) && typeof (object as IObject3D).computeBoundingBox === 'function') {

                        // @ts-expect-error why?
                        (object as IObject3D).computeBoundingBox()

                    }

                    // _box.copy(object.boundingBox)
                    if ((object as IObject3D).boundingBox !== null) {

                        Box3B._box.copy((object as IObject3D).boundingBox!)
                        Box3B._box.applyMatrix4(object.matrixWorld)

                        this.union(Box3B._box)

                    } else {
                        console.warn('Box3B - Unable to compute bounds for', object)
                    }


                } else {

                    // geometry-level bounding box

                    if (geometry.boundingBox === null) {

                        geometry.computeBoundingBox()

                    }

                    if (geometry.boundingBox) {
                        Box3B._box.copy(geometry.boundingBox)
                        Box3B._box.applyMatrix4(object.matrixWorld)

                        this.union(Box3B._box)
                    } else {
                        console.warn('Box3B - Unable to compute bounds for', object, geometry)
                    }

                }

            }

        } else if ((object as IObject3D).boundingBox !== undefined) {

            // object-level bounding box

            if ((precise || (object as IObject3D).boundingBox === null) && typeof (object as IObject3D).computeBoundingBox === 'function') {

                // @ts-expect-error why?
                (object as IObject3D).computeBoundingBox()

            }

            // _box.copy(object.boundingBox)
            if ((object as IObject3D).boundingBox !== null) {

                Box3B._box.copy((object as IObject3D).boundingBox!)
                Box3B._box.applyMatrix4(object.matrixWorld)

                this.union(Box3B._box)

            } else {
                console.warn('Box3B - Unable to compute bounds for', object)
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
