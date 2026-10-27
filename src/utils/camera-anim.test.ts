import {describe, expect, test} from 'vitest'
import {PerspectiveCamera, Vector3} from 'three'
import {animateCameraToViewLinear, animateCameraToViewSpherical} from './camera-anim'

// a camera with what the animation uses: a world space target and setDirty (no controls, autoLookAtTarget off)
function camera(position: Vector3, target: Vector3) {
    const cam = new PerspectiveCamera() as any
    cam.target = target.clone()
    cam.userData.autoLookAtTarget = false
    cam.setDirty = () => undefined
    cam.position.copy(position)
    cam.lookAt(target)
    cam.updateMatrixWorld()
    return cam
}

/** The angle between where the camera looks and where its target is */
function aimError(cam: any) {
    cam.updateMatrixWorld()
    const look = cam.getWorldDirection(new Vector3())
    const toTarget = cam.target.clone().sub(cam.getWorldPosition(new Vector3())).normalize()
    return look.angleTo(toTarget)
}

describe('camera animations face the target in every frame', () => {
    test('spherical: a quarter orbit looks at the target half way, not only at the end', () => {
        const cam = camera(new Vector3(0, 0, 5), new Vector3(0, 0, 0))
        const anim = animateCameraToViewSpherical(cam, {position: new Vector3(5, 0, 0), target: new Vector3(0, 0, 0), zoom: 1} as any)
        anim.onUpdate!(0.5)
        expect(cam.position.x).toBeGreaterThan(1) // it moved along the orbit
        expect(aimError(cam)).toBeLessThan(1e-4)
        anim.onComplete!()
        expect(cam.position.distanceTo(new Vector3(5, 0, 0))).toBeLessThan(1e-6)
        expect(aimError(cam)).toBeLessThan(1e-4)
    })

    test('spherical: a moving target is followed', () => {
        const cam = camera(new Vector3(0, 1, 5), new Vector3(0, 0, 0))
        const anim = animateCameraToViewSpherical(cam, {position: new Vector3(4, 1, 2), target: new Vector3(2, 0.5, -1), zoom: 1} as any)
        for (const t of [0.25, 0.5, 0.75]) {
            anim.onUpdate!(t)
            expect(aimError(cam)).toBeLessThan(1e-4)
        }
    })

    test('linear sets the orientation itself (unchanged)', () => {
        const cam = camera(new Vector3(0, 0, 5), new Vector3(0, 0, 0))
        const end = camera(new Vector3(5, 0, 0), new Vector3(0, 0, 0))
        const anim = animateCameraToViewLinear(cam, {position: end.position.clone(), target: end.target.clone(), quaternion: end.quaternion.clone(), zoom: 1} as any)
        anim.onComplete!()
        expect(aimError(cam)).toBeLessThan(1e-4)
    })
})
