import {describe, expect, it} from 'vitest'
import {primitiveCone, MeshData} from '@threepipe/mesh-kernel'
import {
    checkModifier, describeModifier, evaluateModifierStack, evaluateModifiers, getModifierType,
    ModifierSpec, readModifier, registerModifierType, unregisterModifierType,
} from '../src/modifiers'
import {modifierCommand} from '../src/commands/modifiers'

const cube = () => primitiveCone({segments: 4, radiusTop: 1, radiusBottom: 1, depth: 1})

describe('modifier types', () => {
    it('keeps the built-ins on the registry', () => {
        for (const t of ['array', 'mirror', 'wireframe']) expect(getModifierType(t)).toBeDefined()
        expect(describeModifier({type: 'mirror', axis: 'y'})).toBe('mirror y')
        // `mode` is still inferred from the fields given.
        expect(readModifier({type: 'array', count: 3, angle: 1})).toMatchObject({mode: 'radial'})
    })

    it('rejects an unknown type instead of evaluating it as something else', () => {
        expect(() => checkModifier({type: 'nope'})).toThrow(/unknown modifier type "nope" - registered: array, mirror, wireframe/)
        expect(() => evaluateModifiers(cube(), [{type: 'nope'}])).toThrow(/unknown modifier type/)
        expect(describeModifier({type: 'nope'})).toBe('nope (not registered)')
    })

    it('evaluates a registered type in stack order, with its context and extra geometry', () => {
        const seen: {index: number, verts: number, state: boolean}[] = []
        registerModifierType<{type: 'scaleX', factor: number}>({
            type: 'scaleX',
            properties: {factor: {type: 'number'}},
            check(spec) {
                if (!(spec.factor > 0)) throw new Error('factor must be positive')
            },
            describe: spec => `scale x ${spec.factor}`,
            evaluate(mesh, spec, ctx) {
                seen.push({index: ctx.index, verts: mesh.vertsNum, state: ctx.state instanceof Map})
                const out = mesh.clone()
                for (let i = 0; i < out.vertsNum; i++) out.positions[i * 3] *= spec.factor
                return {mesh: out, geometry: {note: `scaled by ${spec.factor}`}}
            },
        })
        try {
            const stack: ModifierSpec[] = [{type: 'mirror', axis: 'x'}, {type: 'scaleX', factor: 2}]
            const master = cube()
            const result = evaluateModifierStack(master, stack)
            expect(seen).toEqual([{index: 1, verts: evaluateModifiers(master, stack.slice(0, 1)).vertsNum, state: true}])
            expect(result.geometry).toEqual({note: 'scaled by 2'})
            expect(result.mesh).toBeInstanceOf(MeshData)
            expect(() => checkModifier({type: 'scaleX', factor: 0})).toThrow('factor must be positive')
            expect(() => registerModifierType({type: 'scaleX', check() {}, describe: () => '', evaluate: m => m})).toThrow(/already registered/)
            // The `modifier` command's `add` schema lists it, with its fields.
            const add = modifierCommand.schema.properties.add as {properties: Record<string, {enum?: string[]}>}
            expect(add.properties.type.enum).toContain('scaleX')
            expect(add.properties.factor).toEqual({type: 'number'})
        } finally {
            unregisterModifierType('scaleX')
        }
        const add = modifierCommand.schema.properties.add as {properties: Record<string, {enum?: string[]}>}
        expect(add.properties.type.enum).toEqual(['array', 'mirror', 'wireframe', 'subsurf', 'weightedNormal'])
        // A field two types share keeps both enums (array's and weightedNormal's `mode`).
        expect(add.properties.mode.enum).toEqual(['linear', 'radial', 'curve', 'FACE_AREA', 'CORNER_ANGLE', 'FACE_AREA_WITH_ANGLE'])
    })

    it('passes extra geometry down the stack and realizes it on apply', () => {
        const previous: unknown[] = []
        registerModifierType<{type: 'withExtra'}>({
            type: 'withExtra',
            check() {},
            describe: () => 'with extra',
            evaluate(mesh, _spec, ctx) {
                previous.push(ctx.previous?.geometry)
                // Applying bakes the final mesh plus one more vertex (a stand-in for realized instances).
                return {mesh, geometry: {extra: true}, realize: m => {
                    const out = m.clone()
                    out.resize({verts: out.vertsNum + 1})
                    return out
                }}
            },
        })
        try {
            const stack: ModifierSpec[] = [{type: 'withExtra'} as ModifierSpec, {type: 'mirror', axis: 'x'}, {type: 'withExtra'} as ModifierSpec]
            const result = evaluateModifierStack(cube(), stack)
            // The mesh-only mirror keeps the geometry; the next modifier sees it as `previous`.
            expect(previous).toEqual([undefined, {extra: true}])
            expect(result.geometry).toEqual({extra: true})
            expect(result.realize).toBeTypeOf('function')
            const mirrored = evaluateModifierStack(cube(), stack.slice(0, 2))
            expect(mirrored.geometry).toEqual({extra: true})
            expect(mirrored.realize).toBeTypeOf('function')
        } finally {
            unregisterModifierType('withExtra')
        }
    })
})
