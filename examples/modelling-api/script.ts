import {
    _testFinish,
    _testStart,
    CameraViewPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {MeshEditPlugin, ReferenceImagePlugin} from '@threepipe/plugin-mesh-edit'
import {Command, ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling command API, driven by hand.
 *
 * Everything on this page goes through `modelling.run({op, ...})` - the same entry point a script or
 * an agent uses. The console takes a command as JSON and prints the result; the Commands list is
 * `describeCommands()`, which is also what an agent receives as its tool list. Nothing here is a
 * private path into the plugin.
 *
 * The layout is the SU-152 report's eighth and last request: reference, the selected part, its
 * parameters and the resulting change visible together. Its own conclusion was that keeping those
 * apart is what let proportion errors survive a hundred operations.
 *
 * `MeshEditPlugin` is loaded alongside, so anything built by command can then be shaped by hand with
 * Tab, and anything shaped by hand can be inspected by command.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, TransformControlsPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // Saved camera views come from threepipe's own plugin; `getOrAdd` because TransformControls
    // already depends on it and adding it twice logs a warning.
    viewer.getOrAddPluginSync(CameraViewPlugin)

    const modelling = viewer.addPluginSync(ModellingPlugin)
    viewer.addPluginSync(MeshEditPlugin)
    viewer.addPluginSync(ReferenceImagePlugin)
    const picking = viewer.getPlugin(PickingPlugin)!

    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
    const logEl = el('log')
    const inputEl = el<HTMLTextAreaElement>('input')

    // --- console --------------------------------------------------------------------------------

    function print(text: string, cls = '') {
        const line = document.createElement('div')
        line.className = cls
        line.textContent = text
        logEl.appendChild(line)
        logEl.scrollTop = logEl.scrollHeight
    }

    const shorten = (s: string) => s.length > 220 ? s.slice(0, 220) + '…' : s

    async function send(command: Command) {
        print('> ' + JSON.stringify(command), 'cmd')
        const result = await modelling.run(command)
        if (!result.ok) print(`  error: ${result.error}`, 'err')
        else {
            for (const w of result.warnings ?? []) print(`  warning: ${w}`, 'warn')
            print(`  ok ${result.ms}ms`
                + (result.data === undefined ? '' : ' ' + shorten(JSON.stringify(result.data))), 'ok')
        }
        refresh()
        return result
    }

    async function runInput() {
        const text = inputEl.value.trim()
        if (!text) return
        let parsed: Command | Command[]
        try {
            parsed = JSON.parse(text)
        } catch (e) {
            print(`  not valid JSON: ${(e as Error).message}`, 'err')
            return
        }
        for (const command of Array.isArray(parsed) ? parsed : [parsed]) await send(command)
    }

    el('run').addEventListener('click', runInput)
    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            runInput()
        }
    })
    el('undo').addEventListener('click', () => send({op: 'undo'}))
    el('redo').addEventListener('click', () => send({op: 'redo'}))
    el('capture').addEventListener('click', async() => {
        const result = await send({op: 'capture'})
        const url = (result.data as {dataUrl?: string} | undefined)?.dataUrl
        if (url) window.open(url, '_blank')
    })
    el('demo').addEventListener('click', () => runDemo(send))

    // --- the three panes -------------------------------------------------------------------------

    for (const section of Array.from(document.querySelectorAll<HTMLElement>('#side section'))) {
        section.querySelector('h4')!.addEventListener('click', () => section.classList.toggle('collapsed'))
    }

    /** Reference pane: what is placed, at what measured scale, and a button to go to its view. */
    function refreshReference() {
        const body = el('reference-body')
        const planes = [...modelling.references.values()]
        el('reference-scale').textContent = planes.length
            ? `${planes.length} placed` : ''
        if (!planes.length) return

        body.innerHTML = ''
        for (const plane of planes) {
            const img = document.createElement('img')
            img.src = plane.src
            img.alt = plane.name
            body.appendChild(img)

            const meta = document.createElement('div')
            meta.style.color = '#8a8a96'
            meta.style.marginTop = '5px'
            // The calibration, stated. An uncalibrated reference is the failure this pane exists for.
            meta.textContent = `${plane.name} · ${plane.plane} · `
                + `${plane.width.toFixed(2)} × ${plane.height.toFixed(2)} units`
            body.appendChild(meta)

            const chips = document.createElement('div')
            chips.className = 'chips'
            for (const [label, command] of [
                ['go to view', {op: 'camera', view: `ref:${plane.name}`}],
                ['compare', {op: 'display', mode: 'solid'}],
                ['hide', {op: 'reference', name: plane.name, visible: !plane.object.visible}],
            ] as [string, Command][]) {
                const button = document.createElement('button')
                button.textContent = label
                button.addEventListener('click', () => send(command))
                chips.appendChild(button)
            }
            body.appendChild(chips)
        }
    }

    /** Selected pane: the part being worked on, its counts, its transform, its modifier stack. */
    function refreshSelected() {
        const object = picking.getSelectedObject() as IObject3D | undefined
        const entry = object ? modelling.document.find(object.uuid) : undefined
        el('selected-name').textContent = entry ? entry.name : ''

        if (!entry) {
            el('selected-body').textContent = modelling.document.size
                ? 'nothing selected — click an object'
                : 'the document is empty'
            el('modifier-list').textContent = ''
            return
        }

        const o = entry.object
        const fmt = (v: {x: number, y: number, z: number}) =>
            `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}`
        el('selected-body').innerHTML =
            `<b>${entry.name}</b>\n`
            + `verts ${entry.mesh.vertsNum}  faces ${entry.mesh.facesNum}\n`
            + (entry.modifiers.length
                ? `evaluated ${entry.evaluated.vertsNum} / ${entry.evaluated.facesNum}\n` : '')
            + `pos  ${fmt(o.position)}\n`
            + `rot  ${o.rotation.x.toFixed(2)} ${o.rotation.y.toFixed(2)} ${o.rotation.z.toFixed(2)}\n`
            + `scl  ${fmt(o.scale)}`

        el('modifier-list').innerHTML = entry.modifiers
            .map((m, i) => `<div>${i}: ${describeModifierBrief(m)}</div>`).join('')
    }

    /** Timeline: every command, what it touched, and click to rewind to just after it. */
    function refreshTimeline() {
        const results = modelling.results
        el('timeline-count').textContent = results.length ? `${results.length} commands` : ''
        const undoneFrom = modelling.history.log.find(e => e.undone)?.index ?? Infinity

        const body = el('timeline-body')
        body.innerHTML = ''
        for (const r of results.slice(-120)) {
            const row = document.createElement('div')
            row.className = 'step'
                + (r.ok ? '' : ' fail')
                + (r.index >= undoneFrom ? ' undone' : '')
            const detail = r.objects?.length
                ? r.objects.slice(0, 3).join(', ') + (r.objects.length > 3 ? ` +${r.objects.length - 3}` : '')
                : r.error ?? ''
            row.innerHTML = `<span class="n">${r.index}</span>`
                + `<span class="op">${r.op}</span>`
                + `<span class="detail">${escapeHtml(detail)}</span>`
            row.title = `${r.ms} ms — click to rewind to here`
            row.addEventListener('click', () => {
                const steps = modelling.history.log.filter(e => e.index > r.index && !e.undone).length
                if (steps > 0) send({op: 'undo', steps})
            })
            body.appendChild(row)
        }
        body.scrollTop = body.scrollHeight
    }

    function refresh() {
        refreshReference()
        refreshSelected()
        refreshTimeline()
    }

    // --- the command table, straight from the plugin ----------------------------------------------

    const opsBody = el('ops-body')
    for (const {name, description} of modelling.describeCommands()) {
        const row = document.createElement('div')
        row.className = 'op-row'
        row.innerHTML = `<code>${name}</code> ${escapeHtml(description.split('\n')[0])}`
        row.title = 'click to put a skeleton command in the console'
        row.addEventListener('click', () => {
            const def = modelling.commands.get(name)!
            const example: Record<string, unknown> = {op: name}
            for (const key of def.schema.required ?? []) example[key] = null
            inputEl.value = JSON.stringify(example)
            inputEl.focus()
        })
        opsBody.appendChild(row)
    }

    el('doc-id').textContent = modelling.document.documentId
    // Refresh on every command, not only ones typed here. A script or an agent driving the same
    // plugin must move the same panels, otherwise the shared surface is only shared in principle.
    modelling.addEventListener('commandRun', () => {
        refresh()
        viewer.setDirty()
    })
    picking.addEventListener('selectedObjectChanged', refreshSelected)

    // Start with something on screen, through the API like everything else.
    await modelling.run({op: 'primitive', type: 'cube', name: 'hull', width: 2.4, height: 0.9, depth: 6})
    await modelling.run({op: 'camera', view: 'iso', fit: '*'})
    refresh()
    print('ready — type a command, or open Commands on the right', 'ok')

    Object.assign(window as never, {viewer, modelling, picking})
}

