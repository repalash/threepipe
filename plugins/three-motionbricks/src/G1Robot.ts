import {BufferAttribute, BufferGeometry, Color, Group, Material, Mesh, MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, Vector3} from 'three'
import {G1_JOINT_NAMES, ROOT_SIZE} from './MotionBricksG1'

interface RobotJoint {
    node: Object3D
    rest: Quaternion
    axis: Vector3
}

/** Dark joint housings, or the light shells. */
export type G1RobotPart = 'joint' | 'shell'

export interface G1RobotOptions {
    /**
     * Make the material for a part. Called once per part, and the material is shared by its meshes.
     * The default is a MeshStandardMaterial: dark joint housings and light satin shells.
     */
    material?: (part: G1RobotPart, color: Color) => Material
    /** Cast and receive shadows. Default true. */
    shadows?: boolean
    onProgress?: (loaded: number, total: number) => void
}

const tempQuat = new Quaternion()

/** Parse a binary or ASCII STL file into a non-indexed geometry with flat normals. */
export function parseSTL(data: ArrayBuffer): BufferGeometry {
    const view = new DataView(data)
    const count = data.byteLength >= 84 ? view.getUint32(80, true) : 0
    let positions: Float32Array
    if (data.byteLength === 84 + count * 50) {
        positions = new Float32Array(count * 9)
        for (let i = 0; i < count; i++) {
            for (let k = 0; k < 9; k++) positions[i * 9 + k] = view.getFloat32(84 + i * 50 + 12 + k * 4, true)
        }
    } else {
        const text = new TextDecoder().decode(data)
        const values = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => [+m[1], +m[2], +m[3]])
        positions = new Float32Array(values)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    return geometry
}

function defaultMaterial(part: G1RobotPart, color: Color) {
    return new MeshStandardMaterial({
        name: part === 'joint' ? 'Joint housings' : 'Shells',
        color,
        metalness: part === 'joint' ? 0.2 : 0.3,
        roughness: part === 'joint' ? 0.5 : 0.38,
    })
}

/**
 * The Unitree G1 built from its MuJoCo description (MJCF) and STL meshes.
 * Bodies keep MuJoCo's Z-up space inside `object`, which is turned to three.js's Y-up.
 */
export class G1Robot {
    /** Add this to a scene. */
    readonly object = new Group()
    readonly pelvis: Object3D
    readonly joints: RobotJoint[]
    /** The joint housing and shell materials, shared by every mesh. */
    readonly materials: Material[]

    private constructor(pelvis: Object3D, joints: RobotJoint[], materials: Material[]) {
        this.object.name = 'Unitree G1'
        this.object.rotation.x = -Math.PI / 2
        this.object.add(pelvis)
        this.pelvis = pelvis
        this.joints = joints
        this.materials = materials
    }

    /**
     * Load the robot from an MJCF file. Meshes resolve against its compiler meshdir.
     */
    static async Load(xmlUrl: string, options: G1RobotOptions = {}) {
        const base = new URL(xmlUrl, typeof location !== 'undefined' ? location.href : undefined)
        const res = await fetch(base.href)
        if (!res.ok) throw new Error(`Could not load the robot ${xmlUrl}: HTTP ${res.status}`)
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml')
        const meshDir = new URL((xml.querySelector('compiler')?.getAttribute('meshdir') ?? '.') + '/', base)
        const files: Record<string, string> = {}
        xml.querySelectorAll('asset > mesh').forEach(m => files[m.getAttribute('name')!] = m.getAttribute('file')!)

        const names = Object.keys(files)
        let loaded = 0
        const geometries = Object.fromEntries(await Promise.all(names.map(async name => {
            const r = await fetch(new URL(files[name], meshDir).href)
            if (!r.ok) throw new Error(`Could not load mesh ${files[name]}: HTTP ${r.status}`)
            const geometry = parseSTL(await r.arrayBuffer())
            options.onProgress?.(++loaded, names.length)
            return [name, geometry] as const
        })))

        // MJCF colors are sRGB: 0.2 for the dark joint housings, 0.7 for the shells. The shells get a light satin
        // finish, so they read as the real robot under any lighting, bright or dark.
        const make = options.material ?? defaultMaterial
        const materials = {
            joint: make('joint', new Color().setRGB(0.12, 0.12, 0.13, SRGBColorSpace)),
            shell: make('shell', new Color().setRGB(0.8, 0.81, 0.83, SRGBColorSpace)),
        }
        const shadows = options.shadows ?? true
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
                    const rgba = nums(child.getAttribute('rgba'), '0.7 0.7 0.7 1')
                    const mesh = new Mesh(geometries[child.getAttribute('mesh')!], rgba[0] < 0.5 ? materials.joint : materials.shell)
                    mesh.position.fromArray(nums(child.getAttribute('pos'), '0 0 0'))
                    mesh.castShadow = shadows
                    mesh.receiveShadow = shadows
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
        return new G1Robot(pelvis, joints, [materials.joint, materials.shell])
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
