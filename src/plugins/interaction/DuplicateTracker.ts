import {Matrix4, Quaternion, Vector3} from 'three'
import type {IObject3D} from '../../core'

export type DuplicateMode = 'simple' | 'compound'

/**
 * Tracks the transform delta after a duplicate operation to enable
 * smart duplicate chaining — pressing Ctrl+D repeatedly places copies
 * at consistent offsets.
 *
 * Supports two modes (only position application differs):
 * - **simple**: translation in constant parent-space direction (Figma-style, grids)
 * - **compound**: translation rotates with the object (circular arrays, spirals)
 *
 * The offset only applies when the selection has not changed since the last
 * duplicate. Any selection change (even reselecting the same objects) breaks the chain.
 */
export class DuplicateTracker {
    private _trackedClone: IObject3D | null = null
    private _initialMatrix = new Matrix4()
    private _chainActive = false

    private static _iP = new Vector3()
    private static _iQ = new Quaternion()
    private static _iS = new Vector3()
    private static _rel = new Vector3()

    /** Any selection change breaks the duplicate chain. */
    onSelectionChanged(): void {
        this._chainActive = false
    }

    /**
     * Called after duplicating. Must be called AFTER setSelected(clones).
     * @param initialMatrix - pre-offset matrix for the first clone (pass when applyOffset was called first)
     */
    onDuplicated(clones: IObject3D[], initialMatrix?: Matrix4): void {
        if (clones.length > 0) {
            this._trackedClone = clones[0]
            if (initialMatrix) this._initialMatrix.copy(initialMatrix)
            else this._initialMatrix.compose(clones[0].position, clones[0].quaternion, clones[0].scale)
        } else {
            this._trackedClone = null
        }
        this._chainActive = true
    }

    /**
     * Compute and apply the transform delta to new clones.
     *
     * Both modes use the same component deltas (dP, dQ, dS). Only position differs:
     * - simple:   `clone.pos += dP`
     * - compound: `clone.pos = currentPos + dQ.rotate(dS * (clone.pos - initialPos))`
     *
     * @returns true if an offset was applied
     */
    applyOffset(clones: IObject3D[], mode: DuplicateMode = 'simple'): boolean {
        if (!this._chainActive || !this._trackedClone) return false

        const iP = DuplicateTracker._iP
        const iQ = DuplicateTracker._iQ
        const iS = DuplicateTracker._iS
        this._initialMatrix.decompose(iP, iQ, iS)

        const dP = this._trackedClone.position.clone().sub(iP)
        const dQ = iQ.invert().premultiply(this._trackedClone.quaternion.clone())
        const dS = this._trackedClone.scale.clone().divide(iS)

        const posChanged = dP.lengthSq() > 1e-10
        const quatChanged = Math.abs(dQ.x) > 1e-6 || Math.abs(dQ.y) > 1e-6 || Math.abs(dQ.z) > 1e-6
        const scaleChanged = Math.abs(dS.x - 1) > 1e-6 || Math.abs(dS.y - 1) > 1e-6 || Math.abs(dS.z - 1) > 1e-6
        if (!posChanged && !quatChanged && !scaleChanged) return false

        const compound = mode === 'compound'
        const rel = DuplicateTracker._rel

        for (const clone of clones) {
            if (compound) {
                // Rotate+scale the clone's offset from initial position, place at current position
                rel.copy(clone.position).sub(iP)
                if (scaleChanged) rel.multiply(dS)
                if (quatChanged) rel.applyQuaternion(dQ)
                clone.position.copy(this._trackedClone.position).add(rel)
            } else {
                if (posChanged) clone.position.add(dP)
            }
            if (quatChanged) clone.quaternion.premultiply(dQ)
            if (scaleChanged) clone.scale.multiply(dS)
            clone.updateMatrixWorld(true)
            clone.setDirty?.({change: 'transform'})
        }

        return true
    }

    onDuplicateUndone(): void {
        this._trackedClone = null
        this._chainActive = false
    }

    reset(): void {
        this._trackedClone = null
        this._initialMatrix.identity()
        this._chainActive = false
    }
}
