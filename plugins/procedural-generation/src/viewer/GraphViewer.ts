/**
 * GraphViewer — Generic viewer for any GraphModule.
 *
 * Given a GraphModule, this:
 * 1. Loads all declared assets
 * 2. Creates a runtime, evaluates the graph
 * 3. Builds the 3D scene from GeneratedInstance[] outputs
 * 4. Auto-generates UI from node input metadata
 * 5. Rebuilds scene on any UI change
 *
 * Usage in an example script:
 * ```ts
 * import {graphModule} from './my_graph'
 * import {launchGraphViewer} from '@threepipe/plugin-procedural-generation'
 * launchGraphViewer(graphModule)
 * ```
 */

import {
    BufferGeometry, DirectionalLight2, DoubleSide, Float32BufferAttribute, GBufferPlugin,
    Group2, HemisphereLight2, InstancedMesh2, type IObject3D, Matrix4, Mesh2, MeshStandardMaterial,
    PhysicalMaterial, PickingPlugin, PlaneGeometry, SSAOPlugin, ThreeViewer, Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createRuntime} from '../graph/runtime'
import {graphUiConfig} from '../graph/ui'
import {createGraphOverlay} from '../graph/visualizer'
import type {GraphModule, GeneratedInstance, ModuleMap} from '../graph/module'

// ─── Asset loading ───────────────────────────────────────────────────

export async function loadAssets(
    viewer: ThreeViewer,
    assets: string[],
    basePath: string,
): Promise<ModuleMap> {
    const modules: ModuleMap = new Map()
    for (const name of assets) {
        try {
            const obj = await viewer.load<IObject3D>(basePath + name, {autoCenter: false, autoScale: false})
            if (!obj) continue
            const meshes: {geometry: any, material: any}[] = []
            // Store raw geometry + world matrix. GLB mesh nodes may have non-identity
            // transforms (positions, rotations) not baked into the vertex buffer.
            // Callers use getWorldGeometry() for computation, or pass
            // applyWorldMatrices to buildSceneFromInstances for rendering.
            obj.updateMatrixWorld(true)
            obj.traverse((child: any) => {
                if (child.isMesh && child.geometry) {
                    meshes.push({
                        geometry: child.geometry,
                        material: child.material,
                        worldMatrix: child.matrixWorld.clone(),
                    })
                }
            })
            if (meshes.length > 0) modules.set(name, {meshes})
            obj.removeFromParent()
        } catch (e) { console.warn(`loadAssets: failed to load '${name}':`, e) }
    }
    return modules
}

// ─── Shared temporaries ──────────────────────────────────────────────

const _m4 = new Matrix4()
const _m4b = new Matrix4()
const _identity = new Matrix4()

/**
 * Get a world-space copy of an asset's geometry from a ModuleMap.
 * Clones the geometry and applies the GLB node's world matrix (position, rotation, scale)
 * so vertices are in Y-up world space. Use this when you need geometry for computation
 * (scatter, raycasting) rather than for instanced rendering.
 */
export function getWorldGeometry(modules: ModuleMap, assetName: string, meshIndex = 0): BufferGeometry | null {
    const mod = modules.get(assetName)
    if (!mod || !mod.meshes[meshIndex]) return null
    const {geometry, worldMatrix} = mod.meshes[meshIndex]
    if (!geometry) return null
    if (!worldMatrix || worldMatrix.equals(_identity)) return geometry
    const clone = geometry.clone()
    clone.applyMatrix4(worldMatrix)
    return clone
}

// ─── Scene building from instances ───────────────────────────────────

/** Convert a Blender Z-up column-major 4×4 matrix to three.js Y-up Matrix4. */
function blenderToThreeMatrix(m: number[], out: Matrix4): Matrix4 {
    const bx = m[12], by = m[13], bz = m[14]
    // Swap Y↔Z rows and columns in the 3×3 rotation+scale part:
    out.set(
        m[0], m[8], -m[4], bx,
        m[2], m[10], -m[6], bz,
        -m[1], -m[9], m[5], -by,
        0, 0, 0, 1,
    )
    return out
}

/**
 * Build a three.js scene from GeneratedInstance[] using InstancedMesh2.
 *
 * @param applyWorldMatrices — When true, each mesh's GLB node transform (worldMatrix)
 * is composed into the instance matrix. Use this for scatter systems where the instance
 * matrix is a shared scatter transform and each mesh has its own child offset.
 * Default false — for generators where the instance matrix is the full world transform.
 */
