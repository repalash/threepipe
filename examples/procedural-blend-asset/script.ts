import {_testFinish, _testStart, Box3, Group, LoadingScreenPlugin, Sphere, ThreeViewer, Vector3} from 'threepipe'
import {
    applyModifierInputs,
    binResolver,
    DumpV2,
    dumpTime,
    geometryFromDump,
    GeometryNodesEvaluator,
    GeometrySet,
    importBlenderDump,
    isInterfaceSocket,
    JSONValue,
    sceneFromDump,
    socketTypeFromIdname,
} from '@threepipe/plugin-procedural'
import {GeometrySetRenderer, MaterialDisplay} from '@threepipe/plugin-procedural/plugin'

/**
 * A Blender file's geometry-nodes modifier, evaluated here by the TypeScript port.
 *
 * The page loads a bundle (`porting/blender/bundle_dump.py`): the node groups, the modifier's inputs, the mesh
 * entering the modifier and the objects / collections / images the graph refers to - nothing Blender evaluated.
 * Instances are drawn as instanced meshes; editing an input re-runs only the nodes it reaches.
 *
 * `?bundle=<dir>` (default `tmp/bundles/blender-procedural-buildings`, relative to the server root) picks the
 * bundle, `?object=<name>` the object, e.g. `?bundle=tmp/bundles/flower_scattering` for the flower field (30 740
 * instances, 116 634 drawn meshes - needs a GPU). Bundles are made locally from the maintainer's .blend files;
 * they are not in git.
 */

