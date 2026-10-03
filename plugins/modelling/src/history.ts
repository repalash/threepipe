/**
 * Undo, redo and checkpoints.
 *
 * Snapshot-based, one entry per mutating command. The document records the before-state of every
 * object a command touches (see `ModellingDocument.record`), so no command implements its own undo -
 * which is the design that keeps a large command table from rotting, because a new command is
 * undoable the moment it is written.
 *
 * Blender's undo is chunked and diffed for memory reasons. That is a real optimisation and it is
 * noted in the kernel subplan as future work; at the scale an agent session actually reaches - the
 * SU-152 report's 149 operations over 64 objects - whole-mesh snapshots of the touched objects are
 * far simpler and cost little.
 */

import {EntrySnapshot, ModellingDocument} from './document'

export interface HistoryEntry {
    op: string
    label: string
    /** Object states as they were *before* the command ran. */
    before: EntrySnapshot[]
    /** Object states as they were *after*. Filled in when the entry is pushed. */
    after: EntrySnapshot[]
    /** Named by a `checkpoint` command, so `undo {to}` can rewind to it. */
    checkpoint?: string
    index: number
}

export class ModellingHistory {
    /** Oldest first. Everything above `_position` has been undone and can be redone. */
    private _entries: HistoryEntry[] = []
    private _position = 0

    /** Entries kept. Older ones are dropped; 200 commands is well past any real session. */
    limit = 200

    constructor(private _doc: ModellingDocument) {}

    get entries(): HistoryEntry[] {
        return this._entries
    }

    get canUndo(): boolean {
        return this._position > 0
    }

    get canRedo(): boolean {
        return this._position < this._entries.length
    }

    /** The command log, for a UI timeline or for an agent asking what it has done. */
    get log(): {index: number, op: string, label: string, checkpoint?: string, undone: boolean}[] {
        return this._entries.map((e, i) => ({
            index: e.index,
            op: e.op,
            label: e.label,
            checkpoint: e.checkpoint,
            undone: i >= this._position,
        }))
    }

    push(op: string, label: string, before: EntrySnapshot[], index: number): void {
        if (!before.length) return
        // A new command discards anything that was undone, as every editor does.
        this._entries.length = this._position
        const after = before
            .map(b => this._doc.find(b.id))
            .filter((e): e is NonNullable<typeof e> => !!e)
            .map(e => this._doc.snapshot(e))
        // Objects the command deleted have no "after"; record the absence so redo removes them again.
        for (const b of before) {
            if (!this._doc.find(b.id)) after.push({...b, mesh: null})
        }
        this._entries.push({op, label, before, after, index})
        if (this._entries.length > this.limit) this._entries.shift()
        this._position = this._entries.length
    }

    /** Name the most recent command, so it can be rewound to later. */
    checkpoint(name: string): HistoryEntry | null {
        const entry = this._entries[this._position - 1]
        if (entry) entry.checkpoint = name
        return entry ?? null
    }

    undo(steps = 1): number {
        let done = 0
        while (done < steps && this.canUndo) {
            const entry = this._entries[--this._position]
            for (const snap of entry.before) this._doc.restore(snap)
            done++
        }
        return done
    }

    redo(steps = 1): number {
        let done = 0
        while (done < steps && this.canRedo) {
            const entry = this._entries[this._position++]
            for (const snap of entry.after) this._doc.restore(snap)
            done++
        }
        return done
    }

    /** Rewind until the named checkpoint is the most recent applied command. */
    undoTo(checkpoint: string): number {
        const target = this._entries.findIndex(e => e.checkpoint === checkpoint)
        if (target < 0) {
            const names = this._entries.filter(e => e.checkpoint).map(e => e.checkpoint).join(', ')
            throw new Error(`no checkpoint "${checkpoint}"`
                + (names ? ` - have: ${names}` : ' - none have been made'))
        }
        return this.undo(this._position - (target + 1))
    }

    clear(): void {
        this._entries.length = 0
        this._position = 0
    }
}
