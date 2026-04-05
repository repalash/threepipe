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
 * Stores no object references — only the initial matrix and chain state.
 * The source object's current transform is passed in at apply time.
 *
 * The offset only applies when the selection has not changed since the last
 * duplicate. Any selection change (even reselecting the same objects) breaks the chain.
 */
export class DuplicateTracker {
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
     * Record the baseline matrix for the next delta computation.
     * Call AFTER setSelected(clones) so it runs after the selection change event.
     */
    onDuplicated(initialMatrix: Matrix4): void {
        this._initialMatrix.copy(initialMatrix)
        this._chainActive = true
    }

    /**
     * Compute and apply the transform delta to new clones.
     * @param source - the first source object (previous clone) to read current transform from
     * @param mode - 'simple' for independent component offsets, 'compound' for coupled transforms
     * @returns true if an offset was applied
     */
    applyOffset(clones: IObject3D[], source: IObject3D, mode: DuplicateMode = 'simple'): boolean {
        if (!this._chainActive) return false

        const iP = DuplicateTracker._iP
        const iQ = DuplicateTracker._iQ
        const iS = DuplicateTracker._iS
        this._initialMatrix.decompose(iP, iQ, iS)

        const dP = source.position.clone().sub(iP)
        const dQ = iQ.invert().premultiply(source.quaternion.clone()).normalize()
        const dS = source.scale.clone().divide(iS)

        const posChanged = dP.lengthSq() > 1e-10
        const quatChanged = Math.abs(dQ.x) > 1e-6 || Math.abs(dQ.y) > 1e-6 || Math.abs(dQ.z) > 1e-6
        const scaleChanged = Math.abs(dS.x - 1) > 1e-6 || Math.abs(dS.y - 1) > 1e-6 || Math.abs(dS.z - 1) > 1e-6
        if (!posChanged && !quatChanged && !scaleChanged) return false

        const compound = mode === 'compound'
        const rel = DuplicateTracker._rel

        for (const clone of clones) {
            if (compound) {
                rel.copy(clone.position).sub(iP)
                if (scaleChanged) rel.multiply(dS)
                if (quatChanged) rel.applyQuaternion(dQ)
                clone.position.copy(source.position).add(rel)
            } else {
                if (posChanged) clone.position.add(dP)
            }
            if (quatChanged) clone.quaternion.premultiply(dQ).normalize()
            if (scaleChanged) clone.scale.multiply(dS)
            clone.updateMatrixWorld(true)
            clone.setDirty?.({change: 'transform'})
        }

        return true
    }

    saveState(): {matrix: Matrix4, active: boolean} {
        return {matrix: this._initialMatrix.clone(), active: this._chainActive}
    }

    restoreState(state: {matrix: Matrix4, active: boolean}): void {
        this._initialMatrix.copy(state.matrix)
        this._chainActive = state.active
    }

    reset(): void {
        this._initialMatrix.identity()
        this._chainActive = false
    }
}
