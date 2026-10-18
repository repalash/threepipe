/**
 * `userData.excludeFromExport` leaves an object (and its subtree) out of a glTF export (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {AnimationClip, NumberKeyframeTrack, Object3D, VectorKeyframeTrack} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

function exportJson(root: Object3D | Object3D[], animations?: AnimationClip[]): Promise<any> {
    return new Promise((resolve, reject) => {
        new tp.GLTFExporter2().parse(root, resolve as never, reject as never, {exportExt: 'gltf', animations})
    })
}

function tree() {
    const root = new Object3D()
    root.name = 'root'
    const keep = new Object3D()
    keep.name = 'keep'
    const hidden = new Object3D()
    hidden.name = 'hidden'
    hidden.visible = false
    const helper = new Object3D()
    helper.name = 'helper'
    helper.userData.excludeFromExport = true
    const helperChild = new Object3D()
    helperChild.name = 'helper-child'
    helper.add(helperChild)
    root.add(keep, hidden, helper)
    return {root, helper}
}

describe('GLTFWriter2 and excludeFromExport', () => {
    it('leaves out a marked object and its subtree, and keeps invisible ones', async() => {
        const {root} = tree()
        const json = await exportJson(root)
        const names = json.nodes.map((n: any) => n.name)
        expect(names).toContain('keep')
        expect(names).toContain('hidden')
        expect(names).not.toContain('helper')
        expect(names).not.toContain('helper-child')
    })

    it('still writes a marked object that is itself what was asked for', async() => {
        const {helper} = tree()
        const json = await exportJson(helper)
        expect(json.nodes.map((n: any) => n.name)).toEqual(expect.arrayContaining(['helper', 'helper-child']))
    })

    it('drops animation tracks that target a left-out object, and clips left with none', async() => {
        const {root} = tree()
        const mixed = new AnimationClip('mixed', 1, [
            new VectorKeyframeTrack('keep.position', [0, 1], [0, 0, 0, 1, 0, 0]),
            new VectorKeyframeTrack('helper.position', [0, 1], [0, 0, 0, 0, 1, 0]),
            new NumberKeyframeTrack('helper-child.visible', [0, 1], [1, 0]),
        ])
        mixed.userData.note = 'kept'
        const onlyHelper = new AnimationClip('only-helper', 1, [
            new VectorKeyframeTrack('helper-child.scale', [0, 1], [1, 1, 1, 2, 2, 2]),
        ])
        const json = await exportJson(root, [mixed, onlyHelper])
        expect(json.animations).toHaveLength(1)
        const anim = json.animations[0]
        expect(anim.name).toBe('mixed')
        expect(anim.extras?.note).toBe('kept')
        expect(anim.channels).toHaveLength(1)
        expect(json.nodes[anim.channels[0].target.node].name).toBe('keep')
        for (const c of anim.channels) expect(c.target.node).toBeTypeOf('number')
    })
})
