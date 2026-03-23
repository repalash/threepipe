import {defineNode, defineNodeType, defineGraph, connect, createRuntime, resolveDefault, resolveUi} from '../src/graph'

// ─── Test harness ───────────────────────────────────────────────────

let passed = 0, failed = 0

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`  \x1b[31mFAIL\x1b[0m: ${msg}`)
        failed++
    } else {
        console.log(`  \x1b[32mPASS\x1b[0m: ${msg}`)
        passed++
    }
}

function assertEq(actual: any, expected: any, msg: string) {
    assert(actual === expected, `${msg} (expected ${expected}, got ${actual})`)
}

function section(name: string) {
    console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ─── Test 1: Linear chain ───────────────────────────────────────────

section('Test 1: Linear chain (A → B → C)')

const nodeA = defineNode('A', {x: 0}, {doubled: 0}, (inp) => ({doubled: inp.x * 2}))
const nodeB = defineNode('B', {val: 0}, {plusTen: 0}, (inp) => ({plusTen: inp.val + 10}))
const nodeC = defineNode('C', {val: 0}, {text: ''}, (inp) => ({text: inp.val.toString()}))

const graph1 = defineGraph(
    [nodeA, nodeB, nodeC],
    [
        connect(nodeA, 'doubled', nodeB, 'val'),
        connect(nodeB, 'plusTen', nodeC, 'val'),
    ],
)

const rt1 = createRuntime(graph1)
rt1.set(nodeA, 'x', 5)
let computed = rt1.evaluate()
assertEq(rt1.get(nodeC, 'text'), '20', 'C outputs "20" for x=5 (5*2=10, 10+10=20)')
assertEq(computed, 3, 'All 3 nodes computed on first run')

rt1.set(nodeA, 'x', 5)
computed = rt1.evaluate()
assertEq(computed, 0, 'Setting same value does not dirty')

rt1.set(nodeA, 'x', 7)
computed = rt1.evaluate()
assertEq(rt1.get(nodeC, 'text'), '24', 'C outputs "24" for x=7 (7*2=14, 14+10=24)')
assertEq(computed, 3, 'All 3 recompute when root changes')

// ─── Test 2: Selective recompute (diamond) ──────────────────────────

section('Test 2: Selective recompute (diamond)')

const diamond_A = defineNode('A', {x: 0}, {out: 0}, (inp) => ({out: inp.x}))
const diamond_B = defineNode('B', {val: 0, bias: 0}, {out: 0}, (inp) => ({out: inp.val + 1 + inp.bias}))
const diamond_C = defineNode('C', {val: 0}, {out: 0}, (inp) => ({out: inp.val * 2}))
const diamond_D = defineNode('D', {b: 0, c: 0}, {sum: 0}, (inp) => ({sum: inp.b + inp.c}))

const graph2 = defineGraph(
    [diamond_A, diamond_B, diamond_C, diamond_D],
    [
        connect(diamond_A, 'out', diamond_B, 'val'),
        connect(diamond_A, 'out', diamond_C, 'val'),
        connect(diamond_B, 'out', diamond_D, 'b'),
        connect(diamond_C, 'out', diamond_D, 'c'),
    ],
)

const rt2 = createRuntime(graph2)
rt2.set(diamond_A, 'x', 5)
computed = rt2.evaluate()
assertEq(computed, 4, 'All 4 nodes computed on first eval')
assertEq(rt2.get(diamond_D, 'sum'), 16, 'D = (5+1+0) + (5*2) = 16')

// Change only B's local input (bias), not connected to A
rt2.set(diamond_B, 'bias', 10)
computed = rt2.evaluate()
assertEq(computed, 2, 'Only B + D recompute when B.bias changes')
assertEq(rt2.get(diamond_D, 'sum'), 26, 'D = (5+1+10) + (5*2) = 26')

// ─── Test 3: Compute pi with Leibniz series ─────────────────────────

section('Test 3: Compute pi (Leibniz series)')

const piTerms = defineNode('terms', {n: 1}, {terms: [] as number[]}, (inp) => {
    const terms: number[] = []
    for (let i = 0; i < inp.n; i++) {
        terms.push((i % 2 === 0 ? 1 : -1) / (2 * i + 1))
    }
    return {terms}
})

const piSum = defineNode('sum', {terms: [] as number[]}, {pi: 0}, (inp) => ({
    pi: 4 * inp.terms.reduce((a: number, b: number) => a + b, 0),
}))

const piRound = defineNode('round', {pi: 0}, {rounded: 0}, (inp) => ({
    rounded: Math.round(inp.pi * 10000) / 10000,
}))

const graph3 = defineGraph(
    [piTerms, piSum, piRound],
    [
        connect(piTerms, 'terms', piSum, 'terms'),
        connect(piSum, 'pi', piRound, 'pi'),
    ],
)

const rt3 = createRuntime(graph3)
rt3.set(piTerms, 'n', 1000)
rt3.evaluate()
assertEq(rt3.get(piRound, 'rounded'), 3.1406, 'Pi ≈ 3.1406 with 1000 terms')

rt3.set(piTerms, 'n', 100000)
rt3.evaluate()
assertEq(rt3.get(piRound, 'rounded'), 3.1416, 'Pi ≈ 3.1416 with 100000 terms')

// Evaluate again without change
computed = rt3.evaluate()
assertEq(computed, 0, 'No recompute when n unchanged')

// ─── Test 4: Fibonacci ──────────────────────────────────────────────

section('Test 4: Fibonacci')

const fibNode = defineNode('fib', {n: 0}, {value: 0}, (inp) => {
    let a = 0, b = 1
    for (let i = 0; i < inp.n; i++) { [a, b] = [b, a + b] }
    return {value: a}
})

const isEvenNode = defineNode('isEven', {value: 0}, {even: false}, (inp) => ({
    even: inp.value % 2 === 0,
}))

const labelNode = defineNode('label', {n: 0, value: 0, even: false}, {text: ''}, (inp) => ({
    text: `fib(${inp.n}) = ${inp.value} (${inp.even ? 'even' : 'odd'})`,
}))

const graph4 = defineGraph(
    [fibNode, isEvenNode, labelNode],
    [
        connect(fibNode, 'value', isEvenNode, 'value'),
        connect(fibNode, 'value', labelNode, 'value'),
        connect(isEvenNode, 'even', labelNode, 'even'),
    ],
)

const rt4 = createRuntime(graph4)
rt4.set(fibNode, 'n', 10)
rt4.set(labelNode, 'n', 10)
rt4.evaluate()
assertEq(rt4.get(labelNode, 'text'), 'fib(10) = 55 (odd)', 'fib(10) = 55 (odd)')

rt4.set(fibNode, 'n', 12)
rt4.set(labelNode, 'n', 12)
rt4.evaluate()
assertEq(rt4.get(labelNode, 'text'), 'fib(12) = 144 (even)', 'fib(12) = 144 (even)')

// ─── Test 5: Buildify mock (8 nodes, selective recompute) ───────────

section('Test 5: Buildify mock (8 nodes)')

const bPreprocess = defineNode('preprocess',
    {floors: 7}, {segments: 'seg', numFloors: 7},
    (inp) => ({segments: 'seg-' + inp.floors, numFloors: inp.floors}))

const bGroundWalls = defineNode('groundWalls',
    {segments: '', numFloors: 0, seed: 577}, {walls: ''},
    (inp) => ({walls: `gw-${inp.seed}-${inp.numFloors}`}))

const bMiddleWalls = defineNode('middleWalls',
    {segments: '', numFloors: 0, seed: 704}, {walls: ''},
    (inp) => ({walls: `mw-${inp.seed}-${inp.numFloors}`}))

const bTrimWalls = defineNode('trimWalls',
    {segments: '', numFloors: 0, seed: 931}, {walls: ''},
    (inp) => ({walls: `tw-${inp.seed}-${inp.numFloors}`}))

const bPillars = defineNode('pillars',
    {numFloors: 0}, {pillars: ''},
    (inp) => ({pillars: `p-${inp.numFloors}`}))

const bProps = defineNode('props',
    {segments: '', numFloors: 0, seed: 258}, {props: ''},
    (inp) => ({props: `pr-${inp.seed}-${inp.numFloors}`}))

const bSigns = defineNode('signs',
    {segments: '', numFloors: 0, seed: 235}, {signs: ''},
    (inp) => ({signs: `sg-${inp.seed}-${inp.numFloors}`}))

const bJoin = defineNode('join',
    {groundWalls: '', middleWalls: '', trimWalls: '', pillars: '', props: '', signs: ''},
    {result: ''},
    (inp) => ({result: [inp.groundWalls, inp.middleWalls, inp.trimWalls, inp.pillars, inp.props, inp.signs].join('|')}))

const graph5 = defineGraph(
    [bPreprocess, bGroundWalls, bMiddleWalls, bTrimWalls, bPillars, bProps, bSigns, bJoin],
    [
        connect(bPreprocess, 'segments', bGroundWalls, 'segments'),
        connect(bPreprocess, 'segments', bMiddleWalls, 'segments'),
        connect(bPreprocess, 'segments', bTrimWalls, 'segments'),
        connect(bPreprocess, 'segments', bProps, 'segments'),
        connect(bPreprocess, 'segments', bSigns, 'segments'),
        connect(bPreprocess, 'numFloors', bGroundWalls, 'numFloors'),
        connect(bPreprocess, 'numFloors', bMiddleWalls, 'numFloors'),
        connect(bPreprocess, 'numFloors', bTrimWalls, 'numFloors'),
        connect(bPreprocess, 'numFloors', bPillars, 'numFloors'),
        connect(bPreprocess, 'numFloors', bProps, 'numFloors'),
        connect(bPreprocess, 'numFloors', bSigns, 'numFloors'),
        connect(bGroundWalls, 'walls', bJoin, 'groundWalls'),
        connect(bMiddleWalls, 'walls', bJoin, 'middleWalls'),
        connect(bTrimWalls, 'walls', bJoin, 'trimWalls'),
        connect(bPillars, 'pillars', bJoin, 'pillars'),
        connect(bProps, 'props', bJoin, 'props'),
        connect(bSigns, 'signs', bJoin, 'signs'),
    ],
)

const rt5 = createRuntime(graph5)
computed = rt5.evaluate()
assertEq(computed, 8, 'All 8 nodes compute on first eval')

// Change only ground seed
rt5.set(bGroundWalls, 'seed', 999)
computed = rt5.evaluate()
assertEq(computed, 2, 'Only groundWalls + join recompute when groundSeed changes')
assert(rt5.get(bJoin, 'result').includes('gw-999'), 'Ground walls updated with new seed')
assert(rt5.get(bJoin, 'result').includes('mw-704'), 'Middle walls unchanged')

// Change floors (on preprocess) — everything downstream recomputes
rt5.set(bPreprocess, 'floors', 10)
computed = rt5.evaluate()
assertEq(computed, 8, 'All 8 nodes recompute when floors changes')

// ─── Test 6: Edge cases ─────────────────────────────────────────────

section('Test 6: Edge cases')

// Set on connected input throws
let threwConnected = false
try { rt5.set(bGroundWalls, 'segments', 'hacked') } catch { threwConnected = true }
assert(threwConnected, 'set() throws on connected input')

// isSettable / settableInputs
assert(!rt5.isSettable(bGroundWalls, 'segments'), 'Connected input is not settable')
assert(!rt5.isSettable(bGroundWalls, 'numFloors'), 'Connected input is not settable')
assert(rt5.isSettable(bGroundWalls, 'seed'), 'Unconnected input is settable')
const settable = rt5.settableInputs(bGroundWalls)
assertEq(settable.length, 1, 'groundWalls has 1 settable input')
assertEq(settable[0], 'seed', 'The settable input is seed')

assert(rt5.isSettable(bPreprocess, 'floors'), 'Preprocess.floors is settable (no upstream)')
assertEq(rt5.settableInputs(bPreprocess).length, 1, 'Preprocess has 1 settable input')

// Cycle detection
const cycleA = defineNode('cycA', {x: 0}, {out: 0}, (inp) => ({out: inp.x}))
const cycleB = defineNode('cycB', {x: 0}, {out: 0}, (inp) => ({out: inp.x}))
let threw = false
try {
    defineGraph([cycleA, cycleB], [
        connect(cycleA, 'out', cycleB, 'x'),
        connect(cycleB, 'out', cycleA, 'x'),
    ])
} catch { threw = true }
assert(threw, 'Cycle detection throws')

// Standalone node (no connections)
const standalone = defineNode('solo', {x: 42}, {doubled: 0}, (inp) => ({doubled: inp.x * 2}))
const graphSolo = defineGraph([standalone], [])
const rtSolo = createRuntime(graphSolo)
rtSolo.evaluate()
assertEq(rtSolo.get(standalone, 'doubled'), 84, 'Standalone node evaluates with default input')

// Set same value twice
rtSolo.set(standalone, 'x', 42)
computed = rtSolo.evaluate()
assertEq(computed, 0, 'Setting same primitive value does not re-dirty')

rtSolo.set(standalone, 'x', 100)
computed = rtSolo.evaluate()
assertEq(computed, 1, 'Setting new value re-dirties and recomputes')
assertEq(rtSolo.get(standalone, 'doubled'), 200, 'Output updated after recompute')

// ─── Test 7: defineNodeType ──────────────────────────────────────────

section('Test 7: defineNodeType')

const adderType = defineNodeType(
    {x: 0, y: 0, bias: {default: 10, ui: {label: 'Bias', bounds: [0, 100], stepSize: 1}}},
    {sum: 0},
    (inp) => ({sum: inp.x + inp.y + inp.bias}),
)

// Instance with overrides
const adder1 = adderType('Adder 1', {x: 5, bias: 20})
const adder2 = adderType('Adder 2', {y: 3})
const adder3 = adderType('Adder 3') // no overrides

// Check names
assertEq(adder1.name, 'Adder 1', 'Instance has correct name')
assertEq(adder2.name, 'Adder 2', 'Instance has correct name')

// Check overridden defaults are resolved correctly
assertEq(resolveDefault(adder1.inputDefs.x), 5, 'Override applied: x=5')
assertEq(resolveDefault(adder1.inputDefs.y), 0, 'Non-overridden keeps schema default: y=0')
assertEq(resolveDefault(adder1.inputDefs.bias), 20, 'PropDef override applied: bias=20')

// Check PropDef ui metadata survives the merge
const biasUi1 = resolveUi(adder1.inputDefs.bias)
assert(biasUi1 !== undefined, 'PropDef ui preserved after override')
assertEq(biasUi1?.label, 'Bias', 'PropDef ui.label preserved')
assertEq(biasUi1?.bounds?.[1], 100, 'PropDef ui.bounds preserved')

// Check no-override instance keeps all schema defaults
assertEq(resolveDefault(adder3.inputDefs.x), 0, 'No-override instance: x=0')
assertEq(resolveDefault(adder3.inputDefs.bias), 10, 'No-override instance: bias=10')
const biasUi3 = resolveUi(adder3.inputDefs.bias)
assertEq(biasUi3?.label, 'Bias', 'No-override instance: ui preserved')

// Check instance2 only overrides y
assertEq(resolveDefault(adder2.inputDefs.x), 0, 'adder2: x kept default')
assertEq(resolveDefault(adder2.inputDefs.y), 3, 'adder2: y overridden to 3')

// Instances work with runtime
const graphNT = defineGraph(
    [adder1, adder2],
    [],
)
const rtNT = createRuntime(graphNT)
rtNT.evaluate()
assertEq(rtNT.get(adder1, 'sum'), 25, 'adder1: 5+0+20=25')
assertEq(rtNT.get(adder2, 'sum'), 13, 'adder2: 0+3+10=13')

// Override at runtime via set
rtNT.set(adder1, 'y', 100)
rtNT.evaluate()
assertEq(rtNT.get(adder1, 'sum'), 125, 'adder1 after set y=100: 5+100+20=125')

// Instances share the evaluate function but have independent state
rtNT.set(adder2, 'x', 50)
rtNT.evaluate()
assertEq(rtNT.get(adder1, 'sum'), 125, 'adder1 unchanged after adder2 set')
assertEq(rtNT.get(adder2, 'sum'), 63, 'adder2: 50+3+10=63')

// ─── Summary ────────────────────────────────────────────────────────

console.log(`\n\x1b[1m${passed + failed} tests, \x1b[32m${passed} passed\x1b[0m\x1b[1m, \x1b[${failed ? 31 : 32}m${failed} failed\x1b[0m`)
if (failed > 0) process.exit(1)
