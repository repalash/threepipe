/**
 * Type-level tests for the graph system.
 * Lines marked "@ts-expect-error" MUST produce a TS error.
 * If they don't, the directive itself errors as "Unused" — signaling a broken check.
 *
 * Run: npx tsc --noEmit --project plugins/procedural-generation/tests/tsconfig.json
 */

import {defineNode, defineNodeType, defineGraph, connect} from '../src/graph'

const source = defineNode('source',
    {x: 0},
    {num: 0, text: '', arr: [] as number[]},
    (inp) => ({num: inp.x * 2, text: String(inp.x), arr: [inp.x]}),
)

const numConsumer = defineNode('numConsumer',
    {val: 0},
    {out: 0},
    (inp) => ({out: inp.val + 1}),
)

const textConsumer = defineNode('textConsumer',
    {val: ''},
    {out: ''},
    (inp) => ({out: inp.val.toUpperCase()}),
)

// ─── Valid connections (should compile) ─────────────────────────────

connect(source, 'num', numConsumer, 'val')
connect(source, 'text', textConsumer, 'val')

// ─── Invalid key names (should NOT compile) ─────────────────────────

// @ts-expect-error — 'typo' is not an output of source
connect(source, 'typo', numConsumer, 'val')

// @ts-expect-error — 'typo' is not an input of numConsumer
connect(source, 'num', numConsumer, 'typo')

// ─── Valid graph (should compile) ───────────────────────────────────

defineGraph(
    [source, numConsumer, textConsumer],
    [
        connect(source, 'num', numConsumer, 'val'),
        connect(source, 'text', textConsumer, 'val'),
    ],
)

// ─── PropDef inputs (should compile) ────────────────────────────────

const withPropDef = defineNode('withPropDef',
    {seed: {default: 42, ui: {label: 'Seed', bounds: [0, 999]}}},
    {out: 0},
    (inp) => ({out: inp.seed * 2}),
)

connect(source, 'num', withPropDef, 'seed')

// ─── Value type mismatches (should NOT compile) ─────────────────────

// @ts-expect-error — number output to string input
connect(source, 'num', textConsumer, 'val')

// @ts-expect-error — string output to number input
connect(source, 'text', numConsumer, 'val')

const arrConsumer = defineNode('arrConsumer',
    {val: [] as number[]},
    {out: 0},
    (inp) => ({out: inp.val.length}),
)

// @ts-expect-error — number[] output to number input
connect(source, 'arr', numConsumer, 'val')

// @ts-expect-error — number output to number[] input
connect(source, 'num', arrConsumer, 'val')

// @ts-expect-error — string output to PropDef<number> input
connect(source, 'text', withPropDef, 'seed')

// ─── defineNodeType ──────────────────────────────────────────────────

// Define a node type once
const adderType = defineNodeType(
    {x: 0, y: 0, label: {default: 'sum', ui: {label: 'Label'}}},
    {sum: 0, desc: ''},
    (inp) => ({sum: inp.x + inp.y, desc: `${inp.label}: ${inp.x + inp.y}`}),
)

// Create instances with overrides (should compile)
const adder1 = adderType('Adder 1', {x: 10, y: 20})
const adder2 = adderType('Adder 2', {label: 'total'})
const adder3 = adderType('Adder 3') // no overrides — all defaults

// Override with wrong value type (should NOT compile)
// @ts-expect-error — x is number, not string
adderType('Bad', {x: 'hello'})

// @ts-expect-error — label is string (PropDef<string>), not number
adderType('Bad', {label: 42})

// @ts-expect-error — nonexistent key
adderType('Bad', {nonexistent: 0})

// Instances are regular NodeDefs — connect works
connect(source, 'num', adder1, 'x')   // number → number ✓
connect(source, 'text', adder1, 'label') // string → string (PropDef<string>) ✓

// @ts-expect-error — string → number
connect(source, 'text', adder1, 'x')

// Multiple instances have the same type — can connect to same downstream
const collector = defineNode('collector', {a: 0, b: 0}, {total: 0}, (inp) => ({total: inp.a + inp.b}))
connect(adder1, 'sum', collector, 'a')  // ✓
connect(adder2, 'sum', collector, 'b')  // ✓

console.log('All type checks passed')
