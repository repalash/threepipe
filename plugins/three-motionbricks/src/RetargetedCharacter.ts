import {Euler, Group, Material, Mesh, Object3D, Quaternion, Vector3} from 'three'
import {G1_BODY_TREE} from './G1Kinematics'
import {G1Robot} from './G1Robot'
import {G1_JOINT_NAMES, POSE_SIZE} from './MotionBricksG1'

/** The body parts a rig maps, each driven by one G1 body. */
export const G1_PARTS = {
    pelvis: 'pelvis',
    torso: 'torso_link',
    leftThigh: 'left_hip_yaw_link',
    leftShin: 'left_knee_link',
    leftFoot: 'left_ankle_roll_link',
    rightThigh: 'right_hip_yaw_link',
    rightShin: 'right_knee_link',
    rightFoot: 'right_ankle_roll_link',
    leftUpperArm: 'left_shoulder_yaw_link',
    leftForearm: 'left_elbow_link',
    leftHand: 'left_wrist_yaw_link',
    rightUpperArm: 'right_shoulder_yaw_link',
    rightForearm: 'right_elbow_link',
    rightHand: 'right_wrist_yaw_link',
} as const

export type G1Part = keyof typeof G1_PARTS

/**
 * How a model's nodes follow the G1. The G1's reference is standing straight with the arms hanging; `rest`
 * turns the model's own rest pose (a T-pose, say) into that.
 */
export interface CharacterRig {
    label: string
    /** The node driven by each part, by name. Unmapped nodes keep their rest rotation and follow their parent. */
    bones: Partial<Record<G1Part, string>>
    /** The node that moves the whole body; by default the pelvis node. */
    root?: string
    /** The direction the model faces as authored, so it is turned to face +X like the G1. */
    forward: '+x' | '-x' | '+z' | '-z'
    /** Turns of nodes, in the model's own axes, that bring its rest pose to the reference: name to Euler XYZ radians. */
    rest?: Record<string, [number, number, number]>
    /** Nodes that keep to another node's position, such as feet driven by IK in the original rig. */
    attach?: Record<string, string>
    /** Point the limbs like the G1's before taking the rest pose (default true); `rest` turns come first. */
    autoRest?: boolean
    /** A node at the far end of a part, where the next mapped part is missing or does not start there (IK feet). */
    ends?: Partial<Record<G1Part, string>>
}

/** Limb segments, from a part to the part at its far end, that autoRest points like the G1's. */
const LIMB_SEGMENTS: [G1Part, G1Part][] = [
    ['leftThigh', 'leftShin'], ['leftShin', 'leftFoot'], ['rightThigh', 'rightShin'], ['rightShin', 'rightFoot'],
    ['leftUpperArm', 'leftForearm'], ['leftForearm', 'leftHand'], ['rightUpperArm', 'rightForearm'], ['rightForearm', 'rightHand'],
]

const MIXAMO = (prefix: string): CharacterRig['bones'] => ({
    pelvis: `${prefix}Hips`,
    torso: `${prefix}Spine1`,
    leftThigh: `${prefix}LeftUpLeg`, leftShin: `${prefix}LeftLeg`, leftFoot: `${prefix}LeftFoot`,
    rightThigh: `${prefix}RightUpLeg`, rightShin: `${prefix}RightLeg`, rightFoot: `${prefix}RightFoot`,
    leftUpperArm: `${prefix}LeftArm`, leftForearm: `${prefix}LeftForeArm`, leftHand: `${prefix}LeftHand`,
    rightUpperArm: `${prefix}RightArm`, rightForearm: `${prefix}RightForeArm`, rightHand: `${prefix}RightHand`,
})

