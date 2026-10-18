/**
 * Transcripts: what `npm run modelling:session` writes (`{summary, operations: [{command, result}]}`), a
 * bare list of commands, or a JSONL file of them. All three replay the same way.
 */

import type {Command} from './commands/types'

/** The commands of a transcript, in order. Throws with a readable message on anything else. */
export function commandsOf(input: unknown): Command[] {
    let list: unknown[]
    if (Array.isArray(input)) list = input
    else if (input && typeof input === 'object' && Array.isArray((input as {operations?: unknown}).operations)) {
        list = (input as {operations: {command?: unknown}[]}).operations.map(o => o?.command ?? o)
    } else if (input && typeof input === 'object' && typeof (input as {op?: unknown}).op === 'string') {
        list = [input]
    } else {
        throw new Error('expected a command, a list of commands, or a transcript {operations: [{command}]}')
    }
    return list.map((c, i) => {
        if (!c || typeof c !== 'object' || typeof (c as {op?: unknown}).op !== 'string') {
            throw new Error(`entry ${i} is not a command - it needs an "op"`)
        }
        return c as Command
    })
}

/** Parse JSON or JSONL text into commands. */
export function parseCommands(text: string): Command[] {
    const trimmed = text.trim()
    if (!trimmed) return []
    try {
        return commandsOf(JSON.parse(trimmed))
    } catch (e) {
        const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length < 2) throw e
        return commandsOf(lines.map((l, i) => {
            try {
                return JSON.parse(l)
            } catch {
                throw new Error(`line ${i + 1} is not valid JSON`)
            }
        }))
    }
}
