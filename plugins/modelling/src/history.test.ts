import {beforeEach, describe, expect, it} from 'vitest'
import {ModellingHistory} from './history'
import {EntrySnapshot, ModellingDocument, ModellingEntry} from './document'

/**
 * A stand-in document holding a number per object, so the history's restore order and bookkeeping
 * can be tested without a viewer. The real document is exercised end to end in the Playwright suite.
 */
class FakeDocument {
    values = new Map<string, number | null>()

    find(id: string) {
        return this.values.get(id) === null || this.values.get(id) === undefined
            ? undefined : {id} as unknown as ModellingEntry
    }

    snapshot(entry: ModellingEntry): EntrySnapshot {
        return {id: entry.id, name: entry.id, mesh: this.values.get(entry.id) as never,
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            visible: true, parentId: null, materialColor: null}
    }

    restore(snap: EntrySnapshot): void {
        this.values.set(snap.id, snap.mesh as unknown as number | null)
    }

    /** The before-state a command would have recorded for these ids. */
    before(ids: string[]): EntrySnapshot[] {
        return ids.map(id => ({
            id, name: id, mesh: (this.values.get(id) ?? null) as never,
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            visible: true, parentId: null, materialColor: null,
        }))
    }
}

describe('history', () => {
    let doc: FakeDocument
    let history: ModellingHistory

    beforeEach(() => {
        doc = new FakeDocument()
        history = new ModellingHistory(doc as unknown as ModellingDocument)
    })

    /** Run a "command" that sets `id` to `value`, recording undo the way the dispatcher does. */
    const command = (op: string, id: string, value: number | null, index: number) => {
        const before = doc.before([id])
        doc.values.set(id, value)
        history.push(op, `${op} ${id}`, before, index)
    }

    it('undoes and redoes one command', () => {
        command('primitive', 'a', 1, 1)
        command('transform', 'a', 2, 2)
        expect(doc.values.get('a')).toBe(2)

        expect(history.undo()).toBe(1)
        expect(doc.values.get('a')).toBe(1)
        expect(history.redo()).toBe(1)
        expect(doc.values.get('a')).toBe(2)
    })

    it('undoes several commands at once and stops at the bottom', () => {
        command('a', 'x', 1, 1)
        command('b', 'x', 2, 2)
        command('c', 'x', 3, 3)
        expect(history.undo(5)).toBe(3)
        expect(doc.values.get('x')).toBe(null)
        expect(history.canUndo).toBe(false)
        expect(history.undo()).toBe(0)
    })

    it('discards redo once a new command is run, as every editor does', () => {
        command('a', 'x', 1, 1)
        command('b', 'x', 2, 2)
        history.undo()
        expect(history.canRedo).toBe(true)
        command('c', 'x', 9, 3)
        expect(history.canRedo).toBe(false)
        expect(doc.values.get('x')).toBe(9)
    })

    it('rewinds to a named checkpoint', () => {
        command('a', 'x', 1, 1)
        history.checkpoint('hull done')
        command('b', 'x', 2, 2)
        command('c', 'x', 3, 3)

        expect(history.undoTo('hull done')).toBe(2)
        expect(doc.values.get('x')).toBe(1)
    })

    it('names the checkpoints it does have when one is missing', () => {
        command('a', 'x', 1, 1)
        history.checkpoint('hull done')
        expect(() => history.undoTo('nope')).toThrow(/no checkpoint "nope" - have: hull done/)
    })

    it('records the after-state so redo restores a deletion', () => {
        command('primitive', 'a', 1, 1)
        command('delete', 'a', null, 2)
        expect(doc.values.get('a')).toBe(null)

        history.undo()
        expect(doc.values.get('a')).toBe(1)
        history.redo()
        expect(doc.values.get('a')).toBe(null)
    })

    it('ignores a command that touched nothing', () => {
        history.push('inspect', 'inspect', [], 1)
        expect(history.canUndo).toBe(false)
    })

    it('keeps a readable log, marking what has been undone', () => {
        command('primitive', 'a', 1, 1)
        command('transform', 'a', 2, 2)
        history.undo()
        expect(history.log).toEqual([
            {index: 1, op: 'primitive', label: 'primitive a', checkpoint: undefined, undone: false},
            {index: 2, op: 'transform', label: 'transform a', checkpoint: undefined, undone: true},
        ])
    })

    it('drops the oldest entries past the limit', () => {
        history.limit = 3
        for (let i = 1; i <= 5; i++) command('step', 'x', i, i)
        expect(history.entries.length).toBe(3)
        expect(history.entries[0].index).toBe(3)
    })
})
