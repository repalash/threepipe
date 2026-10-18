import {describe, expect, it} from 'vitest'
import {commandsOf, parseCommands} from './transcript'

describe('transcripts', () => {
    it('reads a session transcript, a command list, one command, and JSONL', () => {
        const a = {op: 'primitive', type: 'cube'}
        const b = {op: 'inset', object: 'cube'}
        expect(commandsOf({summary: {}, operations: [{command: a, result: {ok: true}}, {command: b}]})).toEqual([a, b])
        expect(commandsOf([a, b])).toEqual([a, b])
        expect(commandsOf(a)).toEqual([a])
        expect(parseCommands(JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n')).toEqual([a, b])
        expect(parseCommands('  ')).toEqual([])
    })

    it('says which entry is not a command', () => {
        expect(() => commandsOf([{op: 'a'}, {type: 'cube'}])).toThrow('entry 1 is not a command')
        expect(() => parseCommands('{"op": "a"}\nnot json')).toThrow('line 2 is not valid JSON')
    })
})
