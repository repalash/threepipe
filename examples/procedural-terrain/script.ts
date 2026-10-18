import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {terrain} from './terrain.js'
import {ProceduralPlugin} from '@threepipe/plugin-procedural/plugin'

/**
 * A terrain made with geometry nodes (Blender's, ported to TypeScript) and driven through the modelling
 * command API.
 *
 * The graph is written in the DSL and stored on the document with the `nodeGroup` command; a plane gets a
 * `geometryNodes` modifier that runs it. Every slider below sends `{op: 'modifier', update: {inputs}}`,
 * so each change is one undoable command - the same call an agent makes - and the evaluator re-runs only
 * the nodes the changed input reaches.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const modelling = viewer.addPluginSync(ModellingPlugin)
    viewer.addPluginSync(ProceduralPlugin)
    ;(window as any).modelling = modelling

    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
    // Slider state, by input name: filled once the group's interface is known.
    const current: Record<string, number> = {}
    const sliders = new Map<string, {slider: HTMLInputElement, out: HTMLOutputElement, def: number}>()
    const run = async(command: Record<string, unknown>) => {
        const result = await modelling.run(command as never)
        el('error').textContent = result.ok ? '' : result.error ?? ''
        refresh(result.ms)
        return result
    }

    // The graph, the object, its modifier; the object is turned from Blender's Z-up to threepipe's Y-up.
    await run({op: 'nodeGroup', library: terrain.toJSON()})
    await run({op: 'primitive', type: 'plane', name: 'terrain'})
    await run({op: 'transform', object: 'terrain', rotate: [-Math.PI / 2, 0, 0]})
    await run({op: 'modifier', object: 'terrain', add: {type: 'geometryNodes', group: 'Terrain', inputs: {}}})
    viewer.scene.mainCamera.position.set(18, 16, 18)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    const groups = await modelling.run({op: 'nodeGroup', name: 'Terrain', describe: true} as never)
    const iface = (groups.data as {inputs: {name: string, type: string, default: number, min?: number, max?: number}[]}[])[0].inputs
    for (const input of iface.filter(i => !i.type.startsWith('NodeSocketGeometry'))) {
        const row = document.createElement('label')
        row.className = 'row'
        const isInt = input.type.startsWith('NodeSocketInt')
        const min = input.min ?? 0, max = input.max ?? 1
        row.innerHTML = `<span>${input.name}</span><input type="range" min="${min}" max="${max}" step="${isInt ? 1 : (max - min) / 200}" value="${input.default}"><output>${input.default}</output>`
        const slider = row.querySelector('input')!
        const out = row.querySelector('output')!
        current[input.name] = input.default
        sliders.set(input.name, {slider, out, def: input.default})
        slider.addEventListener('change', () => {
            const v = isInt ? Math.round(+slider.value) : +(+slider.value).toFixed(3)
            out.textContent = String(v)
            current[input.name] = v
            run({op: 'modifier', object: 'terrain', index: 0, update: {inputs: {...current}}})
        })
        el('inputs').appendChild(row)
    }

    el('undo').addEventListener('click', () => run({op: 'undo'}))
    el('redo').addEventListener('click', () => run({op: 'redo'}))
    el('apply').addEventListener('click', () => run({op: 'modifier', object: 'terrain', apply: true}))
    el('show-code').addEventListener('click', async() => {
        const result = await modelling.run({op: 'nodeGroup', name: 'Terrain', describe: true, code: true} as never)
        const code = el('code')
        code.textContent = (result.data as {code: string}[])[0].code
        code.style.display = 'block'
    })

    // Commands from anywhere (the console, an agent, undo) update the panel: stats and slider values follow
    // the modifier's current inputs.
    modelling.addEventListener('documentChanged', () => refresh())

    function refresh(ms?: number) {
        const entry = modelling.document.find('terrain')
        if (!entry) return
        const inputs = (entry.modifiers[0]?.type === 'geometryNodes' ? entry.modifiers[0].inputs : undefined) as Record<string, number> | undefined
        for (const [name, {slider, out, def}] of sliders) {
            const v = inputs?.[name] ?? def
            current[name] = v
            slider.value = String(v)
            out.textContent = String(v)
        }
        el('stats').innerHTML = `<div>verts ${entry.evaluated.vertsNum}, faces ${entry.evaluated.facesNum}</div>`
            + `<div>modifiers: ${entry.modifiers.length ? entry.modifiers.map(m => m.type).join(', ') : 'none (applied)'}</div>`
            + (ms !== undefined ? `<div>last command ${ms} ms</div>` : '')
    }
    refresh()
}

_testStart()
init().finally(_testFinish)
