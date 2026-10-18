import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {Command, CommandResult, ModellingPlugin, parseCommands} from '@threepipe/plugin-modelling'

/**
 * Replay a modelling transcript in the editor, one command at a time.
 *
 * A transcript is what `npm run modelling:session` writes (`{operations: [{command, result}]}`), a plain
 * list of commands, or a `.jsonl` file of them - the same JSON an agent sends over the agent socket or
 * the CLI. Each one goes through `ModellingPlugin.run`, so each lands in the editor's undo history and
 * can be stepped back through there, exactly as if a person had done it.
 *
 * The default is the Eiffel tower build (`examples/modelling-api/builds/eiffel-tower.transcript.json`).
 * `?transcript=<url>` replays another; Open… or a file dropped on the page replays a local one.
 * `?autoplay=0` loads without running.
 */

const DEFAULT_TRANSCRIPT = '../modelling-api/builds/eiffel-tower.transcript.json'

interface ReplayState {
    name: string
    commands: Command[]
    next: number
    failed: {index: number, command: Command, error: string}[]
    playing: boolean
    done: boolean
    ms: number
}

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'Replay',
        viewer: {plugins: [LoadingScreenPlugin]},
        onboarding: false,
    })
    const {viewer, engine} = editor
    const modelling = viewer.getPlugin(ModellingPlugin)!

    const el = <T extends HTMLElement>(sel: string) => document.querySelector(`[data-replay-${sel}]`) as T
    const titleEl = el('title')
    const barEl = el('bar')
    const statusEl = el('status')
    const toggleEl = el<HTMLButtonElement>('toggle')

    const state: ReplayState = {name: '', commands: [], next: 0, failed: [], playing: false, done: false, ms: 0}
    // Read by tests and by anyone curious from the console.
    Object.assign(window as never, {viewer, editor, engine, modelling, replay: state})

    function render(last?: {command: Command, result: CommandResult}) {
        const n = state.commands.length
        titleEl.textContent = `${state.name} - ${state.next}/${n}`
        barEl.style.width = n ? `${100 * state.next / n}%` : '0'
        toggleEl.textContent = state.playing ? 'Pause' : state.done ? 'Done' : 'Play'
        toggleEl.disabled = state.done
        statusEl.classList.toggle('err', !!state.failed.length)
        if (state.done) {
            statusEl.textContent = `${n} commands in ${(state.ms / 1000).toFixed(1)} s - `
                + (state.failed.length ? `${state.failed.length} failed (first: #${state.failed[0].index + 1} ${state.failed[0].command.op}: ${state.failed[0].error})` : 'no failures')
        } else if (last) {
            statusEl.textContent = `#${state.next} ${last.command.op}`
                + `${typeof last.command.object === 'string' ? ' ' + last.command.object : typeof last.command.name === 'string' ? ' ' + last.command.name : ''}`
                + (last.result.ok ? ` - ${last.result.ms} ms` : ` - ${last.result.error}`)
        } else statusEl.textContent = n ? 'Ready.' : 'No commands.'
    }

    async function stepOnce(): Promise<boolean> {
        if (state.next >= state.commands.length) return false
        const index = state.next
        const command = state.commands[index]
        const t = performance.now()
        const result = await modelling.run(command)
        state.ms += performance.now() - t
        state.next++
        if (!result.ok) state.failed.push({index, command, error: result.error ?? 'failed'})
        render({command, result})
        if (state.next >= state.commands.length) await finish()
        return true
    }

    async function finish() {
        state.done = true
        state.playing = false
        await modelling.run({op: 'camera', view: 'iso', fit: '*'})
        // The replay is the document's starting point, not an unsaved edit.
        engine.file.markClean()
        render()
        console.log('replay finished', {commands: state.commands.length, failed: state.failed})
    }

    let loop: Promise<void> | null = null
    function play() {
        if (state.done || loop) return
        state.playing = true
        render()
        loop = (async() => {
            while (state.playing && await stepOnce()) {
                // Let a frame draw between commands so the build is watchable - but never wait on one for
                // long: a background tab may not schedule animation frames at all.
                await new Promise(r => {
                    requestAnimationFrame(r)
                    setTimeout(r, 50)
                })
            }
            loop = null
            render()
        })()
    }

    async function load(name: string, text: string, autoplay: boolean) {
        state.playing = false
        await loop
        // Start from an empty document and an empty history: the replay is the whole story.
        engine.file.markClean()
        await engine.run('file.new')
        Object.assign(state, {name, commands: parseCommands(text), next: 0, failed: [], done: false, ms: 0})
        render()
        if (autoplay) play()
        return loop
    }

    toggleEl.onclick = () => state.playing ? (state.playing = false) : play()
    el<HTMLButtonElement>('step').onclick = () => {
        state.playing = false
        if (!loop) void stepOnce()
    }
    let source = {name: '', text: ''}
    el<HTMLButtonElement>('restart').onclick = () => void load(source.name, source.text, true)
    const openFile = async(file: File) => {
        source = {name: file.name, text: await file.text()}
        await load(source.name, source.text, true)
    }
    el<HTMLInputElement>('file').onchange = e => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) void openFile(file)
    }
    // A dropped transcript replaces the replay; anything else falls through to the editor's own drop handling.
    window.addEventListener('dragover', e => {
        if (Array.from(e.dataTransfer?.items ?? []).some(i => i.type === 'application/json' || i.type === '')) document.body.classList.add('dragging')
    })
    window.addEventListener('dragleave', () => document.body.classList.remove('dragging'))
    window.addEventListener('drop', e => {
        document.body.classList.remove('dragging')
        const file = Array.from(e.dataTransfer?.files ?? []).find(f => /\.jsonl?$/i.test(f.name))
        if (!file) return
        e.preventDefault()
        e.stopPropagation()
        void openFile(file)
    }, true)

    const params = new URLSearchParams(location.search)
    const url = params.get('transcript') ?? DEFAULT_TRANSCRIPT
    const response = await fetch(url)
    if (!response.ok) throw new Error(`could not fetch ${url}: ${response.status}`)
    source = {name: url.split('/').pop() ?? url, text: await response.text()}
    // The first replay finishes before the page reports ready, so a test sees the finished build.
    await load(source.name, source.text, params.get('autoplay') !== '0')
}

_testStart()
init().finally(_testFinish)
