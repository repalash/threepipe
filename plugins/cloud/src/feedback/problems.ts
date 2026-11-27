/**
 * Problems: what went wrong in the page, in the shape a report's `cause` takes, with a fingerprint that
 * names the same problem across occurrences, and the per-session rule for when to tell the person.
 */
import {redact} from './redact'

/** Where a problem came from. `operation` is an app's failed command or tool (`reportError`). */
export type ProblemKind = 'error' | 'unhandled-rejection' | 'context-lost' | 'operation'

export interface Problem {
    kind: ProblemKind
    /** One line, redacted. */
    message: string
    /** The top stack frame, redacted ('at bevel (editor.js:12:3)'). */
    frame?: string
    /** A file extension the problem concerns (an import that failed), lower case. */
    ext?: string
    /** Same problem, same fingerprint: the kind, the message without numbers, quotes or paths, and the frame's function. */
    fingerprint: string
    /** When it happened (ms since the epoch). */
    at: number
}

/** The first frame of a stack that is not the message line itself. */
export function topFrame(stack: string | undefined): string | undefined {
    if (!stack) return undefined
    const lines = stack.split('\n').map(l => l.trim()).filter(Boolean)
    // V8: 'Error: msg' then 'at fn (file:line:col)'; Firefox/Safari: 'fn@file:line:col'.
    const frame = lines.find(l => /^at\s/.test(l) || /@\S+:\d+/.test(l))
    return frame?.slice(0, 200)
}

/** The message with what changes between occurrences taken out: numbers, quoted parts, paths, file names. */
export function normalizeMessage(s: string | undefined): string {
    return (s || '').toLowerCase()
        .replace(/<[^>]*>/g, '').replace(/["'`].*?["'`]/g, '').replace(/[\w.-]*[/\\][\w./\\-]*/g, '')
        .replace(/[\w-]+\.[a-z0-9]{1,8}\b/g, '')
        .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** The function name of a frame, which survives rebuilds; its file and line do not. */
function frameFunction(frame: string | undefined): string {
    if (!frame) return ''
    const v8 = /^at\s+(?:async\s+)?([^\s(]+)\s*\(/.exec(frame)
    if (v8) return v8[1]
    const ff = /^([^@\s]*)@/.exec(frame)
    return ff ? ff[1] : ''
}

/** FNV-1a, 32 bits, as 8 hex characters: short, stable, synchronous. */
export function fnv1a(s: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
}

export function fingerprint(kind: string, message: string | undefined, frame?: string): string {
    return fnv1a(`${kind}|${normalizeMessage(message)}|${frameFunction(frame)}`)
}

/** A problem from anything that was thrown or rejected, or a message. */
export function problemOf(kind: ProblemKind, reason: unknown, extra: {ext?: string} = {}): Problem {
    let message: string
    let stack: string | undefined
    if (reason instanceof Error) {
        message = `${reason.name && reason.name !== 'Error' ? reason.name + ': ' : ''}${reason.message}`
        stack = reason.stack
    } else if (typeof reason === 'string') message = reason
    else if (reason && typeof reason === 'object' && typeof (reason as {message?: unknown}).message === 'string') message = (reason as {message: string}).message
    else {
        try { message = JSON.stringify(reason) ?? String(reason) } catch { message = String(reason) }
    }
    message = redact(message.split('\n')[0].slice(0, 300))
    const frame = topFrame(stack)
    const redactedFrame = frame ? redact(frame) : undefined
    const ext = extra.ext && /^[a-z0-9]{1,8}$/i.test(extra.ext) ? extra.ext.toLowerCase() : undefined
    return {kind, message, frame: redactedFrame, ext, fingerprint: fingerprint(kind, message, redactedFrame), at: Date.now()}
}

/**
 * Which problems the person is told about: each fingerprint once per session, and at most `max` in all,
 * so a render loop that throws every frame shows one toast, not hundreds.
 */
export class ProblemGate {
    private _seen = new Set<string>()
    private _shown = 0
    constructor(public max = 5) {}

    /** True when this problem should be shown; records it either way. */
    admit(p: Problem): boolean {
        if (this._seen.has(p.fingerprint)) return false
        this._seen.add(p.fingerprint)
        if (this._shown >= this.max) return false
        this._shown++
        return true
    }

    get shown(): number {
        return this._shown
    }
}
