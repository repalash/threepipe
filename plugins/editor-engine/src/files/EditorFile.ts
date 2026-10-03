/**
 * The document as a browser sees it: a name, an unsaved-changes flag, and the names of files opened
 * before. A browser page cannot write back to the file it opened, so "Save" downloads `<name>.glb`
 * and "dirty" is measured against the undo history rather than a file on disk: the position and
 * record count at the last save/open/new are remembered, and the document is dirty whenever either
 * has moved (Blender's `wm->file_saved` is cleared on every undo push, the same idea).
 *
 * Recent files are metadata only (`name`, `size`, `lastModified`) in `localStorage`; nothing about
 * the file's contents leaves the page, and no handle is kept, so an entry can only re-open the
 * file picker.
 */

import type {FileApi, RecentFile} from '../registry'
import type {EditorHistory} from '../history/EditorHistory'

export const RECENT_FILES_MAX = 8

export class EditorFile implements FileApi {
    private _name: string | null = null
    private _clean = {position: -1, serial: 0}
    private _recent: RecentFile[] = []

    constructor(private _history: EditorHistory, private _storageKey: string | null, private _onChange: () => void) {
        this._recent = this._load()
    }

    get name(): string | null {
        return this._name
    }

    get dirty(): boolean {
        return this._history.position !== this._clean.position || this._history.serial !== this._clean.serial
    }

    get recent(): RecentFile[] {
        return [...this._recent]
    }

    /** Name the document (without extension). Null goes back to "untitled". */
    setName(name: string | null): void {
        const n = name ? name.replace(/\.(glb|gltf)$/i, '').trim() || null : null
        if (n === this._name) return
        this._name = n
        this._onChange()
    }

    /** The history as it is now is the saved state. */
    markClean(): void {
        this._clean = {position: this._history.position, serial: this._history.serial}
        this._onChange()
    }

    /** Remember a file that was opened or dropped. The newest comes first; duplicates by name move up. */
    addRecent(file: {name: string, size?: number, lastModified?: number}): void {
        const entry: RecentFile = {name: file.name, size: file.size ?? 0, lastModified: file.lastModified ?? 0, openedAt: Date.now()}
        this._recent = [entry, ...this._recent.filter(r => r.name !== entry.name)].slice(0, RECENT_FILES_MAX)
        this._save()
        this._onChange()
    }

    clearRecent(): void {
        if (!this._recent.length) return
        this._recent = []
        this._save()
        this._onChange()
    }

    private _load(): RecentFile[] {
        if (!this._storageKey) return []
        try {
            const raw = localStorage.getItem(this._storageKey)
            const list = raw ? JSON.parse(raw) : []
            return Array.isArray(list) ? list.filter(r => r && typeof r.name === 'string').slice(0, RECENT_FILES_MAX) : []
        } catch {
            return []
        }
    }

    private _save(): void {
        if (!this._storageKey) return
        try { localStorage.setItem(this._storageKey, JSON.stringify(this._recent)) } catch { /* private mode / quota */ }
    }
}

/** A file name's base, for the document name: `models/chair.v2.glb` → `chair.v2`. */
export function baseName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? fileName
    return base.replace(/\.[^.]+$/, '')
}
