/**
 * The shape every edit-mode *session* operator shares (`fillOps.ts`, `editmeshToolOps.ts`): the kernel
 * function is the port of Blender's `edbm_*_exec` and changes the session's BMesh in place; here we
 * snapshot, call it, and commit one labelled undo step - so the redo-last panel re-runs it exactly
 * (pop the step, `exec(newProps)`, push), as Blender's `ED_undo_operator_repeat` does.
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorResult, PropSchema} from '../registry'
import {notModalMessage, onlyInEditMessage} from './messages'

/** A session operator's kernel call: change `bm` in place, say what happened. */
export type KernelRun = (props: Record<string, unknown>, ctx: EditorContext) =>
    {ok: true, label?: string, message?: string, warning?: string, props?: Record<string, unknown>} | {ok: false, error: string}

/** Fill `props` from the schema defaults, so redo-last shows (and re-runs with) every value. */
export function withDefaults(schema: PropSchema | undefined, props: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, def] of Object.entries(schema?.properties ?? {})) if (def.default !== undefined) out[k] = def.default
    return {...out, ...props}
}

export interface SessionOps {
    /** Poll wrapper: the operator's own poll, then "no modal running". */
    ready(poll: (ctx: EditorContext) => boolean | string): (ctx: EditorContext) => boolean | string
    /** Snapshot, run, commit one undo step (see {@link sessionOps}). */
    runSession(label: string, schema: PropSchema | undefined, run: KernelRun): (ctx: EditorContext, p?: Record<string, unknown>) => OperatorResult
    /** Poll: in edit mode with at least `n` of the element counted by `count` selected, else `what`. */
    selected(count: 'vert' | 'edge' | 'face', n: number, what: string): () => boolean | string
}

export function sessionOps(engine: EditorEnginePlugin): SessionOps {
    const me = engine.meshEdit
    return {
        ready: poll => ctx => {
            const p = poll(ctx)
            return p === true ? notModalMessage(engine) : p
        },
        /**
         * A refused run changes nothing (the kernel functions return before touching the mesh where
         * Blender does); a run that failed or threw after changing the mesh is rolled back from the
         * snapshot, as Blender's `EDBM_op_finish(.., false)` / redo-state restore do.
         */
        runSession: (label, schema, run) => (ctx, p) => {
            const before = me.snapshot()
            if (!before || !me.state) return {ok: false, error: onlyInEditMessage(engine)}
            const props = withDefaults(schema, p)
            let r: ReturnType<KernelRun>
            try {
                r = run(props, ctx)
            } catch (e) {
                r = {ok: false, error: (e as Error)?.message ?? String(e)}
            }
            if (!r.ok) {
                me.revert(before)
                return {ok: false, error: r.error}
            }
            me.commit(before, r.label ?? label)
            if (r.message) engine.message('info', r.message)
            // Props the operator worked out itself (Grid Fill's span) are what the panel shows and redo reuses.
            // A warning (Blender's `RPT_WARNING`) is the engine's to show, so a redo-panel drag can hold it back.
            return {ok: true, props: {...props, ...r.props}, ...r.warning ? {warnings: [r.warning]} : {}}
        },
        selected: (count, n, what) => () => {
            const bm = me.state?.bm
            if (!bm) return onlyInEditMessage(engine)
            const have = count === 'vert' ? bm.totvertsel : count === 'edge' ? bm.totedgesel : bm.totfacesel
            return have >= n || what
        },
    }
}