const params = new URLSearchParams(location.search)
const bundleDir = (params.get('bundle') ?? 'tmp/bundles/blender-procedural-buildings').replace(/\/$/, '')

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

    const base = new URL(`/${bundleDir}/`, location.href)
    const [json, bin] = await Promise.all([
        fetch(new URL('bundle.json', base)).then(r => {
            if (!r.ok) throw new Error(`${r.status} loading ${r.url} - make it with porting/blender/bundle_dump.py`)
            return r.json() as Promise<DumpV2>
        }),
        fetch(new URL('bundle.bin', base)).then(r => r.arrayBuffer()),
    ])
    const resolve = binResolver({'bundle.bin': bin})
    const {library} = importBlenderDump(json)
    const scene = sceneFromDump(json.referenced!, resolve)
    const object = json.objects.find(o => o.name === params.get('object'))
        ?? json.objects.find(o => o.modifiers.some(m => m.type === 'NODES' && m.enabled))!
    el('source').textContent = `${json.blend_file} / ${object.name} (Blender ${json.blender})`

    // The modifiers from the first nodes modifier on, as Blender runs them on the dumped input geometry.
    const enabled = object.modifiers.filter(m => m.enabled)
    const stack = enabled.slice(enabled.findIndex(m => m.type === 'NODES'))
    const other = stack.filter(m => m.type !== 'NODES')
    if (other.length) throw new Error(`modifiers other than geometry nodes are not ported: ${other.map(m => m.type).join(', ')}`)
    const evaluators = stack.map(m => {
        const ev = new GeometryNodesEvaluator(library, m.nodeGroup!, {scene, selfObject: object.name, time: dumpTime(json)})
        applyModifierInputs(ev, m.inputs ?? {})
        return ev
    })
    const input = geometryFromDump(object.input_geometry!, resolve)

    // Blender is Z-up: the drawn geometry sits under a parent turned to threepipe's Y-up, at the object's matrix.
    const renderer = new GeometrySetRenderer({scene, materials: (json.referenced as {materials?: Record<string, MaterialDisplay>}).materials})
    const zUp = new Group()
    zUp.rotation.x = -Math.PI / 2
    const placed = new Group()
    placed.matrixAutoUpdate = false
    if (object.matrix_world) placed.matrix.fromArray(object.matrix_world)
    placed.add(renderer.root)
    zUp.add(placed)
    viewer.scene.addObject(zUp)

    const evaluate = () => {
        const t0 = performance.now()
        let geometry: GeometrySet = input
        const warnings: string[] = []
        for (const ev of evaluators) {
            ev.setInputGeometry(geometry)
            const result = ev.evaluate()
            geometry = result.geometry ?? new GeometrySet()
            warnings.push(...result.warnings.map(w => `${w.node}: ${w.message}`))
        }
        const t1 = performance.now()
        renderer.update(geometry)
        const t2 = performance.now()
        const s = renderer.stats
        el('stats').innerHTML = `<div>instances drawn ${s.draws.toLocaleString()} of ${s.uniqueMeshes} meshes (${s.instancedMeshes} instanced draws, ${s.meshes} single)</div>`
            + `<div>root mesh: ${geometry.mesh ? `${geometry.mesh.vertsNum} verts, ${geometry.mesh.facesNum} faces` : 'none'}</div>`
            + `<div>top-level instances ${geometry.instances?.instancesNum ?? 0}</div>`
            + (s.curvesSkipped ? `<div>curves not drawn: ${s.curvesSkipped}</div>` : '')
            + `<div>evaluate ${(t1 - t0).toFixed(1)} ms, draw lists ${(t2 - t1).toFixed(1)} ms</div>`
        el('error').textContent = warnings.join('\n')
        viewer.setDirty()
    }

    // One row per interface input of each nodes modifier, set to the modifier's value in the .blend.
    stack.forEach((m, i) => {
        const ev = evaluators[i]
        for (const socket of ev.interfaceInputs.filter(isInterfaceSocket)) {
            const type = socketTypeFromIdname(socket.socketType)
            if (type === 'GEOMETRY') continue
            const given = m.inputs?.[socket.identifier]
            const row = document.createElement('label')
            row.className = 'row'
            const name = document.createElement('span')
            name.textContent = socket.name
            row.appendChild(name)
            if (given?.type === 'ATTRIBUTE' && given.attribute_name) {
                row.insertAdjacentHTML('beforeend', `<span class="ref">attribute "${given.attribute_name}"</span>`)
            } else if (type === 'FLOAT' || type === 'INT') {
                const value = (given?.value ?? socket.default ?? 0) as number
                const field = document.createElement('input')
                field.type = 'number'
                field.step = type === 'INT' ? '1' : 'any'
                field.value = String(value)
                if (socket.min_value !== undefined) field.min = String(socket.min_value)
                if (socket.max_value !== undefined) field.max = String(socket.max_value)
                field.addEventListener('change', () => {
                    ev.setInput(socket.identifier, type === 'INT' ? Math.round(+field.value) : +field.value)
                    evaluate()
                })
                row.appendChild(field)
                row.appendChild(document.createElement('span'))
            } else if (type === 'BOOLEAN') {
                const box = document.createElement('input')
                box.type = 'checkbox'
                box.checked = !!(given?.value ?? socket.default)
                box.addEventListener('change', () => {
                    ev.setInput(socket.identifier, box.checked)
                    evaluate()
                })
                row.appendChild(box)
            } else {
                const value = (given?.value ?? socket.default) as JSONValue
                const text = value && typeof value === 'object' && '_ref' in (value as object) ? (value as {name: string}).name : JSON.stringify(value)
                row.insertAdjacentHTML('beforeend', `<span class="ref"></span>`)
                row.querySelector('.ref')!.textContent = `${type.toLowerCase()}: ${text}`
            }
            el('inputs').appendChild(row)
        }
    })

    evaluate()
    // A three-quarter view from above, at a distance that fits the result's bounding sphere.
    const sphere = new Box3().setFromObject(zUp).getBoundingSphere(new Sphere())
    const camera = viewer.scene.mainCamera
    camera.position.copy(sphere.center).addScaledVector(new Vector3(0.55, 0.45, 0.7).normalize(), sphere.radius * 2.6)
    camera.target.copy(sphere.center)
    camera.setDirty()
    Object.assign(window as never, {viewer, renderer, evaluators, evaluate, library})
}

_testStart()
init().catch(e => {
    document.getElementById('error')!.textContent = String(e?.stack ?? e)
    throw e
}).finally(_testFinish)
