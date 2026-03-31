import {JSUndoManager} from 'ts-browser-helpers'
import {duplicateObjects, filterTopmostAncestors, IObject3D} from '../../core'

export interface ClipboardState {
    /** References to the source objects (not clones) */
    objects: IObject3D[]
    mode: 'copy' | 'cut'
    /** Original parent per object, for paste-from-cut */
    sourceParents: Map<IObject3D, IObject3D | null>
}

/**
 * Manages an internal object clipboard for copy/cut/paste operations.
 * Scene-independent — does not need a viewer or picker reference.
 * Paste returns the resulting objects so the caller can handle selection.
 */
export class ObjectClipboard {
    private _state: ClipboardState | null = null

    /** Material opacity applied to cut objects to indicate pending cut */
    cutTintOpacity = 0.4

    get state(): ClipboardState | null { return this._state }
    get isEmpty(): boolean { return !this._state }
    get isCut(): boolean { return this._state?.mode === 'cut' }
    get isCopy(): boolean { return this._state?.mode === 'copy' }

    /**
     * Copy objects to clipboard. No scene mutation.
     * Returns {undo, redo} for the clipboard state change.
     */
    copy(objects: IObject3D[], undoManager?: JSUndoManager): void {
        const filtered = filterTopmostAncestors(objects)
        if (!filtered.length) return

        const sourceParents = this._buildParentMap(filtered)
        const prev = this._state

        if (prev?.mode === 'cut') this._removeCutTint(prev.objects)
        this._state = {objects: filtered, mode: 'copy', sourceParents}

        undoManager?.record({
            undo: () => {
                this._state = prev
                if (prev?.mode === 'cut') this._applyCutTint(prev.objects)
            },
            redo: () => {
                if (prev?.mode === 'cut') this._removeCutTint(prev.objects)
                this._state = {objects: filtered, mode: 'copy', sourceParents}
            },
        })
    }

    /**
     * Cut objects to clipboard. No scene mutation — applies visual tint.
     * Returns {undo, redo} for the clipboard state change.
     */
    cut(objects: IObject3D[], undoManager?: JSUndoManager): void {
        const filtered = filterTopmostAncestors(objects)
        if (!filtered.length) return

        const sourceParents = this._buildParentMap(filtered)
        const prev = this._state

        if (prev?.mode === 'cut') this._removeCutTint(prev.objects)
        this._state = {objects: filtered, mode: 'cut', sourceParents}
        this._applyCutTint(filtered)

        undoManager?.record({
            undo: () => {
                this._removeCutTint(filtered)
                this._state = prev
                if (prev?.mode === 'cut') this._applyCutTint(prev.objects)
            },
            redo: () => {
                if (prev?.mode === 'cut') this._removeCutTint(prev.objects)
                this._state = {objects: filtered, mode: 'cut', sourceParents}
                this._applyCutTint(filtered)
            },
        })
    }

    /**
     * Paste from clipboard.
     * - Copy: clones objects (new UUIDs), adds to scene
     * - Cut: re-adds originals (preserves UUIDs), consumes clipboard (single paste)
     * Returns the pasted objects (for selection by caller), or null if nothing to paste.
     */
    paste(undoManager?: JSUndoManager): {objects: IObject3D[], undoRedo: {undo: () => void, redo: () => void}} | null {
        if (!this._state) return null
        return this._state.mode === 'copy' ? this._pasteFromCopy(undoManager) : this._pasteFromCut(undoManager)
    }

    private _pasteFromCopy(undoManager?: JSUndoManager): {objects: IObject3D[], undoRedo: {undo: () => void, redo: () => void}} | null {
        const clipboard = this._state
        if (!clipboard || clipboard.mode !== 'copy') return null

        const {clones, undo, redo} = duplicateObjects(clipboard.objects)
        if (!clones.length) return null

        undoManager?.record({undo, redo})
        return {objects: clones, undoRedo: {undo, redo}}
    }

    private _pasteFromCut(undoManager?: JSUndoManager): {objects: IObject3D[], undoRedo: {undo: () => void, redo: () => void}} | null {
        const clipboard = this._state
        if (!clipboard || clipboard.mode !== 'cut') return null

        const objects = clipboard.objects
        const sourceParents = clipboard.sourceParents

        this._removeCutTint(objects)

        // Re-add to source parents (currently a no-op for position,
        // but sets up plumbing for future paste-to-selection/position)
        for (const obj of objects) {
            obj.removeFromParent()
            const parent = sourceParents.get(obj)
            if (parent) parent.add(obj)
        }

        const saved = this._state
        this._state = null

        const undoRedo = {
            undo: () => {
                this._state = saved
                this._applyCutTint(objects)
            },
            redo: () => {
                this._removeCutTint(objects)
                for (const obj of objects) {
                    obj.removeFromParent()
                    const parent = sourceParents.get(obj)
                    if (parent) parent.add(obj)
                }
                this._state = null
            },
        }
        undoManager?.record(undoRedo)
        return {objects, undoRedo}
    }

    /** Clear clipboard state and remove any cut tint */
    clear(): void {
        if (this._state?.mode === 'cut') this._removeCutTint(this._state.objects)
        this._state = null
    }

    // region Tint

    private _applyCutTint(objects: IObject3D[]): void {
        for (const obj of objects) {
            if (obj.userData.__preCutOpacity === undefined && obj.material && !Array.isArray(obj.material)) {
                obj.userData.__preCutOpacity = obj.material.opacity
                obj.material.opacity = Math.min(obj.material.opacity, this.cutTintOpacity)
                obj.material.setDirty?.()
            }
            obj.userData.__isCut = true
            obj.setDirty?.()
        }
    }

    private _removeCutTint(objects: IObject3D[]): void {
        for (const obj of objects) {
            if (obj.userData.__preCutOpacity !== undefined && obj.material && !Array.isArray(obj.material)) {
                obj.material.opacity = obj.userData.__preCutOpacity
                delete obj.userData.__preCutOpacity
                obj.material.setDirty?.()
            }
            delete obj.userData.__isCut
            obj.setDirty?.()
        }
    }

    // endregion

    private _buildParentMap(objects: IObject3D[]): Map<IObject3D, IObject3D | null> {
        const map = new Map<IObject3D, IObject3D | null>()
        for (const obj of objects) map.set(obj, obj.parent as IObject3D | null)
        return map
    }
}
