import {IObject3D} from '../../core'
import {JSUndoManager} from 'ts-browser-helpers'
import {Matrix4, Object3D, Quaternion, Vector3} from 'three'
import type {ThreeViewer} from '../../viewer'
import type {PickingPlugin} from './PickingPlugin'

/**
 * Shared helper for multi-object transform gizmo support.
 * Used by both TransformControlsPlugin and PivotControlsPlugin.
 */
export class MultiSelectHelper {
    multiObjects: IObject3D[] = []
    private _dummy: Object3D | null = null
    private _dummyStart = new Matrix4()
    private _startStates: {position: Vector3, quaternion: Quaternion, scale: Vector3}[] = []
    private _startWorldMatrices: Matrix4[] = []

    get dummy(): Object3D | null { return this._dummy }
    get hasMultiSelect(): boolean { return this.multiObjects.length > 1 }
    get hasStartStates(): boolean { return this._startStates.length > 0 }

    setup(objects: IObject3D[], viewer: ThreeViewer): Object3D {
        this.multiObjects = objects
        if (!this._dummy) {
            this._dummy = new Object3D()
            this._dummy.userData.isMultiSelectDummy = true
            viewer.scene.addObject(this._dummy as any, {addToRoot: true})
        }
        const median = new Vector3()
        for (const obj of objects) {
            obj.updateWorldMatrix(true, false)
            median.add(new Vector3().setFromMatrixPosition(obj.matrixWorld))
        }
        median.divideScalar(objects.length)
        this._dummy.position.copy(median)
        this._dummy.quaternion.identity()
        this._dummy.scale.setScalar(1)
        this._dummy.updateMatrixWorld(true)
        return this._dummy
    }

    clear(viewer: ThreeViewer) {
        this.multiObjects = []
        this._startStates = []
        this._startWorldMatrices = []
        if (this._dummy) {
            viewer.scene.remove(this._dummy)
            this._dummy = null
        }
    }

    captureStart() {
        if (!this._dummy || !this.multiObjects.length) return
        this._dummy.updateMatrixWorld(true)
        this._dummyStart.copy(this._dummy.matrixWorld)
        this._startStates = this.multiObjects.map(o => ({
            position: o.position.clone(),
            quaternion: o.quaternion.clone(),
            scale: o.scale.clone(),
        }))
        this._startWorldMatrices = this.multiObjects.map(o => {
            o.updateWorldMatrix(true, false)
            return o.matrixWorld.clone()
        })
    }

    applyDelta() {
        if (!this._dummy || !this.multiObjects.length || !this._startWorldMatrices.length) return
        this._dummy.updateMatrixWorld(true)
        const dummyStartInv = this._dummyStart.clone().invert()
        const deltaWorld = this._dummy.matrixWorld.clone().multiply(dummyStartInv)

        for (let i = 0; i < this.multiObjects.length; i++) {
            const obj = this.multiObjects[i]
            const newWorld = deltaWorld.clone().multiply(this._startWorldMatrices[i])
            const parentInv = new Matrix4()
            if (obj.parent) parentInv.copy(obj.parent.matrixWorld).invert()
            const newLocal = parentInv.clone().multiply(newWorld)
            newLocal.decompose(obj.position, obj.quaternion, obj.scale)
            obj.updateMatrixWorld(true)
            ;(obj as IObject3D).setDirty?.({change: 'transform', frameFade: false})
        }
    }

    /** Reposition the dummy to the median of all selected objects */
    updateDummyPosition() {
        if (!this._dummy || !this.multiObjects.length) return
        const median = new Vector3()
        for (const obj of this.multiObjects) {
            obj.updateWorldMatrix(true, false)
            median.add(new Vector3().setFromMatrixPosition(obj.matrixWorld))
        }
        median.divideScalar(this.multiObjects.length)
        this._dummy.position.copy(median)
        this._dummy.quaternion.identity()
        this._dummy.scale.setScalar(1)
        this._dummy.updateMatrixWorld(true)
    }

    /** Record smart duplicate move for multi-select using first object's position delta */
    recordDuplicateMove(viewer: ThreeViewer): void {
        if (!this.multiObjects.length || !this._startStates.length) return
        const delta = this.multiObjects[0].position.clone().sub(this._startStates[0].position)
        if (delta.lengthSq() === 0) return
        const picking = viewer.getPlugin<PickingPlugin>('Picking')
        picking?.recordDuplicateMove(this.multiObjects[0], delta)
    }

    recordUndo(undoManager: JSUndoManager) {
        if (!this.multiObjects.length || !this._startStates.length) return
        const objects = [...this.multiObjects]
        const startStates = this._startStates.map(s => ({
            position: s.position.clone(),
            quaternion: s.quaternion.clone(),
            scale: s.scale.clone(),
        }))
        const endStates = objects.map(obj => ({
            position: obj.position.clone(),
            quaternion: obj.quaternion.clone(),
            scale: obj.scale.clone(),
        }))
        let changed = false
        for (let i = 0; i < objects.length; i++) {
            if (!startStates[i].position.equals(endStates[i].position) ||
                !startStates[i].quaternion.equals(endStates[i].quaternion) ||
                !startStates[i].scale.equals(endStates[i].scale)) {
                changed = true
                break
            }
        }
        if (!changed) return

        undoManager.record({
            undo: () => {
                for (let i = 0; i < objects.length; i++) {
                    objects[i].position.copy(startStates[i].position)
                    objects[i].quaternion.copy(startStates[i].quaternion)
                    objects[i].scale.copy(startStates[i].scale)
                    objects[i].updateMatrixWorld(true)
                    ;(objects[i] as IObject3D).setDirty?.({change: 'transform'})
                }
                this.updateDummyPosition()
            },
            redo: () => {
                for (let i = 0; i < objects.length; i++) {
                    objects[i].position.copy(endStates[i].position)
                    objects[i].quaternion.copy(endStates[i].quaternion)
                    objects[i].scale.copy(endStates[i].scale)
                    objects[i].updateMatrixWorld(true)
                    ;(objects[i] as IObject3D).setDirty?.({change: 'transform'})
                }
                this.updateDummyPosition()
            },
        })
    }
}
