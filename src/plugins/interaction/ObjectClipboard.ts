import {filterTopmostAncestors, IObject3D, incrementObjectCloneName} from '../../core'

export type ClipboardMode = 'copy' | 'cut'

export interface ClipboardState {
    objects: IObject3D[]
    mode: ClipboardMode
    sourceParents: Map<IObject3D, IObject3D | null>
}

/**
 * Internal object clipboard for copy/cut/paste.
 * - copy/cut: store references (no scene mutation)
 * - paste: clone or move objects directly to the destination parent (one step, no reparenting)
 * - Returns {objects, undo, redo} from paste — caller records undo and handles selection.
 */
export class ObjectClipboard {
    private _state: ClipboardState | null = null

    get state(): ClipboardState | null { return this._state }
    get isEmpty(): boolean { return !this._state }

    copy(objects: IObject3D[]): void {
        const filtered = filterTopmostAncestors(objects)
        if (!filtered.length) return
        this._state = {objects: filtered, mode: 'copy', sourceParents: this._parentMap(filtered)}
    }

    cut(objects: IObject3D[]): void {
        const filtered = filterTopmostAncestors(objects)
        if (!filtered.length) return
        this._state = {objects: filtered, mode: 'cut', sourceParents: this._parentMap(filtered)}
    }

    /**
     * Paste from clipboard. Clones (copy) or moves (cut) objects directly to destination.
     * @param destination - target parent, or null to use source parents
     * @returns pasted objects + undo/redo, or null if clipboard is empty
     */
    paste(destination?: IObject3D | null): {objects: IObject3D[], undo: () => void, redo: () => void} | null {
        if (!this._state) return null
        return this._state.mode === 'copy' ? this._pasteFromCopy(destination) : this._pasteFromCut(destination)
    }

    clear(): void { this._state = null }

    private _pasteFromCopy(destination?: IObject3D | null): {objects: IObject3D[], undo: () => void, redo: () => void} | null {
        const clipboard = this._state
        if (!clipboard) return null

        const clones: IObject3D[] = []
        const cloneParents = new Map<IObject3D, IObject3D>()

        for (const obj of clipboard.objects) {
            const clone = obj.clone(true) as IObject3D
            incrementObjectCloneName(obj, clone)
            const parent = destination ?? obj.parent
            if (parent) {
                parent.add(clone)
                cloneParents.set(clone, parent)
            }
            clones.push(clone)
        }

        return {
            objects: clones,
            undo: () => { for (const c of clones) c.removeFromParent() },
            redo: () => { for (const c of clones) { const p = cloneParents.get(c); if (p && !c.parent) p.add(c) } },
        }
    }

    private _pasteFromCut(destination?: IObject3D | null): {objects: IObject3D[], undo: () => void, redo: () => void} | null {
        const clipboard = this._state
        if (!clipboard) return null

        const objects = clipboard.objects
        const sourceParents = clipboard.sourceParents

        // Move directly to destination (or back to source parents)
        for (const obj of objects) {
            const target = (destination ?? sourceParents.get(obj)) as IObject3D | null
            if (target && obj.parent !== target) {
                obj.removeFromParent()
                target.add(obj)
            }
        }

        // Consume clipboard
        this._state = null

        return {
            objects,
            undo: () => {
                // Move back to source parents
                for (const obj of objects) {
                    const parent = sourceParents.get(obj)
                    if (parent && obj.parent !== parent) { obj.removeFromParent(); parent.add(obj) }
                }
                this._state = clipboard
            },
            redo: () => {
                for (const obj of objects) {
                    const target = (destination ?? sourceParents.get(obj)) as IObject3D | null
                    if (target && obj.parent !== target) { obj.removeFromParent(); target.add(obj) }
                }
                this._state = null
            },
        }
    }

    private _parentMap(objects: IObject3D[]): Map<IObject3D, IObject3D | null> {
        const map = new Map<IObject3D, IObject3D | null>()
        for (const obj of objects) map.set(obj, obj.parent as IObject3D | null)
        return map
    }
}