function describeModifierBrief(m: {type: string, mode?: string, count?: number, axis?: unknown}): string {
    return m.type === 'array' ? `array ${m.mode} ×${m.count}` : `mirror ${String(m.axis)}`
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]!))
}

/** A short build that exercises the four generators, so the page shows what the API is for. */
async function runDemo(send: (c: Command) => Promise<unknown>) {
    const wheelProfile = [[0, -0.06], [0.28, -0.06], [0.32, -0.02], [0.32, 0.02], [0.28, 0.06], [0, 0.06]]
    await send({op: 'delete', object: '*'})
    await send({op: 'primitive', type: 'cube', name: 'hull', width: 2.4, height: 0.9, depth: 6,
        position: [0, 0.75, 0], color: '#5d6b53'})
    await send({op: 'lathe', name: 'wheel', profile: wheelProfile, axis: 'x', segments: 24,
        position: [-1.25, 0.35, -2.1], color: '#3f463a'})
    await send({op: 'array', object: 'wheel', count: 6, step: [0, 0, 0.84], live: true})
    await send({op: 'duplicate', object: 'wheel', name: 'wheel-right', scale: [-1, 1, 1]})
    await send({op: 'sweep', name: 'rail', radius: 0.03, steps: 8, color: '#8a8f86',
        path: [[-1.1, 1.25, -2.4], [-1.1, 1.45, -1.6], [-1.1, 1.45, 0.4], [-1.1, 1.25, 1.2]]})
    await send({op: 'camera', view: 'iso', fit: '*'})
    await send({op: 'selftest'})
}

_testStart()
init().finally(_testFinish)
