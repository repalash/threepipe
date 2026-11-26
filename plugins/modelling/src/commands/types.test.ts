import {describe, expect, it} from 'vitest'
import {CommandDefinition, S, schema, validateParams} from './types'
import {CommandRegistry} from './registry'

const def: CommandDefinition = {
    op: 'demo',
    summary: 'A command for testing.',
    mutates: true,
    schema: schema({
        name: S.string('A name.'),
        count: S.integer('How many.', {minimum: 1}),
        size: S.number('How big.'),
        on: S.boolean('On or off.'),
        mode: S.enum('Which mode.', ['fast', 'slow']),
        point: S.vec3('A point.'),
    }, ['name']),
    run: () => undefined,
}

describe('parameter validation', () => {
    it('accepts a well formed command', () => {
        expect(validateParams(def, {name: 'a', count: 2, size: 1.5, on: true, mode: 'fast', point: [1, 2, 3]}))
            .toEqual([])
    })

    it('reports a missing required parameter', () => {
        expect(validateParams(def, {count: 1})).toContain('missing required parameter "name"')
    })

    it('rejects an unknown parameter and suggests the nearest real one', () => {
        const [error] = validateParams(def, {name: 'a', coutn: 3})
        expect(error).toContain('unknown parameter "coutn"')
        expect(error).toContain('did you mean "count"')
    })

    it('lists the valid parameters when nothing is close', () => {
        const [error] = validateParams(def, {name: 'a', wildlyDifferentThing: 3})
        expect(error).toContain('Valid: name, count, size, on, mode, point')
    })

    it('rejects a wrong type with the parameter named', () => {
        expect(validateParams(def, {name: 'a', count: 'two'})[0]).toBe('"count" must be a finite number')
        expect(validateParams(def, {name: 'a', count: 1.5})[0]).toBe('"count" must be a whole number')
        expect(validateParams(def, {name: 'a', size: NaN})[0]).toBe('"size" must be a finite number')
        expect(validateParams(def, {name: 'a', on: 'yes'})[0]).toBe('"on" must be true or false')
    })

    it('rejects a value outside an enum, and says what is allowed', () => {
        expect(validateParams(def, {name: 'a', mode: 'medium'})[0])
            .toBe('"mode" must be one of: fast, slow (got "medium")')
    })

    it('checks array lengths', () => {
        expect(validateParams(def, {name: 'a', point: [1, 2]})[0]).toBe('"point" needs at least 3 entries')
        expect(validateParams(def, {name: 'a', point: [1, 2, 3, 4]})[0]).toBe('"point" takes at most 3 entries')
    })

    it('allows the annotation keys a log or an agent adds', () => {
        expect(validateParams(def, {name: 'a', id: 'step-3', comment: 'the hull'})).toEqual([])
    })

    it('treats an explicit null or undefined as absent rather than mistyped', () => {
        expect(validateParams(def, {name: 'a', count: undefined})).toEqual([])
    })
})

describe('the registry', () => {
    it('describes commands in the shape a tool list takes', () => {
        const registry = new CommandRegistry()
        registry.register(def)
        const [described] = registry.describe()
        expect(described.name).toBe('demo')
        expect(described.description).toBe('A command for testing.')
        expect((described.inputSchema as {required: string[]}).required).toEqual(['name'])
    })

    it('joins the summary and the long description', () => {
        const registry = new CommandRegistry()
        registry.register({...def, description: 'More detail.'})
        expect(registry.describe()[0].description).toBe('A command for testing.\n\nMore detail.')
    })

    it('refuses to register the same op twice, but allows a deliberate override', () => {
        const registry = new CommandRegistry()
        registry.register(def)
        expect(() => registry.register(def)).toThrow(/already registered/)
        registry.override({...def, summary: 'Replaced.'})
        expect(registry.get('demo')!.summary).toBe('Replaced.')
    })

    it('suggests a near miss for an unknown op', () => {
        const registry = new CommandRegistry()
        registry.register(def)
        expect(registry.suggest('demoo')).toBe('demo')
        expect(registry.suggest('somethingelseentirely')).toBe(null)
    })
})
