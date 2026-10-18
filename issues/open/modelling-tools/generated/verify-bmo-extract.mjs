#!/usr/bin/env node
/**
 * verify-bmo-extract.mjs
 *
 * Checks the artifacts produced by extract-bmo-opdefines.mjs. Run after every regeneration.
 *
 *   node verify-bmo-extract.mjs [--dir <generated dir>] [--expect-operators <n>] [--no-tsc]
 *
 * Assertions
 *   1. the expected operator count is present (default: whatever bmo-opdefines.json recorded, and at
 *      least 83 - the count in Blender 5.3; pass --expect-operators to pin an exact number)
 *   2. every operator has an `exec` callback and a non-empty doc
 *   3. no duplicate operator tsNames, and no duplicate slot tsNames within one operator's in/out group
 *   4. every tsName round-trips back to its Blender name
 *   5. every `enumName` referenced by a slot exists in BMO_ENUMS, and every enum table is referenced
 *   6. every slot type/subtype maps to a known TS type
 *   7. bmo-ops.schema.ts and bmo-ops.types.ts agree with bmo-opdefines.json
 *   8. the generated TS type-checks (`npx tsc --noEmit -p tsconfig.check.json`), unless --no-tsc
 *
 * Finally it prints a summary table of operator counts by category (categories are derived from the
 * `exec` callback's source file, i.e. Blender's own grouping - not a hand-written list).
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
let dir = THIS_DIR
let expectOperators = null
let runTsc = true
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dir = path.resolve(argv[++i])
    else if (argv[i] === '--expect-operators') expectOperators = Number(argv[++i])
    else if (argv[i] === '--no-tsc') runTsc = false
    else {
        console.error(`unknown argument ${argv[i]}`)
        process.exit(2)
    }
}

/** Minimum operator count, from Blender 5.3 (e4e6c79a84). A drop below this means a parsing regression. */
const MIN_OPERATORS = 83

const failures = []
const notes = []
function check(cond, msg) {
    if (!cond) failures.push(msg)
    return cond
}

const jsonPath = path.join(dir, 'bmo-opdefines.json')
const schemaPath = path.join(dir, 'bmo-ops.schema.ts')
const typesPath = path.join(dir, 'bmo-ops.types.ts')
for (const p of [jsonPath, schemaPath, typesPath]) {
    if (!fs.existsSync(p)) {
        console.error(`missing artifact: ${p}\nrun: node extract-bmo-opdefines.mjs`)
        process.exit(2)
    }
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
const schemaSrc = fs.readFileSync(schemaPath, 'utf8')
const typesSrc = fs.readFileSync(typesPath, 'utf8')

// -- 1. operator count ---------------------------------------------------------------------------
const ops = data.operators
check(Array.isArray(ops), 'bmo-opdefines.json has no operators array')
if (expectOperators !== null) {
    check(ops.length === expectOperators, `expected exactly ${expectOperators} operators, got ${ops.length}`)
} else {
    check(ops.length >= MIN_OPERATORS, `expected at least ${MIN_OPERATORS} operators, got ${ops.length}`)
    if (ops.length !== MIN_OPERATORS) {
        notes.push(`operator count is ${ops.length}, was ${MIN_OPERATORS} in Blender 5.3 - review the diff`)
    }
}
check(data.counts.operators === ops.length, 'counts.operators disagrees with operators.length')

// -- 2. exec + doc -------------------------------------------------------------------------------
for (const op of ops) {
    check(!!op.execC, `${op.name}: missing exec callback`)
    check(!!op.doc && op.doc.trim().length > 0, `${op.name}: empty doc`)
    check(Array.isArray(op.slotsIn), `${op.name}: slotsIn is not an array`)
    check(Array.isArray(op.slotsOut), `${op.name}: slotsOut is not an array`)
    check(Array.isArray(op.typeFlags), `${op.name}: typeFlags is not an array`)
    for (const f of op.typeFlags) {
        check(f in data.constants.opTypeFlags, `${op.name}: unknown type flag ${f}`)
    }
}

// -- 3. duplicate tsNames -------------------------------------------------------------------------
const seenOps = new Map()
for (const op of ops) {
    if (seenOps.has(op.tsName)) failures.push(`duplicate operator tsName ${op.tsName}: ${seenOps.get(op.tsName)} and ${op.name}`)
    seenOps.set(op.tsName, op.name)
    for (const [list, label] of [[op.slotsIn, 'slotsIn'], [op.slotsOut, 'slotsOut']]) {
        const seen = new Map()
        for (const s of list) {
            if (seen.has(s.tsName)) failures.push(`${op.name}.${label}: duplicate slot tsName ${s.tsName} (${seen.get(s.tsName)}, ${s.name})`)
            seen.set(s.tsName, s.name)
        }
    }
}

// -- 4. tsName round-trip -------------------------------------------------------------------------
const toBlender = (ts) => ts.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase())
for (const op of ops) {
    check(toBlender(op.tsName) === op.name, `${op.name}: tsName ${op.tsName} does not round-trip (${toBlender(op.tsName)})`)
    for (const s of [...op.slotsIn, ...op.slotsOut]) {
        const expect = s.name.replace(/\.(out|in)$/, '')
        check(toBlender(s.tsName) === expect, `${op.name}.${s.name}: tsName ${s.tsName} does not round-trip (${toBlender(s.tsName)} != ${expect})`)
    }
}

