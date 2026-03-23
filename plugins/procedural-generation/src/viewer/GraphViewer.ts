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
    Box3, DirectionalLight2, GBufferPlugin, Group2, HemisphereLight2,
    type IObject3D, Matrix4, Mesh2, PhysicalMaterial, PickingPlugin, PlaneGeometry,
    Quaternion, SSAOPlugin, ThreeViewer, Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createRuntime} from '../graph/runtime'
import {graphUiConfig} from '../graph/ui'
import {createGraphOverlay} from '../graph/visualizer'
import type {GraphModule, GeneratedInstance} from '../graph/module'
import type {ModuleMap} from '../generators/buildify_demo_1'

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
            obj.traverse((child: any) => {
                if (child.isMesh && child.geometry) meshes.push({geometry: child.geometry, material: child.material})
            })
            if (meshes.length > 0) modules.set(name, {meshes})
            obj.removeFromParent()
        } catch { /* skip missing */ }
    }
    return modules
}

// ─── Scene building from instances ───────────────────────────────────

const _m4 = new Matrix4()
const _pos = new Vector3()
const _quat = new Quaternion()
const _scale = new Vector3()

export function buildSceneFromInstances(
    instances: GeneratedInstance[],
    modules: ModuleMap,
): Group2 {
    const root = new Group2()
    const missing = new Set<string>()
    for (const inst of instances) {
        const mod = modules.get(inst.object_name)
        if (!mod) {
            if (!missing.has(inst.object_name)) {
                missing.add(inst.object_name)
                console.warn(`GraphViewer: no asset loaded for "${inst.object_name}" — instance will be invisible`)
            }
            continue
        }

        // Convert Blender Z-up to three.js Y-up.
        // Position: (bx, bz, -by). Rotation/scale from the 3x3 upper-left.
        const m = inst.world_matrix
        // Column-major: pos = [m12, m13, m14] in Blender coords
        const bx = m[12], by = m[13], bz = m[14]

        // 3x3 rotation+scale part (column-major):
        // col0=[m0,m1,m2], col1=[m4,m5,m6], col2=[m8,m9,m10]
        // Convert by swapping Y↔Z rows and columns:
        _m4.set(
            m[0], m[8], -m[4], bx,
            m[2], m[10], -m[6], bz,
            -m[1], -m[9], m[5], -by,
            0, 0, 0, 1,
        )
        _m4.decompose(_pos, _quat, _scale)

        const group = new Group2()
        group.position.copy(_pos)
        group.quaternion.copy(_quat)
        group.scale.copy(_scale)

        for (const mesh of mod.meshes) {
            const clone = new Mesh2(mesh.geometry, mesh.material)
            clone.castShadow = true
            clone.receiveShadow = true
            group.add(clone)
        }
        root.add(group)
    }
    return root
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

    const rebuild = () => {
        for (const r of roots) r.removeFromParent()
        roots = []
        for (let gi = 0; gi < gm.graphs.length; gi++) {
            runtimes[gi].evaluate()
            for (const ref of gm.graphs[gi].outputs) {
                const instances = runtimes[gi].get(ref.node, ref.output) as GeneratedInstance[]
                if (!Array.isArray(instances)) continue
                const group = buildSceneFromInstances(instances, modules)
                group.name = ref.node.name
                console.log(`${ref.node.name}: ${instances.length} inst → ${group.children.length} rendered`)
                viewer.scene.addObject(group)
                roots.push(group)
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
    ui.appendChild({
        type: 'button', label: 'Show Graph',
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
    })

    return {viewer, rebuild}
}