/** Rigs for the models in assets/, and for any character with a Mixamo skeleton. */
export const CHARACTER_RIGS = {
    /** Mixamo skeletons in a T-pose facing -Z, such as Polygonal Mind's 100 Avatars (VRM 0). */
    mixamo: {
        label: 'Mixamo skeleton',
        bones: MIXAMO('mixamorig:'),
        forward: '-z',
    },
    /** The same, facing +Z, as Mixamo exports to glTF. */
    mixamoPlusZ: {
        label: 'Mixamo skeleton (+Z)',
        bones: MIXAMO('mixamorig'),
        forward: '+z',
    },
    /** Tomás Laulhé's RobotExpressive (Quaternius, CC0), from the three.js examples. */
    robotExpressive: {
        label: 'RobotExpressive',
        bones: {
            pelvis: 'Hips', torso: 'Abdomen',
            leftThigh: 'UpperLeg.L', leftShin: 'LowerLeg.L', leftFoot: 'Foot.L',
            rightThigh: 'UpperLeg.R', rightShin: 'LowerLeg.R', rightFoot: 'Foot.R',
            leftUpperArm: 'UpperArm.L', leftForearm: 'LowerArm.L',
            rightUpperArm: 'UpperArm.R', rightForearm: 'LowerArm.R',
        },
        root: 'Body',
        forward: '+z',
        // Its feet are IK targets under the root: they follow the shins' ends, which also mark the ankles.
        attach: {'Foot.L': 'LowerLeg.L_end', 'Foot.R': 'LowerLeg.R_end'},
        ends: {leftShin: 'LowerLeg.L_end', rightShin: 'LowerLeg.R_end', leftForearm: 'Palm2.L', rightForearm: 'Palm2.R'},
    },
    unitreeH1: {
        label: 'Unitree H1',
        bones: {
            pelvis: 'pelvis', torso: 'torso_link',
            leftThigh: 'left_hip_pitch_link', leftShin: 'left_knee_link', leftFoot: 'left_ankle_link',
            rightThigh: 'right_hip_pitch_link', rightShin: 'right_knee_link', rightFoot: 'right_ankle_link',
            leftUpperArm: 'left_shoulder_yaw_link', leftForearm: 'left_elbow_link',
            rightUpperArm: 'right_shoulder_yaw_link', rightForearm: 'right_elbow_link',
        },
        forward: '+x',
        // Like the G1, its zero pose has the forearms forward; it has no hand bodies to point them by.
        rest: {left_elbow_link: [0, 0, -Math.PI / 2], right_elbow_link: [0, 0, -Math.PI / 2]},
    },
    boosterT1: {
        label: 'Booster T1',
        bones: {
            pelvis: 'Waist', torso: 'Trunk',
            leftThigh: 'Hip_Yaw_Left', leftShin: 'Shank_Left', leftFoot: 'left_foot_link',
            rightThigh: 'Hip_Yaw_Right', rightShin: 'Shank_Right', rightFoot: 'right_foot_link',
            leftUpperArm: 'AL2', leftForearm: 'AL3', leftHand: 'left_hand_link',
            rightUpperArm: 'AR2', rightForearm: 'AR3', rightHand: 'right_hand_link',
        },
        root: 'Trunk',
        forward: '+x',
    },
    robotisOP3: {
        label: 'Robotis OP3',
        bones: {
            pelvis: 'body_link',
            leftThigh: 'l_hip_pitch_link', leftShin: 'l_knee_link', leftFoot: 'l_ank_roll_link',
            rightThigh: 'r_hip_pitch_link', rightShin: 'r_knee_link', rightFoot: 'r_ank_roll_link',
            leftUpperArm: 'l_sho_roll_link', leftForearm: 'l_el_link',
            rightUpperArm: 'r_sho_roll_link', rightForearm: 'r_el_link',
        },
        forward: '+x',
    },
} satisfies Record<string, CharacterRig>

/** The G1's reference: standing straight, arms hanging, forearms down (its zero pose has them forward). */
function referencePose() {
    const p = new Float32Array(POSE_SIZE)
    p[2] = G1_BODY_TREE[0][2][2]
    p[6] = 1
    p[7 + G1_JOINT_NAMES.indexOf('left_elbow_joint')] = Math.PI / 2
    p[7 + G1_JOINT_NAMES.indexOf('right_elbow_joint')] = Math.PI / 2
    return p
}

/** A G1 skeleton without meshes, in three.js space, for retargeting. */
function g1Skeleton() {
    const root = new Group()
    root.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
    const nodes: Record<string, Object3D> = {}
    for (const [name, parent, position, quaternion] of G1_BODY_TREE) {
        const node = new Object3D()
        node.name = name
        node.position.set(...position)
        node.quaternion.set(...quaternion)
        ;(parent ? nodes[parent] : root).add(node)
        nodes[name] = node
    }
    return {root, robot: G1Robot.FromObject(root, {shadows: false})}
}

/** Node names as three.js loaders store them: GLTFLoader drops `[ ] . : /` and turns spaces into underscores. */
function sanitize(name: string) {
    return name.replace(/\s/g, '_').replace(/[\[\].:/]/g, '')
}

