import {describe, expect, test} from 'vitest'
import {AnimationClip, EventDispatcher, NumberKeyframeTrack, Object3D} from 'three'
import {GLTFAnimationPlugin} from './GLTFAnimationPlugin'

// the parts of a viewer the scene update uses: the model root
function fakeViewer(modelRoot: Object3D) {
    const v = new EventDispatcher<any>() as any
    v.scene = new EventDispatcher<any>()
    v.scene.modelRoot = modelRoot
    return v
}

const clip = (name: string) => new AnimationClip(name, 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])])

describe('GLTFAnimationPlugin scene update', () => {
    test('scene updates with the same clips add the animation once and do not refresh the UI', () => {
        const root = new Object3D()
        root.animations = [clip('a'), clip('b')]
        const plugin = new GLTFAnimationPlugin() as any
        plugin._viewer = fakeViewer(root)
        let refreshes = 0
        plugin.uiConfig.uiRefresh = () => refreshes++

        plugin._sceneUpdate({})
        expect(plugin.animations.length).toBe(1)
        expect(plugin.animations[0].actions.length).toBe(2)
        expect(refreshes).toBe(1)

        // an object move sends a scene update each frame
        for (let i = 0; i < 5; i++) plugin._sceneUpdate({})
        expect(plugin.animations.length).toBe(1)
        expect(refreshes).toBe(1)
    })

    test('a clip added later is picked up, with the same actions for the old clips', () => {
        const root = new Object3D()
        root.animations = [clip('a')]
        const plugin = new GLTFAnimationPlugin() as any
        plugin._viewer = fakeViewer(root)
        plugin._sceneUpdate({})
        const first = plugin.animations[0].actions[0]

        root.animations.push(clip('b'))
        plugin._sceneUpdate({})
        expect(plugin.animations.length).toBe(1)
        expect(plugin.animations[0].actions.length).toBe(2)
        expect(plugin.animations[0].actions[0]).toBe(first)
    })
})

describe('GLTFAnimationPlugin converge-mode recording', () => {
    test('the recording step keeps the animation speed', () => {
        const root = new Object3D()
        root.animations = [clip('a')]
        const plugin = new GLTFAnimationPlugin() as any
        const viewer = fakeViewer(root)
        // a converge-mode recording at 30 fps: each frame steps 1/30 s
        const progressive = {postFrameConvergedRecordingDelta: () => 1 / 30}
        viewer.getPlugin = (t: string) => t === 'Progressive' ? progressive : undefined
        viewer.renderManager = {resetShadows: () => undefined}
        viewer.setDirty = () => undefined
        plugin._viewer = viewer
        Object.defineProperty(plugin, 'pageScrollTime', {get: () => 0}) // reads the page, which the node setup has not
        plugin._sceneUpdate({})
        plugin._animationState = 'playing'
        plugin.animationSpeed = 2
        plugin._postFrame()
        expect(plugin._animationTime).toBeCloseTo(2 / 30)
    })
})
