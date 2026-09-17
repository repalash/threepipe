/**
 * The command protocol.
 *
 * Every modelling action is a plain JSON object `{op, ...params}` and every result is plain JSON.
 * That single constraint is what lets one surface serve a hand-written script, a UI button, a replay
 * log and an AI agent - nothing in a command is a function reference, a class instance or a live
 * object, so a command can be logged, diffed, replayed and sent over a wire.
 *
 * Each command also carries a JSON Schema for its parameters. The schema is not decoration: it is
 * what `ModellingPlugin.describeCommands()` hands an agent as a tool list, and what validates a
 * command before it runs, so a typo fails with a useful message instead of a stack trace.
 */

import {ThreeViewer} from 'threepipe'
import {ModellingDocument} from '../document'
import type {ModellingPlugin} from '../ModellingPlugin'

/** A command as sent. `op` selects the definition; the rest are its parameters. */
export interface Command {
    op: string
    [param: string]: unknown
}

/** What a command hands back. Always serialisable. */
export interface CommandResult {
    ok: boolean
    op: string
    /** Sequence number within the session, so a log and a capture can be matched up. */
    index: number
    /** The document the command ran against. Their weakness #3: identity, explicitly. */
    documentId: string
    /** Objects the command created or changed, by name. */
    objects?: string[]
    /** Anything the command wants to return - counts, bounds, an inspection. */
    data?: unknown
    /** Non-fatal notes. A command can succeed and still have something worth saying. */
    warnings?: string[]
    /** Set when `ok` is false. */
    error?: string
    /** Milliseconds the command took, excluding any capture. */
    ms: number
}

/** The subset of JSON Schema the command table uses. */
export interface ParamSchema {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
}

export interface CommandContext {
    viewer: ThreeViewer
    doc: ModellingDocument
    plugin: ModellingPlugin
    /** Warnings collected during the command; push rather than throwing for recoverable oddities. */
    warn(message: string): void
}

/** What a command's `run` returns, before the dispatcher wraps it. */
export interface CommandOutput {
    objects?: string[]
    data?: unknown
}

export interface CommandDefinition {
    op: string
    /** One line. This is what an agent reads to choose a command, so make it say what it does. */
    summary: string
    /** Longer prose shown in generated docs and in `help`. */
    description?: string
    schema: ParamSchema
    /**
     * Whether the command changes the document. Mutating commands get an undo snapshot taken
     * around them automatically; read-only ones do not clutter the history.
     */
    mutates: boolean
    run(params: any, ctx: CommandContext): CommandOutput | void | Promise<CommandOutput | void>
}

// region schema helpers - terse declarations, real JSON Schema out

export const S = {
    number: (description: string, extra: Record<string, unknown> = {}) =>
        ({type: 'number', description, ...extra}),
    integer: (description: string, extra: Record<string, unknown> = {}) =>
        ({type: 'integer', description, ...extra}),
    string: (description: string, extra: Record<string, unknown> = {}) =>
        ({type: 'string', description, ...extra}),
    boolean: (description: string, extra: Record<string, unknown> = {}) =>
        ({type: 'boolean', description, ...extra}),
    enum: (description: string, values: readonly string[], extra: Record<string, unknown> = {}) =>
        ({type: 'string', description, enum: [...values], ...extra}),
    /** An `[x, y, z]` triple. */
    vec3: (description: string) =>
        ({type: 'array', description, items: {type: 'number'}, minItems: 3, maxItems: 3}),
    array: (description: string, items: unknown, extra: Record<string, unknown> = {}) =>
        ({type: 'array', description, items, ...extra}),
    /** One object reference, or several. Accepts a name, an id, a uuid, `name*` or `*`. */
    objectRef: (description: string) => ({
        description,
        oneOf: [{type: 'string'}, {type: 'array', items: {type: 'string'}}],
    }),
} as const

export function schema(
    properties: Record<string, unknown>, required: string[] = [],
): ParamSchema {
    return {type: 'object', properties, required, additionalProperties: false}
}

// endregion

/**
 * Check a command's parameters against its schema.
 *
 * Deliberately small: presence of required keys, rejection of unknown keys, and the handful of type
 * checks that catch real mistakes. A full JSON Schema validator would be a dependency for very
 * little - the point here is to fail with "unknown parameter `radiusTop`, did you mean
 * `radiusTop`?" instead of silently ignoring it, which is the failure mode that wastes an agent's
 * whole session.
 */
export function validateParams(def: CommandDefinition, params: Record<string, unknown>): string[] {
    const errors: string[] = []
    const props = def.schema.properties
    for (const key of def.schema.required ?? []) {
        if (params[key] === undefined) errors.push(`missing required parameter "${key}"`)
    }
    for (const key of Object.keys(params)) {
        if (key === 'op' || key === 'id' || key === 'comment') continue
        if (props[key]) {
            const err = checkType(key, params[key], props[key] as Record<string, unknown>)
            if (err) errors.push(err)
            continue
        }
        const near = nearest(key, Object.keys(props))
        errors.push(`unknown parameter "${key}" for op "${def.op}"`
            + (near ? ` - did you mean "${near}"?` : `. Valid: ${Object.keys(props).join(', ')}`))
    }
    return errors
}

function checkType(key: string, value: unknown, spec: Record<string, unknown>): string | null {
    if (value === undefined || value === null) return null
    const type = spec.type as string | undefined
    if (type === 'number' || type === 'integer') {
        if (typeof value !== 'number' || !isFinite(value)) return `"${key}" must be a finite number`
        if (type === 'integer' && !Number.isInteger(value)) return `"${key}" must be a whole number`
    } else if (type === 'string') {
        if (typeof value !== 'string') return `"${key}" must be a string`
        const allowed = spec.enum as string[] | undefined
        if (allowed && !allowed.includes(value)) {
            return `"${key}" must be one of: ${allowed.join(', ')} (got "${value}")`
        }
    } else if (type === 'boolean') {
        if (typeof value !== 'boolean') return `"${key}" must be true or false`
    } else if (type === 'array') {
        if (!Array.isArray(value)) return `"${key}" must be an array`
        const min = spec.minItems as number | undefined
        const max = spec.maxItems as number | undefined
        if (min !== undefined && value.length < min) return `"${key}" needs at least ${min} entries`
        if (max !== undefined && value.length > max) return `"${key}" takes at most ${max} entries`
    }
    return null
}

/** Levenshtein-nearest key, for the "did you mean" hint. Only suggests a genuinely close match. */
function nearest(key: string, candidates: string[]): string | null {
    let best: string | null = null
    let bestScore = Infinity
    for (const c of candidates) {
        const d = distance(key.toLowerCase(), c.toLowerCase())
        if (d < bestScore) {
            bestScore = d
            best = c
        }
    }
    return best && bestScore <= Math.max(2, Math.floor(key.length / 3)) ? best : null
}

function distance(a: string, b: string): number {
    const prev = new Array<number>(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0]
        prev[0] = i
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j]
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
            diag = tmp
        }
    }
    return prev[b.length]
}