export function buildSceneFromInstances(
    instances: GeneratedInstance[],
    modules: ModuleMap,
    {applyWorldMatrices = false}: {applyWorldMatrices?: boolean} = {},
): Group2 {
    const root = new Group2()

    // Group instances by asset name
    const groups = new Map<string, GeneratedInstance[]>()
    const missing = new Set<string>()
    for (const inst of instances) {
        if (!modules.has(inst.object_name)) {
            if (!missing.has(inst.object_name)) {
                missing.add(inst.object_name)
                console.warn(`GraphViewer: no asset loaded for "${inst.object_name}" — instance will be invisible`)
            }
            continue
        }
        let list = groups.get(inst.object_name)
        if (!list) { list = []; groups.set(inst.object_name, list) }
        list.push(inst)
    }

    // Create one InstancedMesh2 per (asset, submesh) pair
    for (const [assetName, assetInstances] of groups) {
        const mod = modules.get(assetName)!
        const count = assetInstances.length

        for (const mesh of mod.meshes) {
            const instMesh = new InstancedMesh2(mesh.geometry, mesh.material, count)
            instMesh.name = assetName

            // Pre-compute mesh world matrix if needed
            const hasWM = applyWorldMatrices && mesh.worldMatrix && !mesh.worldMatrix.equals(_identity)

            for (let i = 0; i < count; i++) {
                blenderToThreeMatrix(assetInstances[i].world_matrix, _m4)
                if (hasWM) {
                    // Compose: instanceMatrix @ meshWorldMatrix
                    _m4b.copy(_m4).multiply(mesh.worldMatrix)
                    instMesh.setMatrixAt(i, _m4b)
                } else {
                    instMesh.setMatrixAt(i, _m4)
                }
            }

            instMesh.instanceMatrix.needsUpdate = true
            instMesh.computeBoundingBox()
            instMesh.computeBoundingSphere()
            instMesh.castShadow = true
            instMesh.receiveShadow = true
            root.add(instMesh)
        }
    }

    return root
}

// ─── Mesh output rendering ──────────────────────────────────────────

function buildSceneFromMeshOutput(output: {
    rings: {vertices: number[], indices: number[], placements: number[][], rotations: number[]}[],
    material?: {color?: number, doubleSided?: boolean},
    scale?: number,
}): Group2 {
    const root = new Group2()
    const mat = new MeshStandardMaterial({
        color: output.material?.color ?? 0xcc3355,
        roughness: 0.6,
        side: output.material?.doubleSided ? DoubleSide : undefined,
    })
    const scale = output.scale ?? 1

    for (const ring of output.rings) {
        // Build BufferGeometry from vertex data
        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(ring.vertices, 3))
        geo.setIndex(ring.indices)
        geo.computeVertexNormals()

        // Place at each scatter position
        for (let pi = 0; pi < ring.placements.length; pi++) {
            const [px, py, pz] = ring.placements[pi]
            const rot = ring.rotations[pi]
            const mesh = new Mesh2(geo as any, mat as any)
            // Petal rotation (around Z in Blender = around circle normal)
            // + flower is Blender Z-up, rotate -90° around X to convert
            mesh.rotation.set(-Math.PI / 2, 0, rot)
            mesh.position.set(px, py, pz)
            mesh.scale.setScalar(scale)
            mesh.castShadow = true
            mesh.receiveShadow = true
            root.add(mesh)
        }
    }
    return root
}

// ─── Graph visualizer toggle button ──────────────────────────────────

/**
 * Returns a UiObjectConfig button that toggles the SVG graph visualizer overlay.
 * Use with any TweakpaneUiPlugin: `ui.appendChild(graphVisualizerButton(graphModule))`
 */
export function graphVisualizerButton(gm: GraphModule) {
    return {
        type: 'button' as const,
        label: 'Show Graph',
        onChange: () => {
            const existing = document.getElementById('graph-overlay')
            if (existing) { existing.remove(); return }
            const overlay = createGraphOverlay(gm.graphs.map((g, i) => ({
                graph: g.graph,
                label: g.outputs[0]?.node.name ?? `Graph ${i}`,
            })))
            overlay.id = 'graph-overlay'
            document.body.appendChild(overlay)
        },
    }
}

// ─── Main entry point ────────────────────────────────────────────────

export interface GraphViewerOptions {
    /** Canvas element ID. Default: 'mcanvas' */
    canvasId?: string
    /** Environment map URL */
    envMap?: string
    /** Camera position */
    cameraPos?: [number, number, number]
    /** Camera target */
    cameraTarget?: [number, number, number]
    /** Ground plane size. 0 to disable. Default: 100 */
    groundSize?: number
}

