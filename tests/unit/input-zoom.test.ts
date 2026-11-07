import {describe, expect, test} from 'vitest'
import {isIOS, preventIosInputZoom} from '../../plugins/tweakpane-editor/src/input-zoom'

// The fix of the zoom of iOS into a focused text field (plugins/tweakpane-editor/src/input-zoom.ts): a viewport meta tag
// with maximum-scale=1 on iOS only. The node setup has no DOM: a small document with a head and one meta tag.

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const nav = (userAgent: string, maxTouchPoints = 0) => ({userAgent, maxTouchPoints}) as Navigator

class FakeMeta {
    name = ''
    content = ''
    parent?: FakeHead
    remove() {
        this.parent?.children.splice(this.parent.children.indexOf(this), 1)
        this.parent = undefined
    }
}
class FakeHead {
    children: FakeMeta[] = []
    appendChild(m: FakeMeta) {
        m.parent = this
        this.children.push(m)
        return m
    }
}
const page = (content?: string) => {
    const head = new FakeHead()
    if (content !== undefined) Object.assign(head.appendChild(new FakeMeta()), {name: 'viewport', content})
    const doc = {
        head,
        createElement: () => new FakeMeta(),
        querySelector: () => head.children.find(m => m.name === 'viewport') ?? null,
    } as unknown as Document
    return {doc, head}
}

describe('preventIosInputZoom', () => {
    test('iOS: an iPhone, and an iPad that says Macintosh but has a touch screen; not a Mac, not Android', () => {
        expect(isIOS(nav(IPHONE, 5))).toBe(true)
        expect(isIOS(nav(MAC, 5))).toBe(true) // iPadOS
        expect(isIOS(nav(MAC, 0))).toBe(false)
        expect(isIOS(nav(ANDROID, 5))).toBe(false)
    })

    test('adds maximum-scale=1 to the viewport tag on iOS, keeps the rest, and puts the tag back', () => {
        const {doc, head} = page('width=device-width, initial-scale=1, maximum-scale=5')
        const undo = preventIosInputZoom(doc, nav(IPHONE, 5))
        expect(head.children[0].content).toBe('width=device-width, initial-scale=1, maximum-scale=1')
        undo()
        expect(head.children[0].content).toBe('width=device-width, initial-scale=1, maximum-scale=5')
    })

    test('a page without a viewport tag gets one with only maximum-scale=1 (its layout width stays), removed again', () => {
        const {doc, head} = page()
        const undo = preventIosInputZoom(doc, nav(MAC, 5))
        expect(head.children.map(m => [m.name, m.content])).toEqual([['viewport', 'maximum-scale=1']])
        undo()
        expect(head.children).toHaveLength(0)
    })

    test('other systems: nothing changes (Android would block the pinch zoom)', () => {
        for (const n of [nav(ANDROID, 5), nav(MAC, 0)]) {
            const {doc, head} = page('width=device-width, initial-scale=1')
            preventIosInputZoom(doc, n)()
            expect(head.children[0].content).toBe('width=device-width, initial-scale=1')
        }
    })
})
