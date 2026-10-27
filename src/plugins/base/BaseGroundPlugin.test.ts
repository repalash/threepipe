import {describe, expect, test} from 'vitest'
import {EventDispatcher} from 'three'
import {ContactShadowGroundPlugin} from '../extras/ContactShadowGroundPlugin'

// a main camera with orbit-like controls
const camera = (maxPolarAngle = Math.PI, userData: any = {}) => ({controls: {maxPolarAngle}, userData}) as any

function setup() {
    const ground = new ContactShadowGroundPlugin() as any
    const scene = new EventDispatcher<any>() as any
    scene.mainCamera = camera()
    ground._viewer = {scene}
    return {ground, scene}
}

describe('BaseGroundPlugin limitCameraAboveGround', () => {
    test('the limit moves to the new main camera, and the last one gets its own limit back', () => {
        const {ground, scene} = setup()
        const a = scene.mainCamera
        ground.limitCameraAboveGround = true
        expect(a.controls.maxPolarAngle).toBeCloseTo(Math.PI / 2)

        const b = camera(2.5)
        scene.mainCamera = b
        ground._refreshCameraLimits() // the plugin listens to mainCameraChange
        expect(b.controls.maxPolarAngle).toBeCloseTo(Math.PI / 2)
        expect(a.controls.maxPolarAngle).toBeCloseTo(Math.PI)

        ground.limitCameraAboveGround = false
        expect(b.controls.maxPolarAngle).toBeCloseTo(2.5)
    })

    test('a camera with userData.disableGroundLimit keeps its own limit', () => {
        const {ground, scene} = setup()
        ground.limitCameraAboveGround = true
        const editor = camera(Math.PI, {disableGroundLimit: true})
        scene.mainCamera = editor
        ground._refreshCameraLimits()
        expect(editor.controls.maxPolarAngle).toBeCloseTo(Math.PI)
    })
})
