/**
 * The one undo history: the viewer's `UndoManagerPlugin` (`JSUndoManager`), with a label on every
 * step and a change event.
 *
 * Everything records here - `ModellingPlugin` commands, `MeshEditPlugin` edit-mode steps, threepipe's
 * `PickingPlugin` (delete, duplicate, hide, selection) and property edits from the inspector - so one
 * Ctrl+Z walks back through all of it in order, which is what Blender's global undo does.
 *
 * `JSUndoManager` has no change event, so the five methods that move the stack are wrapped on the
 * instance to dispatch one; the originals are put back on dispose. That is the only thing here that
 * reaches into the manager; `issues/open/undo-manager-change-event.md` asks for the event upstream.
 */

import type {JSUndoManager, UndoManagerPlugin} from 'threepipe'
import type {HistoryApi, HistoryEntry, LabelledUndoCommand} from '../registry'

type AnyCommand = Record<string, any>

const WRAP = Symbol.for('threepipe.editor-engine.historyWrap')

interface WrappedMethod {
    (...args: unknown[]): unknown
    [WRAP]?: {original: (...a: unknown[]) => unknown, listeners: Set<EditorHistory>}
}

export class EditorHistory implements HistoryApi {
    private _restore: (() => void)[] = []
    private _lastRecorded: AnyCommand | null = null
    /** Label for a step recorded while an operator runs and the recorder gave none (picking, property edits). */
    pendingLabel: string | null = null

    constructor(private _plugin: UndoManagerPlugin, private _onChange: () => void) {
        this._wrap()
    }

    get manager(): JSUndoManager | undefined {
        return this._plugin.undoManager
    }

    /**
     * Wrap the stack-moving methods once per manager. A second `EditorHistory` on the same manager
     * (two engines on one viewer, or one re-created) finds the existing wrapper and joins its
     * listener set instead of wrapping again; dispose leaves the wrapper in place while anyone else
     * is listening, and restores the original only if the method is still ours (nobody wrapped on top).
     */
    private _wrap(): void {
        const um = this.manager as AnyCommand | undefined
        if (!um) return
        for (const name of ['_record', 'undo', 'redo', 'reset', 'replaceLast', 'setLimit']) {
            let wrapper = um[name] as WrappedMethod | undefined
            if (typeof wrapper !== 'function') continue
            if (!wrapper[WRAP]) {
                const original = wrapper as (...a: unknown[]) => unknown
                const listeners = new Set<EditorHistory>()
                const wrapped: WrappedMethod = (...args: unknown[]) => {
                    if (name === '_record' || name === 'replaceLast') {
                        for (const h of listeners) h._beforeRecord(args[0] as AnyCommand)
                    }
                    const r = original.apply(um, args)
                    for (const h of listeners) h._onChange()
                    return r
                }
                wrapped[WRAP] = {original, listeners}
                um[name] = wrapped
                wrapper = wrapped
            }
            const state = wrapper[WRAP]!
            state.listeners.add(this)
            this._restore.push(() => {
                state.listeners.delete(this)
                if (state.listeners.size === 0 && um[name] === wrapper) um[name] = state.original
            })
        }
    }

    private _beforeRecord(cmd: AnyCommand): void {
        if (!cmd || typeof cmd !== 'object') return
        if (typeof cmd.label !== 'string') {
            const label = this.pendingLabel ?? this._eventLabel
            if (label) cmd.label = label
        }
        this._eventLabel = null
        this._lastRecorded = cmd
        // Only the event that follows a record synchronously may name it.
        this._unlabelled = typeof cmd.label === 'string' ? null : cmd
        queueMicrotask(() => { if (this._unlabelled === cmd) this._unlabelled = null })
    }

    private _eventLabel: string | null = null

    /**
     * Name the step that an event is about to cause. `ObjectPicker.setSelected` dispatches
     * `selectedObjectChanged` *and then* records its undo command, so the engine notes the label from
     * the event and the record that follows in the same tick picks it up. Cleared on the next tick, so
     * an unrelated later record is never named after a stale event.
     */
    noteEvent(label: string): void {
        this._eventLabel = label
        queueMicrotask(() => { if (this._eventLabel === label) this._eventLabel = null })
    }

    /** The most recently pushed command, whoever pushed it. */
    get lastRecorded(): AnyCommand | null {
        return this._lastRecorded
    }

    private _unlabelled: AnyCommand | null = null

    /**
     * Name a step that was just pushed without a label, from the event its recorder dispatched right
     * after (the picker records a selection step, then fires `selectedObjectChanged`). Only a step
     * recorded in the same tick qualifies, so an older unlabelled step is never renamed by mistake.
     */
    labelLastRecorded(label: string): void {
        const cmd = this._unlabelled
        if (cmd && typeof cmd.label !== 'string') cmd.label = label
        this._unlabelled = null
    }

    canUndo(): boolean {
        return !!this.manager?.canUndo()
    }

    canRedo(): boolean {
        return !!this.manager?.canRedo()
    }

    undo(): void {
        this.manager?.undo()
    }

    redo(): void {
        this.manager?.redo()
    }

    /** Record an already-performed action. */
    record(cmd: LabelledUndoCommand): void {
        this.manager?.record(cmd)
    }

    /** The step on top of the stack (the last one done), or null. */
    peek(): AnyCommand | null {
        return (this.manager?.peek() as AnyCommand | null) ?? null
    }

    /** Position of a step in the stack, or -1 when it has been dropped. */
    indexOf(cmd: AnyCommand): number {
        return this.manager?.stack.indexOf(cmd as never) ?? -1
    }

    /**
     * Undo until `cmd` is undone - Blender's `ED_undo_pop_op` → `ed_undo_step_by_name`, which "search[es]
     * back a couple of undo's, in case something else added pushes" (ed_undo.cc:386). Returns how many
     * steps were undone, or -1 when the step is no longer on the stack.
     */
    undoTo(cmd: AnyCommand): number {
        const um = this.manager
        if (!um) return -1
        const index = this.indexOf(cmd)
        if (index < 0 || index > um.sp) return -1
        let n = 0
        while (um.sp >= index && um.canUndo()) {
            um.undo()
            n++
        }
        return n
    }

    entries(): HistoryEntry[] {
        const um = this.manager
        if (!um) return []
        return um.stack.map((cmd, i) => ({label: labelOf(cmd as AnyCommand), undone: i > um.sp}))
    }

    dispose(): void {
        for (const r of this._restore.splice(0)) r()
    }
}

/** A readable label for any command on the stack, including the ones other plugins push. */
export function labelOf(cmd: AnyCommand | null | undefined): string {
    if (!cmd) return 'Action'
    if (typeof cmd.label === 'string') return cmd.label
    if (cmd.uid !== undefined && typeof cmd.uid === 'string') return cmd.uid.replace(/[_-]/g, ' ')
    if (cmd.type === 'ThreeViewerUM_set' || cmd.type === 'UiConfigMethods_set') {
        const key = cmd.binding?.[1] ?? cmd.key
        return key ? `Set ${String(key)}` : 'Set value'
    }
    if (typeof cmd.type === 'string') return cmd.type.replace(/^.*_/, '').replace(/[_-]/g, ' ')
    return 'Action'
}
