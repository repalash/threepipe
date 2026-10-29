import {Material, Mesh, Object3D, Quaternion, Vector3} from 'three'
import {ROOT_SIZE} from './MotionBricksG1'

interface RobotJoint {
    node: Object3D
    rest: Quaternion
    axis: Vector3
}

/**
 * The body each of the 29 G1 joints turns, and its axis, in G1_JOINT_NAMES order (from Unitree's MJCF).
 * A robot model needs nodes with these names, in MuJoCo's Z-up space under a `pelvis` node.
 */
export const G1_JOINT_BODIES: readonly [string, [number, number, number]][] = [
    ['left_hip_pitch_link', [0, 1, 0]], ['left_hip_roll_link', [1, 0, 0]], ['left_hip_yaw_link', [0, 0, 1]],
    ['left_knee_link', [0, 1, 0]], ['left_ankle_pitch_link', [0, 1, 0]], ['left_ankle_roll_link', [1, 0, 0]],
    ['right_hip_pitch_link', [0, 1, 0]], ['right_hip_roll_link', [1, 0, 0]], ['right_hip_yaw_link', [0, 0, 1]],
    ['right_knee_link', [0, 1, 0]], ['right_ankle_pitch_link', [0, 1, 0]], ['right_ankle_roll_link', [1, 0, 0]],
    ['waist_yaw_link', [0, 0, 1]], ['waist_roll_link', [1, 0, 0]], ['torso_link', [0, 1, 0]],
    ['left_shoulder_pitch_link', [0, 1, 0]], ['left_shoulder_roll_link', [1, 0, 0]], ['left_shoulder_yaw_link', [0, 0, 1]],
    ['left_elbow_link', [0, 1, 0]], ['left_wrist_roll_link', [1, 0, 0]], ['left_wrist_pitch_link', [0, 1, 0]],
    ['left_wrist_yaw_link', [0, 0, 1]],
    ['right_shoulder_pitch_link', [0, 1, 0]], ['right_shoulder_roll_link', [1, 0, 0]], ['right_shoulder_yaw_link', [0, 0, 1]],
    ['right_elbow_link', [0, 1, 0]], ['right_wrist_roll_link', [1, 0, 0]], ['right_wrist_pitch_link', [0, 1, 0]],
    ['right_wrist_yaw_link', [0, 0, 1]],
]

const tempQuat = new Quaternion()

/**
 * Poses a Unitree G1 model that you loaded, such as `gltf.scene` of the unitree_g1.glb that ships with
 * this package. The model keeps MuJoCo's Z-up bodies under a node turned to three.js's Y-up.
 */
export class G1Robot {
    /** The model's root, as given. */
    readonly object: Object3D
    readonly pelvis: Object3D
    readonly joints: RobotJoint[]
    /** Every material in the model, such as the joint housings and the shells. */
    readonly materials: Material[]

    private constructor(object: Object3D, pelvis: Object3D, joints: RobotJoint[], materials: Material[]) {
        this.object = object
        this.pelvis = pelvis
        this.joints = joints
        this.materials = materials
    }

    /**
     * Wrap a loaded G1 model. Its meshes cast and receive shadows unless `shadows` is false.
     */
    static FromObject(root: Object3D, {shadows = true} = {}) {
        const find = (name: string) => {
            const node = root.getObjectByName(name)
            if (!node) throw new Error(`The robot model has no node named ${name}`)
            return node
        }
        const joints = G1_JOINT_BODIES.map(([body, axis]) => {
            const node = find(body)
            return {node, rest: node.quaternion.clone(), axis: new Vector3(...axis)}
        })
        const materials = new Set<Material>()
        root.traverse(o => {
            const mesh = o as Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = shadows
            mesh.receiveShadow = shadows
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
        })
        return new G1Robot(root, find('pelvis'), joints, [...materials])
    }

    /** Show a G1 pose: root XYZ, root XYZW quaternion, then the 29 joint angles. */
    setPose(pose: ArrayLike<number>) {
        this.pelvis.position.set(pose[0], pose[1], pose[2])
        this.pelvis.quaternion.set(pose[3], pose[4], pose[5], pose[6]).normalize()
        this.joints.forEach((j, i) => {
            j.node.quaternion.copy(j.rest).multiply(tempQuat.setFromAxisAngle(j.axis, pose[ROOT_SIZE + i]))
        })
    }

    /** Convert a ground point from three.js space (Y up) to G1 space (Z up). */
    static ToG1(p: {x: number, z: number}): [number, number] {
        return [p.x, -p.z]
    }

    /** Convert a G1 space point to three.js space. */
    static FromG1(x: number, y: number, z = 0, target = new Vector3()) {
        return target.set(x, z, -y)
    }
}
