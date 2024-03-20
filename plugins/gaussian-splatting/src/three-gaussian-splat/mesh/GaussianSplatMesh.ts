import {GaussianSplatGeometry} from '../geometry/GaussianSplatGeometry'
import {Camera, IMaterial, Mesh2, PerspectiveCamera, WebGLRenderer} from 'threepipe'
import type {GaussianSplatMaterialRaw} from '../materials/GaussianSplatMaterialRaw'
import {GaussianSplatMaterialUnlit} from '../materials/GaussianSplatMaterialUnlit'
import {Matrix4, Ray, Raycaster, Sphere, Vector3} from 'three'
import {GaussianSplatMaterialExtension} from '../materials/GaussianSplatMaterialExtension'

export class GaussianSplatMesh extends Mesh2<GaussianSplatGeometry, IMaterial> {
    readonly isGaussianSplatMesh = true

    constructor(geometry: GaussianSplatGeometry, material: IMaterial) {
        super(geometry, material)
        this.frustumCulled = false
    }

    public async update(camera: PerspectiveCamera | Camera, renderer: WebGLRenderer) {
        if ((this.material as any as GaussianSplatMaterialRaw)?.isGaussianSplatMaterialRaw) {
            (this.material as any as GaussianSplatMaterialRaw).update(camera, renderer)
        } else if (this.material) {
            const ext =
                (this.material as GaussianSplatMaterialUnlit).gsplatExtension ??
                this.material.materialExtensions.find(e=>
                    (e as GaussianSplatMaterialExtension).isGaussianSplatMaterialExtension) as GaussianSplatMaterialExtension
            ext && ext.update(camera, renderer)
        }
        this.updateMatrixWorld(true)
        return this.geometry.update(camera, this.matrixWorld)
    }

    raycast(raycaster: Raycaster, intersects: any[]) {

        const geometry = this.geometry
        const matrixWorld = this.matrixWorld
        // const threshold = raycaster.params.Points?.threshold ?? .01
        const threshold = .02

        // Checking boundingSphere distance to ray

        if (geometry.boundingSphere === null) geometry.computeBoundingSphere()

        const sphere = new Sphere()
        sphere.copy(geometry.boundingSphere!)
        sphere.applyMatrix4(matrixWorld)
        sphere.radius += threshold

        if (!raycaster.ray.intersectsSphere(sphere)) return

        //

        const inverseMatrix = new Matrix4()
        const ray = new Ray()

        inverseMatrix.copy(matrixWorld).invert()
        ray.copy(raycaster.ray).applyMatrix4(inverseMatrix)

        const localThreshold = threshold / ((this.scale.x + this.scale.y + this.scale.z) / 3)
        const localThresholdSq = localThreshold * localThreshold

        const attributes = geometry.attributes
        const positionAttribute = attributes.center

        const position = new Vector3()
        for (let i = 0, l = positionAttribute.count; i < l; i++) {

            position.fromBufferAttribute(positionAttribute, i)

            const rayPointDistanceSq = ray.distanceSqToPoint(position)

            if (rayPointDistanceSq < localThresholdSq) {

                const intersectPoint = new Vector3()

                ray.closestPointToPoint(position, intersectPoint)
                intersectPoint.applyMatrix4(matrixWorld)

                const distance = raycaster.ray.origin.distanceTo(intersectPoint)

                if (distance < raycaster.near || distance > raycaster.far) return

                intersects.push({

                    distance: distance,
                    distanceToRay: Math.sqrt(rayPointDistanceSq),
                    point: intersectPoint,
                    face: null,
                    object: this,

                })


            }
        }

    }

}