const tq = new Quaternion(), tq2 = new Quaternion(), tv = new Vector3(), tv2 = new Vector3()

function depth(o: Object3D) {
    let n = 0
    for (let p = o.parent; p; p = p.parent) n++
    return n
}

/**
 * Plays G1 poses on another model: a robot with different proportions, or a skinned character. Each mapped node
 * takes the world rotation its G1 part has turned through since the reference pose; the root moves with the
 * G1's pelvis. `setPose` takes the same 36 joint coordinates as G1Robot.
 */
export class RetargetedCharacter {
    /** Holds the model: add this to the scene, or to MotionBricksCharacter.object. */
    readonly object = new Group()
    readonly model: Object3D
    readonly rig: CharacterRig
    readonly materials: Material[]
    /** The model's scale, so its legs are as long as the G1's and its steps land. */
    readonly scale: number
    private _g1 = g1Skeleton()
    private _parts: {node: Object3D, g1: Object3D, g1Rest: Quaternion, rest: Quaternion}[] = []
    private _root: Object3D
    private _pelvis: Object3D
    private _g1Pelvis: Object3D
    private _pelvisRest = new Vector3()
    private _g1PelvisRest = new Vector3()
    private _attach: [Object3D, Object3D][] = []

    /**
     * @param model the loaded model, such as `gltf.scene`
     * @param rig one of CHARACTER_RIGS, or your own mapping
     * @param matchSize scale the model so its legs match the G1's (default true); otherwise its steps slide
     */
    constructor(model: Object3D, rig: CharacterRig, {shadows = true, matchSize = true} = {}) {
        this.model = model
        this.rig = rig
        // Exact names first, then as a loader stores them, then without a namespace prefix (`mixamorig:`).
        const lookup = (name: string) => {
            let node = model.getObjectByName(name)
            const wanted = sanitize(name), bare = sanitize(name.replace(/^[^:]*:/, ''))
            if (!node) model.traverse(o => { if (!node && sanitize(o.name) === wanted) node = o })
            if (!node) model.traverse(o => { if (!node && sanitize(o.name) === bare) node = o })
            return node
        }
        const find = (name: string) => {
            const node = lookup(name)
            if (!node) throw new Error(`The ${rig.label} model has no node named ${name}`)
            return node
        }
        const holder = new Group()
        holder.add(model)
        this.object.add(holder)

        // The model's rest pose, turned to the reference in its own axes.
        model.updateMatrixWorld(true)
        for (const [name, euler] of Object.entries(rig.rest ?? {})) {
            const node = find(name)
            const turn = tq.setFromEuler(new Euler(...euler))
            const world = node.getWorldQuaternion(tq2).premultiply(turn)
            node.quaternion.copy(node.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world))
            node.updateMatrixWorld(true)
        }