export async function launchGraphViewer(
    gm: GraphModule,
    options: GraphViewerOptions = {},
): Promise<{viewer: ThreeViewer, rebuild: () => void}> {
    const {
        canvasId = 'mcanvas',
        envMap = 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr',
        cameraPos = [30, 25, 40],
        cameraTarget = [0, 15, 0],
        groundSize = 100,
    } = options

    const viewer = new ThreeViewer({
        canvas: document.getElementById(canvasId) as HTMLCanvasElement,
        msaa: true, rgbm: false,
        assetManager: {simpleCache: false, storage: false},
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    })

    const ssao = viewer.getPlugin(SSAOPlugin)
    if (ssao?.pass) ssao.pass.intensity = 0.5
    await viewer.setEnvironmentMap(envMap, {setBackground: true})

    // Lights
    const sun = new DirectionalLight2(0xffeebb, 2.5)
    sun.position.set(30, 40, 35)
    sun.castShadow = true
    sun.shadow.camera.left = -80
    sun.shadow.camera.right = 80
    sun.shadow.camera.top = 60
    sun.shadow.camera.bottom = -5
    sun.shadow.mapSize.setScalar(2048)
    sun.shadow.bias = -0.0005
    viewer.scene.addObject(sun)
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4))

    // Ground
    if (groundSize > 0) {
        const ground = new Mesh2(
            new PlaneGeometry(groundSize, groundSize) as any,
            new PhysicalMaterial({color: 0x777770, roughness: 0.95}) as any,
        )
        ground.rotation.x = -Math.PI / 2
        ground.receiveShadow = true
        viewer.scene.addObject(ground)
    }

    // Load assets
    const basePath = gm.assetsPath ?? './assets/'
    const modules = await loadAssets(viewer, gm.assets, basePath)
    console.log(`Loaded ${modules.size}/${gm.assets.length} assets`)

    // Create one runtime per graph
    const runtimes = gm.graphs.map(({graph}) => {
        const rt = createRuntime(graph)
        rt.evaluate()
        return rt
    })

    // Build scene
    let roots: Group2[] = []
    const ownedRoots = new Set<Group2>() // roots that own their geometry (need disposal)

    const rebuild = () => {
        for (const r of roots) {
            r.removeFromParent()
            if (ownedRoots.has(r)) {
                // Owned roots: dispose geometry + material (created by us)
                r.traverse((c: any) => {
                    c.geometry?.dispose?.()
                    if (c.material && !Array.isArray(c.material)) c.material.dispose?.()
                })
            } else {
                // Instance roots: geometry/material are shared with loaded assets — don't dispose them.
                // But InstancedMesh2 has its own instanceMatrix buffer that must be freed.
                r.traverse((c: any) => {
                    if (c.isInstancedMesh) {
                        c.instanceMatrix?.dispose?.()
                        c.instanceColor?.dispose?.()
                    }
                })
            }
        }
        roots = []
        ownedRoots.clear()

        for (let gi = 0; gi < gm.graphs.length; gi++) {
            runtimes[gi].evaluate()
            for (const ref of gm.graphs[gi].outputs) {
                const output = runtimes[gi].get(ref.node, ref.output)

                if (Array.isArray(output)) {
                    // GeneratedInstance[] — build from loaded assets
                    const group = buildSceneFromInstances(output as GeneratedInstance[], modules)
                    group.name = ref.node.name
                    console.log(`${ref.node.name}: ${(output as any[]).length} inst → ${group.children.length} rendered`)
                    viewer.scene.addObject(group)
                    roots.push(group)
                } else if (output && typeof output === 'object' && 'rings' in output) {
                    // FlowerScatterOutput-like: {rings: [{vertices, indices, placements, rotations}], material, scale}
                    const group = buildSceneFromMeshOutput(output as any)
                    group.name = ref.node.name
                    viewer.scene.addObject(group)
                    roots.push(group)
                    ownedRoots.add(group)
                    console.log(`${ref.node.name}: mesh scatter (${group.children.length} meshes)`)
                } else if (output != null) {
                    console.warn(`${ref.node.name}: unknown output type, skipping`)
                }
            }
        }
        viewer.setDirty()
    }

    rebuild()

    // Camera
    viewer.scene.mainCamera.position.set(...cameraPos)
    viewer.scene.mainCamera.target = new Vector3(...cameraTarget)
    viewer.scene.mainCamera.setDirty?.()

    // UI — one folder per graph
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(SSAOPlugin)
    for (let gi = 0; gi < runtimes.length; gi++) {
        const label = gm.graphs[gi].outputs[0]?.node.name ?? `Graph ${gi}`
        ui.appendChild(graphUiConfig(runtimes[gi], rebuild, label))
    }

    // Graph visualizer toggle
    ui.appendChild(graphVisualizerButton(gm))

    return {viewer, rebuild}
}