// -- 5. enum references ---------------------------------------------------------------------------
const enumByName = new Map(data.enums.map((e) => [e.cName, e]))
const referenced = new Set()
for (const op of ops) {
    for (const s of [...op.slotsIn, ...op.slotsOut]) {
        if (!s.enumName) continue
        referenced.add(s.enumName)
        check(enumByName.has(s.enumName), `${op.name}.${s.name}: references missing enum table ${s.enumName}`)
        check(
            schemaSrc.includes(`${JSON.stringify(s.enumName)}: [`),
            `${s.enumName} is referenced by ${op.name}.${s.name} but is not in BMO_ENUMS in bmo-ops.schema.ts`
        )
    }
}
for (const e of data.enums) {
    check(e.entries.length > 0, `enum table ${e.cName} is empty`)
    const names = new Set()
    for (const en of e.entries) {
        check(!names.has(en.name), `enum table ${e.cName}: duplicate identifier ${en.name}`)
        names.add(en.name)
        check(Number.isInteger(en.value), `enum table ${e.cName}.${en.name}: value is not an integer (${en.value})`)
    }
    if (!referenced.has(e.cName)) notes.push(`enum table ${e.cName} is not referenced by any slot`)
}

// -- 6. slot type / subtype coverage --------------------------------------------------------------
const KNOWN_TYPES = new Set(['bool', 'int', 'float', 'vec3', 'mat4', 'ptr', 'elems', 'map'])
const KNOWN_SUBTYPES = new Set([
    ...Object.keys(data.constants.slotSubtypes.map),
    ...Object.keys(data.constants.slotSubtypes.ptr),
    ...Object.keys(data.constants.slotSubtypes.int),
].map((n) => n.replace('BMO_OP_SLOT_SUBTYPE_', '')))
const ELEM_MASK_ALL = data.constants.elementMaskAll

for (const op of ops) {
    for (const s of [...op.slotsIn, ...op.slotsOut]) {
        const at = `${op.name}.${s.name}`
        check(KNOWN_TYPES.has(s.type), `${at}: unknown slot type ${s.type}`)
        check(s.cType in data.constants.slotTypes, `${at}: unknown eBMOpSlotType ${s.cType}`)
        if (s.subtype) check(KNOWN_SUBTYPES.has(s.subtype), `${at}: unknown subtype ${s.subtype}`)
        if (s.type === 'elems') {
            check(typeof s.elemMask === 'number' && s.elemMask > 0, `${at}: elems slot without an element mask`)
            check((s.elemMask & ~ELEM_MASK_ALL) === 0, `${at}: element mask ${s.elemMask} has bits outside BM_VERT|EDGE|LOOP|FACE`)
            check(!s.subtype, `${at}: elems slot should not carry a named subtype`)
        }
        if (s.type === 'ptr') check(!!s.subtype && s.subtype.startsWith('PTR_'), `${at}: ptr slot without a PTR_ subtype`)
        if (s.type === 'map') check(!!s.subtype && s.subtype.startsWith('MAP_'), `${at}: map slot without a MAP_ subtype`)
        if (s.enumName) {
            check(s.type === 'int' && (s.subtype === 'INT_ENUM' || s.subtype === 'INT_FLAG'), `${at}: enum table on a non INT_ENUM/INT_FLAG slot`)
        }
        if (s.type === 'int' && s.subtype) check(!!s.enumName, `${at}: ${s.subtype} slot without an enum table`)
    }
}

