import {describe, expect, test} from 'vitest'
import {UiConfigRendererBase, type UiTooltipHook} from 'threepipe'
import {editorTooltip, useEditorTooltip} from '../../plugins/tweakpane-editor/src/tooltips'

describe('useEditorTooltip', () => {
    test('two editors: the hook from before comes back when the last one is removed, in either order', () => {
        const before: UiTooltipHook = () => undefined
        for (const order of [[0, 1], [1, 0]]) {
            UiConfigRendererBase.Tooltip = before
            const release = [useEditorTooltip(), useEditorTooltip()]
            expect(UiConfigRendererBase.Tooltip).toBe(editorTooltip)
            release[order[0]]()
            release[order[0]]() // a second release does nothing
            expect(UiConfigRendererBase.Tooltip).toBe(editorTooltip)
            release[order[1]]()
            expect(UiConfigRendererBase.Tooltip).toBe(before)
        }
    })

    test('a hook that the app set meanwhile stays', () => {
        const app: UiTooltipHook = () => undefined
        const release = useEditorTooltip()
        UiConfigRendererBase.Tooltip = app
        release()
        expect(UiConfigRendererBase.Tooltip).toBe(app)
    })
})
