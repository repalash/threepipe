import type {WasmSorter} from '../cpp-sorter/worker'
import {Remote, transfer} from 'comlink'
import {
    Box3,
    BufferAttribute,
    Camera,
    IGeometry,
    iGeometryCommons,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    type IObject3D,
    Matrix4,
    PerspectiveCamera,
    Sphere,
    Vector3,
} from 'threepipe'

export class GaussianSplatGeometry extends InstancedBufferGeometry implements IGeometry {
    constructor(
        private _worker: Remote<WasmSorter>,
        private _vertexCount: number,
        private _maxSplats: number,
        private _onLoad?: (geometry: GaussianSplatGeometry) => void,
    ) {
        super()
        iGeometryCommons.upgradeGeometry.call(this)
        this.initAttributes()
    }

    readonly isGaussianSplatGeometry = true

    assetType: 'geometry' // dont set the value here since its checked in upgradeGeometry
    center2 = iGeometryCommons.center2
    setDirty = iGeometryCommons.setDirty
    refreshUi = iGeometryCommons.refreshUi
    appliedMeshes = new Set<IObject3D>()

    private _viewProj: number[] = []
    private _sortRunning = false

    private _initialized = false

    private _centersBuffer: Float32Array = new Float32Array(0)

    public async update(camera: PerspectiveCamera | Camera, meshMatrixWorld: Matrix4) {
        if (this._sortRunning || !this._initialized || !this._worker) {
            return
        }

        camera.updateMatrixWorld(true)

        this._viewProj = new Matrix4().multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(meshMatrixWorld).elements

        this._sortRunning = true
        const viewProj = new Float32Array(this._viewProj)
        const result = await this._worker.runSort(viewProj)

        const {quat, scale, center, color} = this._extractViews(result)

        if (this._centersBuffer.length !== center.length) this._centersBuffer = new Float32Array(center)
        else this._centersBuffer.set(center)

        ;(this.attributes.color as InstancedBufferAttribute).array = color;
        (this.attributes.quat as InstancedBufferAttribute).array = quat;
        (this.attributes.scale as InstancedBufferAttribute).array = scale;
        (this.attributes.center as InstancedBufferAttribute).array = this._centersBuffer
        // (this.attributes.center as InstancedBufferAttribute).array = center

        const pms = Promise.all([
            new Promise<void>(resolve => (this.attributes.color as InstancedBufferAttribute).onUpload(resolve)),
            new Promise<void>(resolve => (this.attributes.quat as InstancedBufferAttribute).onUpload(resolve)),
            new Promise<void>(resolve => (this.attributes.scale as InstancedBufferAttribute).onUpload(resolve)),
            // new Promise<void>(resolve => (this.attributes.center as InstancedBufferAttribute).onUpload(resolve)),
        ])

        this.attributes.color.needsUpdate = true
        this.attributes.quat.needsUpdate = true
        this.attributes.scale.needsUpdate = true
        this.attributes.center.needsUpdate = true

        this.setDirty()

        await pms

        await this._worker.returnBuffer(transfer(result, [result]))

        this._sortRunning = false
    }

    async initAttributes() {
        const viewProj = new Float32Array(this._viewProj)
        const result = await this._worker.runSort(viewProj)
        const {quat, scale, center, color} = this._extractViews(result)

        this.setAttribute('color', new InstancedBufferAttribute(color, 4, true))
        this.setAttribute('quat', new InstancedBufferAttribute(quat, 4, true))
        this.setAttribute('scale', new InstancedBufferAttribute(scale, 3, true))
        this.setAttribute('center', new InstancedBufferAttribute(center, 3, true))
        this.setAttribute('position', new BufferAttribute(new Float32Array([1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 1, 0]), 3, true))

        this.attributes.position.needsUpdate = true
        this.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 3, 0]), 1, true))
        this.instanceCount = Math.min(quat.length / 4, this._maxSplats)
        this.computeBoundingBox()
        this.computeBoundingSphere()

        this._initialized = true
        this.setDirty()
        this._onLoad && this._onLoad(this)
    }

    private _extractViews(receivedBuffer: ArrayBuffer): {quat: Float32Array; scale: Float32Array; center: Float32Array; color: Float32Array} {
        const combined = new Float32Array(receivedBuffer)

        const quatLength = 4 * this._vertexCount
        const scaleLength = 3 * this._vertexCount
        const centerLength = 3 * this._vertexCount
        const colorLength = 4 * this._vertexCount

        const quatOffset = 0
        const scaleOffset = quatOffset + quatLength
        const centerOffset = scaleOffset + scaleLength
        const colorOffset = centerOffset + centerLength

        const quat = combined.subarray(quatOffset, quatOffset + quatLength)
        const scale = combined.subarray(scaleOffset, scaleOffset + scaleLength)
        const center = combined.subarray(centerOffset, centerOffset + centerLength)
        const color = combined.subarray(colorOffset, colorOffset + colorLength)

        return {quat, scale, center, color}
    }

    computeBoundingBox() {
        if (!this.getAttribute('center')) return super.computeBoundingBox()

        const box = this.boundingBox ?? (this.boundingBox = new Box3())
        box.setFromBufferAttribute(this.getAttribute('center') as InstancedBufferAttribute)

        if (isNaN(this.boundingBox!.min.x) || isNaN(this.boundingBox!.min.y) || isNaN(this.boundingBox!.min.z)) {
            console.error('GaussianSplatGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', this)
        }
    }

    computeBoundingSphere() {

        if (this.boundingSphere === null) this.boundingSphere = new Sphere()

        const position = this.attributes.center

        if (position && (position as any).isGLBufferAttribute) {
            console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".', this)
            this.boundingSphere.set(new Vector3(), Infinity)
            return
        }

        if (position) {
            // first, find the center of the bounding sphere
            const center = this.boundingSphere.center
            if (!this.boundingBox) this.computeBoundingBox()
            this.boundingBox!.getCenter(center)

            // second, try to find a boundingSphere with a radius smaller than the
            // boundingSphere of the boundingBox: sqrt(3) smaller in the best case

            let maxRadiusSq = 0
            const vector = new Vector3()

            for (let i = 0, il = position.count; i < il; i++) {
                vector.fromBufferAttribute(position, i)
                maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(vector))
            }

            this.boundingSphere.radius = Math.sqrt(maxRadiusSq)

            if (isNaN(this.boundingSphere.radius)) {
                console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this)
            }

        }

    }

}