// -- 7. TS artifacts agree with the JSON ----------------------------------------------------------
const pascal = (ts) => ts[0].toUpperCase() + ts.slice(1)
for (const op of ops) {
    check(schemaSrc.includes(`    ${JSON.stringify(op.name)}: {`), `bmo-ops.schema.ts: BMO_OPS is missing ${op.name}`)
    check(typesSrc.includes(`export interface ${pascal(op.tsName)}Params {`), `bmo-ops.types.ts: missing ${pascal(op.tsName)}Params`)
    check(typesSrc.includes(`export interface ${pascal(op.tsName)}Result {`), `bmo-ops.types.ts: missing ${pascal(op.tsName)}Result`)
    check(typesSrc.includes(`    ${JSON.stringify(op.name)}: {params: `), `bmo-ops.types.ts: BMOOperatorMap is missing ${op.name}`)
}
const schemaOpCount = (schemaSrc.match(/^    "[a-z0-9_]+": \{$/gm) || []).length
check(schemaOpCount === ops.length, `bmo-ops.schema.ts BMO_OPS has ${schemaOpCount} entries, expected ${ops.length}`)
for (const f of ['BMO_ENUMS', 'BMO_OPS', 'BMO_OP_NAME_BY_TS', 'BMO_SLOT_NAME_BY_TS', 'BMOSlotType', 'BMOOpDef', 'BMOSlotDef']) {
    check(schemaSrc.includes(f), `bmo-ops.schema.ts does not export ${f}`)
}
check(!/import\s+[^\n]*from\s+['"]three/.test(schemaSrc + typesSrc), 'generated TS must not import three.js')
check(!/^\s*import\s/m.test(schemaSrc + typesSrc), 'generated TS must be dependency-free (no imports)')

// -- 8. the generated TS compiles -----------------------------------------------------------------
if (runTsc) {
    const tsconfig = path.join(dir, 'tsconfig.check.json')
    if (!fs.existsSync(tsconfig)) {
        failures.push(`missing ${tsconfig} (needed for the type-check step); pass --no-tsc to skip`)
    } else {
        try {
            execFileSync('npx', ['--yes', 'tsc', '--noEmit', '-p', tsconfig], {cwd: dir, stdio: 'pipe', encoding: 'utf8'})
            notes.push('tsc --noEmit: ok')
        } catch (e) {
            const out = (e.stdout || '') + (e.stderr || '')
            failures.push('tsc --noEmit failed:\n' + out.split('\n').slice(0, 40).join('\n'))
        }
    }
} else {
    notes.push('tsc skipped (--no-tsc)')
}

// -- summary --------------------------------------------------------------------------------------
/**
 * Category = the Blender source file implementing the operator's `exec` (recorded as `execFile` by
 * the extractor). That is Blender's own grouping of the operator set, so nothing is hand-written
 * here. Operators whose exec could not be located fall back to their exec symbol.
 */
function category(op) {
    if (!op.execFile) return `(unresolved: ${op.execC})`
    return op.execFile.replace(/^.*\//, '')
}
const groups = new Map()
for (const op of ops) {
    const g = category(op)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(op.name)
}

const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
const w = Math.max(...rows.map((r) => r[0].length), 'category'.length)
console.log('')
console.log(`${'category'.padEnd(w)}  count  operators`)
console.log(`${'-'.repeat(w)}  -----  ---------`)
for (const [g, list] of rows) {
    console.log(`${g.padEnd(w)}  ${String(list.length).padStart(5)}  ${list.sort().join(', ')}`)
}
console.log('')
console.log(`operators      ${ops.length}`)
console.log(`enum tables    ${data.enums.length}`)
console.log(`input slots    ${ops.reduce((a, o) => a + o.slotsIn.length, 0)}`)
console.log(`output slots   ${ops.reduce((a, o) => a + o.slotsOut.length, 0)}`)
console.log(`conditional    ${ops.filter((o) => o.condition).length} operator(s), ` +
    `${ops.reduce((a, o) => a + [...o.slotsIn, ...o.slotsOut].filter((s) => s.condition).length, 0)} slot(s)`)
console.log(`undocumented   ${ops.reduce((a, o) => a + [...o.slotsIn, ...o.slotsOut].filter((s) => !s.doc).length, 0)} slot(s)`)
console.log(`blender        ${data.source.blenderVersion} @ ${data.source.blenderCommit}`)
console.log('')

for (const n of notes) console.log(`note: ${n}`)
if (data.warnings && data.warnings.length) {
    console.log('')
    for (const wmsg of data.warnings) console.log(`extractor warning: ${wmsg}`)
}

if (failures.length) {
    console.log('')
    console.error(`FAILED (${failures.length})`)
    for (const f of failures) console.error('  - ' + f)
    process.exit(1)
}
console.log('')
console.log('OK - all checks passed')
