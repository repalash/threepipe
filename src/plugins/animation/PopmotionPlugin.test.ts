import {describe, expect, test} from 'vitest'
import {EventDispatcher} from 'three'
import {PopmotionPlugin} from './PopmotionPlugin'

// the parts of a viewer the timeline driver uses: frame events and the timeline time
function fakeViewer() {
    const v = new EventDispatcher<any>() as any
    v.timeline = {time: 0}
    v.getPlugin = () => undefined
    v.getPluginByType = () => undefined
    v.addPluginSync = () => undefined
    v.setDirty = () => undefined
    v.console = console
    return v
}

describe('PopmotionPlugin timelineDriver', () => {
    test('a track added while the time stands still takes the timeline time at once', () => {
        const viewer = fakeViewer()
        const pop = new PopmotionPlugin()
        pop.onAdded(viewer)
        // a track that is already on the timeline, at 2 s
        pop.timelineDriver(() => undefined).start()
        viewer.timeline.time = 2
        viewer.dispatchEvent({type: 'preFrame'})

        // a track added now (AnimationObjectPlugin rebuilds its tracks after a change), with the time still at 2 s
        let t = 0
        pop.timelineDriver(dt => t += dt).start()
        viewer.dispatchEvent({type: 'preFrame'})
        expect(t).toBeCloseTo(2000)

        // a seek back to 0 moves it back
        viewer.timeline.time = 0
        viewer.dispatchEvent({type: 'preFrame'})
        expect(t).toBeCloseTo(0)
    })

    test('a track follows each seek, forward and back', () => {
        const viewer = fakeViewer()
        const pop = new PopmotionPlugin()
        pop.onAdded(viewer)
        let t = 0
        pop.timelineDriver(dt => t += dt).start()
        for (const time of [1, 3, 0.5, 2]) {
            viewer.timeline.time = time
            viewer.dispatchEvent({type: 'preFrame'})
            expect(t).toBeCloseTo(time * 1000)
        }
    })
})
