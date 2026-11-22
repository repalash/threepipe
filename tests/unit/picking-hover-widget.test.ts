/**
 * PickingPlugin.widgetEnabled turns off the hover widget too, not only the selection widgets: while the widgets are off
 * the hover updates do not move it, so it would stay on the last hovered object. No WebGL.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'

let tp: any
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('PickingPlugin.widgetEnabled and the hover widget', {timeout: 60_000}, () => {
    test('off detaches the hover widget; on attaches it to the hovered object again', () => {
        const plugin = new tp.PickingPlugin()
        const hover = {attach: vi.fn(), detach: vi.fn()}
        const hovered = new tp.Mesh()
        ;(plugin as any)._hoverWidget = hover
        ;(plugin as any)._picker = {hoverObject: hovered, selectedObject: null}
        plugin.widgetEnabled = false
        expect(hover.detach).toHaveBeenCalledTimes(1)
        plugin.widgetEnabled = true
        expect(hover.attach).toHaveBeenCalledWith(hovered)
    })
})
