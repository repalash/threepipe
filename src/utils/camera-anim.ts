import {Quaternion, Spherical, Vector3} from 'three'
import {worldToLocalQuaternion} from '../three/utils'
import {CameraView, ICamera, ICameraView} from '../core'
import {AnimationOptions} from '@repalash/popmotion'
import {lerp, lerpAngle} from './animation'

export function sphericalFromCameraView(view: Pick<CameraView, 'position'|'target'>): Spherical {
    const pos = view.position.clone()
    pos.sub(view.target)
    const spherical = new Spherical().setFromVector3(pos)
    spherical.makeSafe() // todo: is it needed?
    return spherical
}

export function animateCameraToViewSpherical(camera: ICamera, view: ICameraView): AnimationOptions<number> {
    // similar to orbit controls
    const parent = camera.parent

    const target = camera.target.clone()
    const position = camera.getWorldPosition(new Vector3())
    const init = {
        position, target, zoom: camera.zoom,
        spherical: sphericalFromCameraView({position, target}),
    }
    const current = {
        position: new Vector3(),
        target: new Vector3(),
        zoom: 1,
        spherical: new Spherical(),
    }
    const final = {
        position: view.position,
        target: view.target,
        zoom: view.zoom,
        spherical: sphericalFromCameraView(view),
    }

    function setter() {
        camera.position.copy(parent ? parent.worldToLocal(current.position) : current.position)
        camera.target.copy(current.target) // always in world space
        camera.zoom = current.zoom
        // lookAt in setDirty updates the quaternion
        camera.setDirty() // because it has min change distance in setter
    }

    return {
        from: 0,
        to: 1,
        onUpdate: (v) => {
            current.spherical.phi = lerpAngle(init.spherical.phi, final.spherical.phi, v)
            current.spherical.theta = lerpAngle(init.spherical.theta, final.spherical.theta, v)
            current.spherical.radius = lerp(init.spherical.radius, final.spherical.radius, v)
            current.target.copy(init.target).lerp(final.target, v)
            current.position.setFromSpherical(current.spherical)
            current.position.add(current.target)
            current.zoom = lerp(init.zoom, final.zoom, v)
            setter()
        },
        onComplete: () => {
            current.position.copy(final.position)
            current.target.copy(final.target)
            current.zoom = final.zoom
            setter()
        },
        onStop: () => {
            throw new Error('Animation Stopped')
        },
    }
}

export function animateCameraToViewLinear(camera: ICamera, view: ICameraView): AnimationOptions<number> {
    // similar to orbit controls
    // so camera.up is the orbit axis
    const parent = camera.parent

    const target = camera.target.clone()
    const position = camera.getWorldPosition(new Vector3())
    const quaternion = camera.getWorldQuaternion(new Quaternion())
    const init = {
        position, target, quaternion, zoom: camera.zoom,
    }
    const current = {
        position: new Vector3(),
        target: new Vector3(),
        quaternion: new Quaternion(),
        zoom: 1,
    }
    const final = view

    function setter() {
        camera.position.copy(parent ? parent.worldToLocal(current.position) : current.position)
        camera.target.copy(current.target) // always in world space
        camera.quaternion.copy(parent ? worldToLocalQuaternion(parent, current.quaternion, camera.quaternion) : current.quaternion)
        camera.zoom = current.zoom
        camera.setDirty() // because it has min change distance in setter
    }

    return {
        from: 0,
        to: 1,
        onUpdate: (v) => {
            current.position.lerpVectors(init.position, final.position, v)
            current.target.lerpVectors(init.target, final.target, v)
            current.quaternion.slerpQuaternions(init.quaternion, final.quaternion, v)
            current.zoom = lerp(init.zoom, final.zoom, v)
            setter()
        },
        onComplete: () => {
            current.position.copy(final.position)
            current.target.copy(final.target)
            current.quaternion.copy(final.quaternion)
            current.zoom = final.zoom
            setter()
        },
        onStop: () => {
            throw new Error('Animation Stopped')
        },
    }
}

