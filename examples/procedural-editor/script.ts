import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {geometryNodes, n} from '@threepipe/plugin-procedural'
import {ProceduralPlugin} from '@threepipe/plugin-procedural/plugin'

/**
 * The modelling editor with geometry nodes. A cube carries a `geometryNodes` modifier running a small
 * graph written in the DSL; its inputs are editable in Properties > Modifiers, each edit one undoable
 * `modifier update` command. Any group added with `{op: 'nodeGroup', ...}` can be added to an object there.
 */

// The object's mesh joined with small cubes scattered on its faces (Distribute Points on Faces + Instance on Points).
const studs = geometryNodes('Studs', g => {
    const geometry = g.input.geometry('Geometry')
    const density = g.input.float('Density', {default: 12, min: 0, max: 60})
    const size = g.input.float('Size', {default: 0.08, min: 0.01, max: 0.5})
    const seed = g.input.int('Seed', {default: 0, min: 0, max: 100})
    const points = n.DistributePointsOnFaces({mesh: geometry, density, seed})
    const stud = n.MeshCube({size: [1, 1, 1]})
    const studs = n.InstanceOnPoints({points: points.points, instance: stud.mesh, rotation: points.rotation, scale: size})
    g.output.geometry('Geometry', n.JoinGeometry({geometry: [geometry, n.RealizeInstances({geometry: studs.instances}).geometry]}).geometry)
})

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin, ProceduralPlugin]},
        engine: {storageKey: null},
        // This example opens on the modifier: no first-run welcome or hints over it.
        onboarding: false,
    })
    const {viewer, engine} = editor
    const modelling = viewer.getPlugin(ModellingPlugin)!

    await modelling.run({op: 'nodeGroup', library: studs.toJSON()})
    await engine.run('add.cube')
    const cube = modelling.document.entries[0]
    await modelling.run({op: 'modifier', object: cube.name, add: {type: 'geometryNodes', group: 'Studs', inputs: {}}})
    viewer.getPlugin(PickingPlugin)?.setSelectedObject(cube.object, false, false)
    engine.file.markClean()

    Object.assign(window as never, {viewer, editor, engine, modelling})
}

_testStart()
init().finally(_testFinish)
