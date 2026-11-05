import {ThreeViewer} from 'threepipe'
import {redact} from './redact'

type Level = 'warn' | 'error'
type ConsoleFn = (...args: unknown[]) => void

/** One argument of a console call as text: an Error as its message and first frame, an object as JSON. */
export function formatArg(a: unknown): string {
    if (typeof a === 'string') return a
    if (a instanceof Error) {
        const frame = a.stack?.split('\n').map(l => l.trim()).find(l => /^at\s/.test(l) || /@\S+:\d+/.test(l))
        return `${a.name}: ${a.message}${frame ? ` (${frame})` : ''}`
    }
    if (typeof a === 'object' && a !== null) {
        try {
            const s = JSON.stringify(a, (_k, v) => typeof v === 'bigint' ? String(v) : v)
            if (s !== undefined) return s.length > 300 ? s.slice(0, 300) + '…' : s
        } catch { /* a cycle: the type name below */ }
        return `[${a.constructor?.name || 'object'}]`
    }
    return String(a)
}

/**
 * The last warnings and errors of the page, redacted as they arrive: what `console.warn` / `console.error`
 * and threepipe's `ThreeViewer.Console` printed, and the uncaught errors the plugin records itself.
 *
 * `install` wraps the console functions and `uninstall` puts back what it found, unless something else
 * wrapped them after it (then theirs stays in place, and this one only passes calls on).
 */
export class LogBuffer {
    private _lines: string[] = []
    private _installed: {consoleWarn: ConsoleFn, consoleError: ConsoleFn, tpWarn: ConsoleFn, tpError: ConsoleFn, mine: Record<string, ConsoleFn>} | null = null
    private _recording = false

    constructor(public size = 200, public lineMax = 1000) {}

    /** Oldest first. */
    get lines(): string[] {
        return this._lines.slice()
    }

    clear(): void {
        this._lines = []
    }

    push(level: Level | 'info', text: string): void {
        const t = new Date()
        const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`
        this._lines.push(redact(`${time} ${level}: ${text}`).slice(0, this.lineMax))
        if (this._lines.length > this.size) this._lines.splice(0, this._lines.length - this.size)
    }

    install(): void {
        if (this._installed) return
        const record = (level: Level, original: ConsoleFn): ConsoleFn => (...args: unknown[]) => {
            // A console call made while recording one (a getter that logs) is passed on, not recorded twice.
            if (this._installed && !this._recording) {
                this._recording = true
                try { this.push(level, args.map(formatArg).join(' ')) } catch { /* recording must never break the page */ }
                this._recording = false
            }
            original(...args)
        }
        const c = ThreeViewer.Console
        const saved = {consoleWarn: console.warn, consoleError: console.error, tpWarn: c.warn, tpError: c.error}
        const mine = {
            consoleWarn: record('warn', saved.consoleWarn), consoleError: record('error', saved.consoleError),
            // ThreeViewer.Console holds console.warn as bound when threepipe loaded, so wrapping console.warn
            // does not reach it; it is wrapped on its own. The two never record one call twice: threepipe's
            // calls the original console function, not the wrapped one.
            tpWarn: record('warn', saved.tpWarn), tpError: record('error', saved.tpError),
        }
        console.warn = mine.consoleWarn
        console.error = mine.consoleError
        ThreeViewer.Console = {...c, warn: mine.tpWarn, error: mine.tpError}
        this._installed = {...saved, mine}
    }

    uninstall(): void {
        const s = this._installed
        if (!s) return
        if (console.warn === s.mine.consoleWarn) console.warn = s.consoleWarn
        if (console.error === s.mine.consoleError) console.error = s.consoleError
        const c = ThreeViewer.Console
        if (c.warn === s.mine.tpWarn && c.error === s.mine.tpError) ThreeViewer.Console = {...c, warn: s.tpWarn, error: s.tpError}
        this._installed = null
    }
}
