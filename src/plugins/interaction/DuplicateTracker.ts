import {Vector3} from 'three'

/**
 * Tracks the last move delta after a duplicate operation to enable
 * Figma-style "smart duplicate" — pressing Ctrl+D repeatedly
 * places copies at consistent offsets.
 *
 * The offset only applies when the selection has not changed since the last
 * duplicate+move. Any selection change (even reselecting the same objects)
 * breaks the chain.
 */
export class DuplicateTracker {
    private _offset: Vector3 | null = null
    private _cloneUUIDs = new Set<string>()
    private _chainActive = false

    /** Any selection change breaks the duplicate chain. */
    onSelectionChanged(): void {
        this._chainActive = false
    }

    /** Called after duplicating. Must be called AFTER setSelected(clones). */
    onDuplicated(clones: {uuid: string}[]): void {
        this._cloneUUIDs.clear()
        for (const c of clones) this._cloneUUIDs.add(c.uuid)
        this._chainActive = true
    }

    /** Called when a freshly duplicated object is moved. */
    onCloneMoved(object: {uuid: string}, delta: Vector3): void {
        if (!this._cloneUUIDs.has(object.uuid)) return
        this._offset = delta.clone()
    }

    /** Returns offset if chain is active, null otherwise. */
    getOffset(): Vector3 | null {
        return this._chainActive && this._offset ? this._offset.clone() : null
    }

    /** For undo of duplicate — stops tracking clones but keeps offset for future chains. */
    onDuplicateUndone(): void {
        this._cloneUUIDs.clear()
        this._chainActive = false
    }

    reset(): void {
        this._offset = null
        this._cloneUUIDs.clear()
        this._chainActive = false
    }
}
