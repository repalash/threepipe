import {BoxGeometry, CapsuleGeometry, Group, Material, Mesh, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector3} from 'three'
import {SOMA_SKELETON_INFO, SOMAPose} from './MotionBricksSOMA'

// A wooden-mannequin figure built on the SOMA skeleton: one node per joint, posed straight from SOMA poses, with
// capsules along the bones. SOMA model space is three.js space (Y up, metres), so no retargeting is needed.

const BONES: [string, string, number][] = [
    // from, to, radius
    ['Hips', 'Spine1', 0.11], ['Spine1', 'Spine2', 0.11], ['Spine2', 'Chest', 0.12], ['Chest', 'Neck1', 0.13],
    ['Neck1', 'Head', 0.045],
    ['LeftShoulder', 'LeftArm', 0.05], ['LeftArm', 'LeftForeArm', 0.048], ['LeftForeArm', 'LeftHand', 0.04],
    ['RightShoulder', 'RightArm', 0.05], ['RightArm', 'RightForeArm', 0.048], ['RightForeArm', 'RightHand', 0.04],
    ['LeftLeg', 'LeftShin', 0.07], ['LeftShin', 'LeftFoot', 0.055],
    ['RightLeg', 'RightShin', 0.07], ['RightShin', 'RightFoot', 0.055],
]

export class SOMAMannequin {
    readonly object = new Group()
    readonly joints: Object3D[]
    readonly materials: Material[]

    constructor({shadows = true, color = '#f4f2ee', accent = '#16171a'} = {}) {
        const k = SOMA_SKELETON_INFO
        const body = new MeshStandardMaterial({color, roughness: 0.55})
        const ink = new MeshStandardMaterial({color: accent, roughness: 0.45})
        this.materials = [body, ink]
        this.joints = k.names.map(name => {
            const o = new Object3D()
            o.name = name
            return o
        })
        k.parents.forEach((p, j) => (p < 0 ? this.object : this.joints[p]).add(this.joints[j]))
        this.setPose(k.referencePose())
        this.object.updateMatrixWorld(true)

        const world = (name: string) => this.joints[k.index(name)].getWorldPosition(new Vector3())
        const attach = (name: string, mesh: Mesh, at: Vector3) => {
            const joint = this.joints[k.index(name)]
            // Place in the joint's space, from a world position and an upright orientation.
            joint.worldToLocal(mesh.position.copy(at))
            mesh.quaternion.premultiply(joint.getWorldQuaternion(new Quaternion()).invert())
            joint.add(mesh)
        }
        for (const [from, to, r] of BONES) {
            const a = world(from), b = world(to), length = a.distanceTo(b)
            const mesh = new Mesh(new CapsuleGeometry(r, Math.max(0.01, length - r * 1.2), 6, 16), body)
            mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize())
            attach(from, mesh, a.clone().add(b).multiplyScalar(0.5))
        }
        // Joints as small dark balls, a head, hands and feet.
        for (const name of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftShin', 'RightShin', 'LeftLeg', 'RightLeg']) {
            attach(name, new Mesh(new SphereGeometry(name.endsWith('Leg') ? 0.075 : 0.05, 16, 12), ink), world(name))
        }
        const head = world('Head'), headTop = world('HeadEnd')
        attach('Head', new Mesh(new SphereGeometry(0.105, 24, 18).scale(0.92, 1.08, 1), body), head.clone().lerp(headTop, 0.42))
        for (const side of ['Left', 'Right']) {
            const hand = world(side + 'Hand'), tip = world(side + 'HandMiddleEnd')
            const m = new Mesh(new BoxGeometry(0.04, 0.16, 0.085), ink)
            m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tip.clone().sub(hand).normalize())
            attach(side + 'Hand', m, hand.clone().lerp(tip, 0.45))
            const ankle = world(side + 'Foot'), toe = world(side + 'ToeBase')
            const foot = new Mesh(new BoxGeometry(0.1, 0.07, 0.24), ink)
            const along = toe.clone().sub(ankle).setY(0).normalize()
            foot.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), along)
            attach(side + 'Foot', foot, ankle.clone().addScaledVector(along, 0.06).setY(0.035))
        }
        this.object.traverse(o => {
            if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = shadows
        })
    }

    /** Show a SOMA pose: local transforms of SOMA_SKELETON, the root in world space. */
    setPose(pose: SOMAPose | ArrayLike<number>) {
        this.joints.forEach((o, j) => {
            o.position.set(pose[j * 7], pose[j * 7 + 1], pose[j * 7 + 2])
            o.quaternion.set(pose[j * 7 + 3], pose[j * 7 + 4], pose[j * 7 + 5], pose[j * 7 + 6])
        })
    }
}
