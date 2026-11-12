/**
 * UndoManagerPlugin unit tests: an action recorded with `performAction` undoes and redoes with the
 * plugin's own presets, without a UI plugin (which would add the uiconfig.js presets).
 * No DOM: the undo manager is created without hot keys instead of through `onAdded`.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {JSUndoManager} from 'ts-browser-helpers'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    // through the package entry: importing the plugin module alone runs into an import cycle
    tp = await import('../../index')
}, timeout)

/** The plugin with an undo manager and its presets, as `onAdded` sets them up. */
function plugin() {
    const p = new tp.UndoManagerPlugin()
    p.undoManager = new JSUndoManager({bindHotKeys: false, limit: p.limit, debug: false})
    p._refresh()
    return p
}

describe('UndoManagerPlugin.performAction', {timeout}, () => {
    test('records an action that undoes and redoes with the plugin presets', async() => {
        const p = plugin()
        const target = {count: 0, add(n: number) {
            this.count += n
            return () => this.count -= n
        }}
        let undoRedo = 0
        await p.performAction(target, target.add, [2], 'add', () => undoRedo++)
        expect(target.count).toBe(2)
        expect(p.undoManager.peek().type).toBe(p.undoCommandTypes.action)

        p.undo()
        await Promise.resolve()
        expect(target.count).toBe(0)
        p.redo()
        await Promise.resolve()
        expect(target.count).toBe(2)
        expect(undoRedo).toBe(2)
    })
})
