import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {ProceduralPlugin} from '@threepipe/plugin-procedural/plugin'
import {terrain} from '../procedural-terrain/terrain.js'

/**
 * Three geometry-nodes assets in the modelling editor, each as a `geometryNodes` modifier whose inputs are editable in
 * Properties > Modifiers (every edit is one undoable `modifier update` command, re-running only what it reaches):
 *
 * - `?asset=terrain` (default): the DSL terrain group on a plane;
 * - `?asset=buildify`: Buildify 1.0's `building_base` from its runtime bundle;
 * - `?asset=flowers`: the flower field (`flower_scattering.blend`, 30 740 instances) from its runtime bundle.
 *
 * The Blender assets come through the `blendAsset` command: the mesh entering the modifier, the node groups, the
 * modifier's input values and the objects / collections / images the graphs read - nothing Blender evaluated. Bundles
 * are made locally from the maintainer's .blend files (`porting/blender/bundle_dump.py` into `tmp/bundles/`); they are
 * not in git. The files' sources and licences (cleared by the maintainer on 2026-10-18) are in
 * `plugins/procedural/tests/fixtures/ASSETS.md`.
 */

const ASSETS = {
    buildify: {url: '/tmp/bundles/buildify_1.0', object: 'building_base'},
    flowers: {url: '/tmp/bundles/flower_scattering', object: 'EN-ground_plane_NEW'},
} as const

async function init() {
    const asset = new URLSearchParams(location.search).get('asset') ?? 'terrain'
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin, ProceduralPlugin]},
        engine: {storageKey: null},
        onboarding: false,
    })
    const {viewer, engine} = editor
    const modelling = viewer.getPlugin(ModellingPlugin)!
    const metrics: Record<string, number | string> = {asset}
    const run = async(command: Record<string, unknown>) => {
        const result = await modelling.run(command as never)
        if (!result.ok) throw new Error(`${command.op}: ${result.error}`)
        return result
    }

    let name: string
    if (asset === 'terrain') {
        await run({op: 'nodeGroup', library: terrain.toJSON()})
        await run({op: 'primitive', type: 'plane', name: 'terrain'})
        // The graph is Blender's Z-up; the object turns it to threepipe's Y-up.
        await run({op: 'transform', object: 'terrain', rotate: [-Math.PI / 2, 0, 0]})
        const added = await run({op: 'modifier', object: 'terrain', add: {type: 'geometryNodes', group: 'Terrain', inputs: {}}})
        metrics.loadMs = added.ms ?? 0
        name = 'terrain'
    } else {
        const spec = ASSETS[asset as keyof typeof ASSETS]
        if (!spec) throw new Error(`unknown asset "${asset}" (terrain, buildify, flowers)`)
        const added = await run({op: 'blendAsset', url: spec.url, object: spec.object})
        metrics.loadMs = added.ms ?? 0
        name = (added.data as {name: string}).name
    }
    const entry = modelling.document.find(name)!
    viewer.getPlugin(PickingPlugin)?.setSelectedObject(entry.object, false, false)
    await engine.run('view.frame_all')
    engine.file.markClean()

    Object.assign(window as never, {viewer, editor, engine, modelling, procedural: viewer.getPlugin(ProceduralPlugin), acceptance: metrics})
}

_testStart()
init().finally(_testFinish)