        // Face +X, like the G1.
        const yaw = {'+x': 0, '-x': Math.PI, '+z': Math.PI / 2, '-z': -Math.PI / 2}[rig.forward]
        holder.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw)
        this.object.updateMatrixWorld(true)

        const g1 = this._g1
        g1.robot.setPose(referencePose())
        g1.root.updateMatrixWorld(true)
        const g1Part = (part: G1Part) => g1.root.getObjectByName(G1_PARTS[part])!
        const bones = rig.bones as Record<G1Part, string | undefined>
        // Parts the model has; hands, feet and the torso may be missing.
        const nodes: Partial<Record<G1Part, Object3D>> = {}
        for (const part of Object.keys(G1_PARTS) as G1Part[]) {
            const name = bones[part]
            if (!name) continue
            const node = lookup(name)
            if (node) nodes[part] = node
            else if (/pelvis|Thigh|Shin/.test(part)) throw new Error(`The ${rig.label} model has no node named ${name}`)
        }

        // Point each limb segment the way the G1's points in the reference, so T-poses, A-poses and robot zero
        // poses all start from the same stance. Only the direction matters: the motion is copied as world turns.
        if (rig.autoRest !== false) {
            for (const [part, child] of LIMB_SEGMENTS) {
                const node = nodes[part], endName = rig.ends?.[part]
                const end = endName ? find(endName) : nodes[child]
                if (!node || !end) continue
                const want = g1Part(child).getWorldPosition(tv).sub(g1Part(part).getWorldPosition(tv2)).normalize()
                const have = this._localPosition(end, new Vector3()).sub(this._localPosition(node, new Vector3())).normalize()
                const turn = new Quaternion().setFromUnitVectors(have, want)
                const desired = this._localQuaternion(node, new Quaternion()).premultiply(turn)
                const parentRotation = this._localQuaternion(node.parent!, new Quaternion())
                node.quaternion.copy(parentRotation.invert().multiply(desired))
                node.updateMatrixWorld(true)
            }
        }

        const legLength = (a: Object3D, b: Object3D) => a.getWorldPosition(tv).distanceTo(b.getWorldPosition(tv2))
        let scale = 1
        // Hip to ankle: the shin's end node, or the foot.
        const ankle = rig.ends?.leftShin ? find(rig.ends.leftShin) : nodes.leftFoot
        if (matchSize && nodes.leftThigh && ankle) {
            const g1Leg = legLength(g1Part('leftThigh'), g1Part('leftFoot'))
            scale = g1Leg / Math.max(1e-6, legLength(nodes.leftThigh, ankle))
            holder.scale.setScalar(scale)
            this.object.updateMatrixWorld(true)
        }
        this.scale = scale

        for (const part of Object.keys(nodes) as G1Part[]) {
            const node = nodes[part]!
            const g1Node = g1Part(part)
            this._parts.push({node, g1: g1Node, g1Rest: g1Node.getWorldQuaternion(new Quaternion()), rest: this._localQuaternion(node, new Quaternion())})
        }
        // Parents first, so each node turns from its parent's new rotation.
        this._parts.sort((a, b) => depth(a.node) - depth(b.node))
        this._pelvis = nodes.pelvis!
        this._root = rig.root ? find(rig.root) : this._pelvis
        this._g1Pelvis = g1.root.getObjectByName('pelvis')!
        this._localPosition(this._pelvis, this._pelvisRest)
        this._g1Pelvis.getWorldPosition(this._g1PelvisRest)
        for (const [name, target] of Object.entries(rig.attach ?? {})) this._attach.push([find(name), find(target)])

        const materials = new Set<Material>()
        model.traverse(o => {
            const mesh = o as Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = mesh.receiveShadow = shadows
            // Skinned meshes move far from their bind-pose bounds.
            mesh.frustumCulled = false
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
        })
        this.materials = [...materials]
    }

    /** A node's rotation in the space of `object`. */
    private _localQuaternion(node: Object3D, target: Quaternion) {
        return node.getWorldQuaternion(target).premultiply(this.object.getWorldQuaternion(tq2).invert())
    }

    private _localPosition(node: Object3D, target: Vector3) {
        return this.object.worldToLocal(node.getWorldPosition(target))
    }

    /** Show a G1 pose: root XYZ, root XYZW quaternion, then the 29 joint angles. */
    setPose(pose: ArrayLike<number>) {
        const g1 = this._g1
        g1.robot.setPose(pose)
        g1.root.updateMatrixWorld(true)
        const objectRotation = this.object.getWorldQuaternion(new Quaternion())
        for (const part of this._parts) {
            // The G1 part's turn since the reference, applied to the node's rest rotation, in the space of `object`.
            const turn = part.g1.getWorldQuaternion(tq).multiply(tq2.copy(part.g1Rest).invert())
            const desired = turn.multiply(part.rest)
            const parentRotation = part.node.parent!.getWorldQuaternion(tq2).premultiply(objectRotation.clone().invert())
            part.node.quaternion.copy(parentRotation.invert().multiply(desired))
            part.node.updateMatrixWorld(true)
        }
        // Move the root so the pelvis follows the G1's: along the ground as it goes, up and down as it bobs.
        const g1Pelvis = this._g1Pelvis.getWorldPosition(tv)
        const desired = tv2.set(g1Pelvis.x, this._pelvisRest.y + (g1Pelvis.y - this._g1PelvisRest.y), g1Pelvis.z)
        const current = this._localPosition(this._pelvis, new Vector3())
        const shift = desired.sub(current)
        const root = this._root
        const parent = root.parent!
        // The shift is in the space of `object`; turn it into the root's parent space.
        const a = this.object.localToWorld(new Vector3()), b = this.object.localToWorld(shift.clone())
        const local = parent.worldToLocal(b).sub(parent.worldToLocal(a))
        root.position.add(local)
        root.updateMatrixWorld(true)
        for (const [node, target] of this._attach) {
            node.position.copy(node.parent!.worldToLocal(target.getWorldPosition(tv)))
            node.updateMatrixWorld(true)
        }
    }
}
