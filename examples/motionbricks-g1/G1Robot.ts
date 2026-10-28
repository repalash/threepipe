import {Color, Group, Mesh, Object3D, PhysicalMaterial, Quaternion, SRGBColorSpace, STLLoader, Vector3} from 'threepipe'
import {G1_JOINT_NAMES, ROOT_SIZE} from './MotionBricksG1'

interface RobotJoint {
    node: Object3D
    rest: Quaternion
    axis: Vector3
}

const tempQuat = new Quaternion()

/**
 * The Unitree G1 built from its MuJoCo description (MJCF) and STL meshes.
 * Bodies keep MuJoCo's Z-up space inside `object`, which is turned to threepipe's Y-up.
 */
export class G1Robot {
    /** Add this to the scene. */
    readonly object = new Group()
    readonly pelvis: Object3D
    readonly joints: RobotJoint[]

    private constructor(pelvis: Object3D, joints: RobotJoint[]) {
        this.object.name = 'Unitree G1'
        this.object.rotation.x = -Math.PI / 2
        this.object.add(pelvis)
        this.pelvis = pelvis
        this.joints = joints
    }

    /**
     * Load the robot from an MJCF file. Meshes resolve against its compiler meshdir.
     */
    static async Load(xmlUrl: string, onProgress?: (loaded: number, total: number) => void) {
        const xml = new DOMParser().parseFromString(await (await fetch(xmlUrl)).text(), 'text/xml')
        const meshDir = new URL((xml.querySelector('compiler')?.getAttribute('meshdir') ?? '.') + '/', new URL(xmlUrl, location.href))
        const files: Record<string, string> = {}
        xml.querySelectorAll('asset > mesh').forEach(m => files[m.getAttribute('name')!] = m.getAttribute('file')!)

        const loader = new STLLoader()
        const names = Object.keys(files)
        let loaded = 0
        const geometries = Object.fromEntries(await Promise.all(names.map(async name => {
            const res = await fetch(new URL(files[name], meshDir).href)
            if (!res.ok) throw new Error(`Could not load mesh ${files[name]}: HTTP ${res.status}`)
            const geometry = loader.parse(await res.arrayBuffer())
            onProgress?.(++loaded, names.length)
            return [name, geometry] as const
        })))

        const materials = new Map<string, PhysicalMaterial>()
        const material = (rgba: number[]) => {
            const key = rgba.join(' ')
            if (!materials.has(key)) {
                // MJCF colors are sRGB: 0.2 for the dark joint housings, 0.7 for the shells. The shells are a
                // light satin finish, so they read as the real robot under any lighting, bright or dark.
                const dark = rgba[0] < 0.5
                materials.set(key, new PhysicalMaterial({
                    color: dark ? new Color().setRGB(0.12, 0.12, 0.13, SRGBColorSpace) : new Color().setRGB(0.8, 0.81, 0.83, SRGBColorSpace),
                    metalness: dark ? 0.2 : 0.3,
                    roughness: dark ? 0.5 : 0.38,
                }))
            }
            return materials.get(key)!
        }
        const nums = (s: string | null, d: string) => (s ?? d).trim().split(/\s+/).map(Number)
        const jointsByName: Record<string, RobotJoint> = {}

        const build = (body: Element): Object3D => {
            const node = new Group()
            node.name = body.getAttribute('name') ?? ''
            node.position.fromArray(nums(body.getAttribute('pos'), '0 0 0'))
            const [w, x, y, z] = nums(body.getAttribute('quat'), '1 0 0 0')
            node.quaternion.set(x, y, z, w)
            for (const child of Array.from(body.children)) {
                if (child.tagName === 'joint' && child.getAttribute('type') !== 'free') {
                    jointsByName[child.getAttribute('name')!] = {
                        node,
                        rest: node.quaternion.clone(),
                        axis: new Vector3().fromArray(nums(child.getAttribute('axis'), '0 0 1')),
                    }
                } else if (child.tagName === 'geom' && child.getAttribute('type') === 'mesh' && child.getAttribute('contype') === '0') {
                    // Visual geoms only; MJCF repeats each mesh as a collision geom.
                    const mesh = new Mesh(geometries[child.getAttribute('mesh')!], material(nums(child.getAttribute('rgba'), '0.7 0.7 0.7 1')))
                    mesh.position.fromArray(nums(child.getAttribute('pos'), '0 0 0'))
                    mesh.castShadow = true
                    mesh.receiveShadow = true
                    node.add(mesh)
                } else if (child.tagName === 'body') {
                    node.add(build(child))
                }
            }
            return node
        }
        const pelvis = build(xml.querySelector('worldbody > body')!)
        const joints = G1_JOINT_NAMES.map(n => {
            if (!jointsByName[n]) throw new Error(`MJCF has no joint ${n}`)
            return jointsByName[n]
        })
        return new G1Robot(pelvis, joints)
    }

    /** Show a G1 pose: root XYZ, root XYZW quaternion, then the 29 joint angles. */
    setPose(pose: ArrayLike<number>) {
        this.pelvis.position.set(pose[0], pose[1], pose[2])
        this.pelvis.quaternion.set(pose[3], pose[4], pose[5], pose[6]).normalize()
        this.joints.forEach((j, i) => {
            j.node.quaternion.copy(j.rest).multiply(tempQuat.setFromAxisAngle(j.axis, pose[ROOT_SIZE + i]))
        })
    }

    /** Convert a ground point from threepipe space (Y up) to G1 space (Z up). */
    static ToG1(p: Vector3): [number, number] {
        return [p.x, -p.z]
    }

    /** Convert a G1 space point to threepipe space. */
    static FromG1(x: number, y: number, z = 0, target = new Vector3()) {
        return target.set(x, z, -y)
    }
}
