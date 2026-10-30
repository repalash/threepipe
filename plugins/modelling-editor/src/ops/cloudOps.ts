/**
 * Help > Report a Problem… and Help > Send Feedback…, the header's feedback button and the Report action
 * of the error toasts, over `@threepipe/plugin-cloud` when the app adds it:
 *
 * ```ts
 * createModellingEditor({container, plugins: [new ThreepipeCloudPlugin({endpoint, turnstileSiteKey})]})
 * ```
 *
 * Without the plugin none of it shows. With it, every report carries the editor's state (mode, selection,
 * the active tool, the undo history) and the modelling command transcript, which
 * `examples/modelling-replay` replays step by step.
 */

import type {ThreeViewer} from 'threepipe'
import type {EditorEngine, OperatorDescriptor} from '@threepipe/plugin-editor-engine'
import {Command, CommandResult, ModellingPlugin} from '@threepipe/plugin-modelling'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'

/**
 * The part of `@threepipe/plugin-cloud`'s ThreepipeCloudPlugin the editor uses. The editor finds the plugin by its
 * type name when the app adds it and does not depend on the package; these types follow its API.
 */
export interface CloudProblem {
    kind: string
    /** One line, redacted. */
    message: string
    frame?: string
    ext?: string
}
interface CloudFeedback {
    surface: string
    toasts: boolean
    theme: 'light' | 'dark' | 'auto' | (() => 'light' | 'dark')
    log: {push(level: string, text: string): void}
    redactJson(value: unknown): unknown
    addContext(name: string, provider: {label: string, collect?(): unknown, file?(): {name: string, blob: Blob} | null}): () => void
    open(o: {type?: 'bug' | 'question' | 'idea', cause?: {kind: string, message?: string, frame?: string, ext?: string}}): Promise<string | null>
}
export interface CloudPlugin {
    feedback: CloudFeedback
    addEventListener(type: 'problem', listener: (e: {problem: CloudProblem, notify: boolean}) => void): void
    removeEventListener(type: 'problem', listener: (e: {problem: CloudProblem, notify: boolean}) => void): void
}

/** The transcript keeps the last this many commands. */
const TRANSCRIPT_MAX = 1000
const HISTORY_IN_CONTEXT = 30

/** The cloud plugin, when the app added it. */
export function cloudOf(viewer: ThreeViewer): CloudPlugin | undefined {
    return viewer.getPlugin('ThreepipeCloudPlugin') as CloudPlugin | undefined
}

export function registerCloudOperators(engine: EditorEngine): () => void {
    const viewer = engine.viewer
    // The transcript starts with the editor: commands run before the cloud plugin is added count too.
    const transcript: {command: Command, result: Pick<CommandResult, 'ok' | 'op' | 'error'>}[] = []
    const startedAt = new Date().toISOString()
    const modelling = viewer.getPlugin(ModellingPlugin)
    const onCommand = (e: {command: Command, result: CommandResult}) => {
        transcript.push({command: e.command, result: {ok: e.result.ok, op: e.result.op, ...(e.result.error ? {error: e.result.error} : {})}})
        if (transcript.length > TRANSCRIPT_MAX) transcript.shift()
    }
    modelling?.addEventListener('commandRun', onCommand as never)

    let unmount: (() => void) | null = null
    const mount = (cloud: CloudPlugin) => {
        const fb = cloud.feedback
        if (fb.surface === 'app') fb.surface = 'modelling-editor'
        // The editor's own (Blueprint) toasts tell the person; see ModellingEditorApp.
        fb.toasts = false
        fb.theme = () => document.querySelector('.bp5-dark, .bp6-dark') ? 'dark' : 'light'

        const removeContext = fb.addContext('editor', {
            label: 'Editor state (mode, selection, undo history) and the command transcript, which replays the session',
            collect: () => {
                const ctx = engine.context()
                const bm = engine.mode === 'edit' ? viewer.getPlugin(MeshEditPlugin)?.state?.bm : undefined
                return {
                    mode: engine.mode,
                    selectMode: engine.selectMode,
                    tool: engine.activeTool?.id ?? null,
                    keymap: engine.keymap.activePreset.id,
                    objects: engine.modelObjects().length,
                    selected: ctx.selectedObjects.length,
                    ...(bm ? {elements: {verts: bm.totvert, edges: bm.totedge, faces: bm.totface}, selectedElements: {verts: bm.totvertsel, edges: bm.totedgesel, faces: bm.totfacesel}} : {}),
                    history: engine.history.entries().slice(-HISTORY_IN_CONTEXT).map(h => h.label + (h.undone ? ' (undone)' : '')),
                    unsaved: engine.file.dirty,
                    commands: transcript.length,
                }
            },
            file: () => transcript.length ? {
                name: 'transcript.json',
                // The shape `npm run modelling:session` writes; `commandsOf` (plugin-modelling) reads it back.
                blob: new Blob([JSON.stringify({summary: {startedAt, commands: transcript.length, failed: transcript.filter(t => !t.result.ok).length},
                    operations: transcript.map(t => ({command: fb.redactJson(t.command), result: t.result}))}, null, 1)], {type: 'application/json'}),
            } : null,
        })

        // A failed operator is in the report's log, as the console's errors are.
        const onMessage = (e: {level: string, text: string}) => { if (e.level === 'error') fb.log.push('error', `operation: ${e.text}`) }
        engine.addEventListener('message', onMessage as never)

        const open = (props: Record<string, unknown> | undefined, type: 'bug' | 'idea') => {
            const cause = props?.cause as CloudProblem | undefined
            // The dialog owns the keyboard while it is open; the editor's keys stand down.
            engine.input.suspend('cloud-feedback')
            void fb.open({type: cause ? 'bug' : type, cause}).finally(() => engine.input.resume('cloud-feedback'))
            return {ok: true as const}
        }
        const ops: OperatorDescriptor[] = [
            {
                id: 'help.report_problem', label: 'Report a Problem…', icon: 'error', category: 'Help',
                description: 'Tell the threepipe team what went wrong, with a screenshot, the log and the steps so far.',
                exec: (_ctx, props) => open(props, 'bug'),
            },
            {
                id: 'help.send_feedback', label: 'Send Feedback…', icon: 'chat', category: 'Help',
                description: 'An idea, a question or anything else for the threepipe team.',
                exec: (_ctx, props) => open(props, 'idea'),
            },
        ]
        const disposers = ops.map(op => engine.operators.register(op))
        unmount = () => {
            for (const d of disposers) d()
            engine.removeEventListener('message', onMessage as never)
            removeContext()
            unmount = null
        }
    }
    viewer.forPlugin('ThreepipeCloudPlugin', p => mount(p as unknown as CloudPlugin), () => unmount?.())
    return () => {
        unmount?.()
        modelling?.removeEventListener('commandRun', onCommand as never)
    }
}
