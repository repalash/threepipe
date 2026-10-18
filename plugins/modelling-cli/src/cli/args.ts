/**
 * Argument parsing for `threepipe-modelling`: a verb, positionals, and `--flags`.
 *
 * Flags the CLI itself uses are kept apart; every other `--key value` becomes a command parameter, with
 * the value read as JSON when it parses (`--count 3`, `--step [2,0,0]`, `--spec '{"volume":8}'`) and as a
 * string otherwise (`--object hull`).
 */

export const GLOBAL_FLAGS = new Set([
    'doc', 'out', 'no-save', 'connect', 'token', 'page', 'browser', 'document-id', 'pretty', 'continue-on-error',
    'width', 'height', 'ws', 'port', 'host', 'headed', 'out-dir', 'help',
])

export interface ParsedArgs {
    verb: string | null
    positional: string[]
    flags: Map<string, string | true>
    params: Record<string, unknown>
}

function value(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

export function parseArgs(argv: string[]): ParsedArgs {
    const flags = new Map<string, string | true>()
    const params: Record<string, unknown> = {}
    const positional: string[] = []
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a.startsWith('--') && a.length > 2) {
            let key = a.slice(2)
            let raw: string | undefined
            const eq = key.indexOf('=')
            if (eq >= 0) {
                raw = key.slice(eq + 1)
                key = key.slice(0, eq)
            } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
                raw = argv[++i]
            }
            if (GLOBAL_FLAGS.has(key)) flags.set(key, raw ?? true)
            else params[key] = raw === undefined ? true : value(raw)
        } else positional.push(a)
    }
    return {verb: positional.shift() ?? null, positional, flags, params}
}
