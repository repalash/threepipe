/**
 * Draws a {@link GeometrySet} in a threepipe scene: real meshes as meshes and every instanced mesh as one
 * `InstancedMesh2` (the draw list of {@link flattenInstances}), point clouds as points. Display only - nothing here
 * feeds back into evaluation. Curves are not drawn yet (they are counted in `stats.curvesSkipped`): Blender draws their
 * evaluated points, which `CurvesEvaluator` (`geometry/curvesEval.ts`) computes; drawing them is not written.
 *
 * Coordinates are Blender's (Z up); put {@link root} under a parent rotated -90 degrees about X for a Y-up scene.
 */

import {
    BufferAttribute,
    BufferGeometry2,
    Color,
    Group,
    IMaterial,
    InstancedMesh2,
    Matrix4,
    Mesh2,
    PhysicalMaterial,
    Points,
    PointsMaterial,
} from 'threepipe'
import {bakeGeometry, geometryDataToBufferGeometry, MeshData} from '@threepipe/mesh-kernel'
import {flattenInstances, GeometrySet, PointCloud, SceneProvider} from '@threepipe/plugin-procedural'

/** A material's display values, as `dump_blend.py` records them (`referenced.materials`). */
export interface MaterialDisplay {
    diffuseColor?: number[]
    baseColor?: number[]
    metallic?: number
    roughness?: number
}

export interface GeometrySetRendererOptions {
    /** Resolves object and collection instance references. */
    scene?: SceneProvider
    /** Display values by material slot name. */
    materials?: Record<string, MaterialDisplay>
}

export interface RenderStats {
    /** Distinct meshes drawn (each once or instanced). */
    uniqueMeshes: number
    /** Scene objects: single meshes and instanced meshes (mirrored instances get their own). */
    meshes: number
    instancedMeshes: number
    draws: number
    pointClouds: number
    curvesSkipped: number
}

export class GeometrySetRenderer {
    readonly root = new Group()
    stats: RenderStats = {uniqueMeshes: 0, meshes: 0, instancedMeshes: 0, draws: 0, pointClouds: 0, curvesSkipped: 0}

    // Buffers by mesh; meshes no longer drawn (a previous evaluation's output) are disposed on the next update.
    private _geometries = new Map<MeshData, BufferGeometry2>()
    private readonly _materials = new Map<string, IMaterial>()
    private _owned: {dispose(): void}[] = []
    /** Buffers with reversed triangles, for mirrored instances. */
    private readonly _mirrored = new WeakMap<BufferGeometry2, BufferGeometry2>()

    constructor(readonly options: GeometrySetRendererOptions = {}) {
        this.root.name = 'GeometrySet'
    }

    /** Replace what is drawn with `geometry`. Meshes seen before (referenced objects) reuse their buffers. */
    update(geometry: GeometrySet): void {
        this._clear()
        const list = flattenInstances(geometry, this.options.scene)
        const previous = this._geometries
        this._geometries = new Map()
        for (const item of list.meshes) {
            const g = previous.get(item.component)
            if (g) this._geometries.set(item.component, g)
        }
        for (const [mesh, g] of previous) {
            if (this._geometries.has(mesh)) continue
            g.dispose()
            this._mirrored.get(g)?.dispose()
        }
        const m = new Matrix4()
        let meshes = 0, instanced = 0
        for (const item of list.meshes) {
            const material = this._slotMaterials(item.component.materials)
            if (item.count === 1) {
                // three flips the front face of a mirrored (negative determinant) mesh itself.
                const mesh = new Mesh2(this._geometry(item.component), material)
                m.fromArray(item.transforms)
                mesh.matrixAutoUpdate = false
                mesh.matrix.copy(m)
                this.root.add(mesh)
                meshes++
                continue
            }
            // Not per instance: mirrored instances (Blender draws them with their winding flipped) get a copy of the
            // buffers with reversed triangles, so their faces stay front-facing and their normals outward.
            const groups: [boolean, number[]][] = [[false, []], [true, []]]
            for (let i = 0; i < item.count; i++) groups[m.fromArray(item.transforms, i * 16).determinant() < 0 ? 1 : 0][1].push(i)
            for (const [mirrored, indices] of groups) {
                if (!indices.length) continue
                const mesh = new InstancedMesh2(this._geometry(item.component, mirrored), material, indices.length)
                indices.forEach((k, i) => mesh.setMatrixAt(i, m.fromArray(item.transforms, k * 16)))
                mesh.instanceMatrix.needsUpdate = true
                mesh.computeBoundingSphere()
                this.root.add(mesh)
                instanced++
            }
        }
        for (const item of list.pointClouds) {
            for (let i = 0; i < item.count; i++) this.root.add(this._points(item.component, m.fromArray(item.transforms, i * 16)))
        }
        this.stats = {uniqueMeshes: list.meshes.length, meshes, instancedMeshes: instanced, draws: list.draws, pointClouds: list.pointClouds.length, curvesSkipped: list.curves.length}
    }

