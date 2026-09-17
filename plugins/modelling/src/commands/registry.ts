/**
 * The command table.
 *
 * A registry rather than a `switch` for two reasons: a plugin or an example can add a command
 * without editing this package, and the table can be enumerated - which is what turns it into an
 * agent tool list and into generated documentation without a second, hand-written copy that drifts.
 */

import {CommandDefinition} from './types'

export class CommandRegistry {
    private _commands = new Map<string, CommandDefinition>()

    register(def: CommandDefinition): void {
        if (this._commands.has(def.op)) throw new Error(`command "${def.op}" is already registered`)
        this._commands.set(def.op, def)
    }

    registerAll(defs: CommandDefinition[]): void {
        for (const d of defs) this.register(d)
    }

    /** Replace an existing command. Used by extensions that specialise a built-in. */
    override(def: CommandDefinition): void {
        this._commands.set(def.op, def)
    }

    get(op: string): CommandDefinition | undefined {
        return this._commands.get(op)
    }

    get ops(): string[] {
        return [...this._commands.keys()].sort()
    }

    all(): CommandDefinition[] {
        return [...this._commands.values()]
    }

    /**
     * The table as tool definitions: `{name, description, inputSchema}`.
     *
     * This is the shape an LLM tool list wants, and the shape the editor's existing MCP bridge
     * already expects, so the bridge becomes a thin wrapper over this rather than a second
     * hand-maintained list of tools.
     */
    describe(): {name: string, description: string, inputSchema: unknown}[] {
        return this.all()
            .sort((a, b) => a.op.localeCompare(b.op))
            .map(d => ({
                name: d.op,
                description: d.description ? `${d.summary}\n\n${d.description}` : d.summary,
                inputSchema: d.schema,
            }))
    }

    /** The nearest registered op name, for an unknown-command error message. */
    suggest(op: string): string | null {
        let best: string | null = null
        let bestScore = Infinity
        for (const name of this._commands.keys()) {
            const d = levenshtein(op.toLowerCase(), name.toLowerCase())
            if (d < bestScore) {
                bestScore = d
                best = name
            }
        }
        return best && bestScore <= 3 ? best : null
    }
}

function levenshtein(a: string, b: string): number {
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