    dispose(): void {
        this._clear()
        for (const g of this._geometries.values()) {
            g.dispose()
            this._mirrored.get(g)?.dispose()
        }
        this._geometries.clear()
        for (const material of this._materials.values()) material.dispose()
        this._materials.clear()
    }

    private _clear(): void {
        for (const child of [...this.root.children]) this.root.remove(child)
        for (const o of this._owned) o.dispose()
        this._owned = []
    }

    private _geometry(mesh: MeshData, mirrored = false): BufferGeometry2 {
        let g = this._geometries.get(mesh)
        if (!g) {
            const {data} = bakeGeometry(mesh, {includeNormals: true})
            g = geometryDataToBufferGeometry<BufferGeometry2>(data, {BufferGeometry: BufferGeometry2, BufferAttribute})
            this._geometries.set(mesh, g)
        }
        if (!mirrored) return g
        const cached = this._mirrored.get(g)
        if (cached) return cached
        // The same vertex buffers, triangles reversed.
        const r = new BufferGeometry2()
        for (const [name, attribute] of Object.entries(g.attributes)) r.setAttribute(name, attribute)
        const index = Uint32Array.from(g.index!.array)
        for (let t = 0; t + 2 < index.length; t += 3) {
            const b = index[t + 1]
            index[t + 1] = index[t + 2]
            index[t + 2] = b
        }
        r.setIndex(new BufferAttribute(index, 1))
        for (const group of g.groups) r.addGroup(group.start, group.count, group.materialIndex)
        r.boundingBox = g.boundingBox
        r.boundingSphere = g.boundingSphere
        this._mirrored.set(g, r)
        return r
    }

    private _slotMaterials(slots: readonly string[] | undefined): IMaterial | IMaterial[] {
        if (!slots || slots.length <= 1) return this._material(slots?.[0] ?? '')
        return slots.map(s => this._material(s))
    }

    private _material(name: string): IMaterial {
        let material = this._materials.get(name)
        if (!material) {
            const d = this.options.materials?.[name]
            const c = d?.baseColor ?? d?.diffuseColor ?? [0.8, 0.8, 0.8]
            material = new PhysicalMaterial({
                color: new Color().setRGB(c[0], c[1], c[2]),
                metalness: d?.metallic ?? 0,
                roughness: d?.roughness ?? 0.5,
            })
            material.name = name || 'default'
            this._materials.set(name, material)
        }
        return material
    }

    private _points(pc: PointCloud, transform: Matrix4): Points {
        const geometry = new BufferGeometry2()
        geometry.setAttribute('position', new BufferAttribute(Float32Array.from(pc.positions), 3))
        this._owned.push(geometry)
        const material = new PointsMaterial({size: 0.02, color: 0xdddddd})
        this._owned.push(material)
        const points = new Points(geometry, material)
        points.matrixAutoUpdate = false
        points.matrix.copy(transform)
        return points
    }
}
