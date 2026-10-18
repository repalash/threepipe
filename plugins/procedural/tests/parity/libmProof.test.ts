/**
 * Proof that a parity case's remaining difference from Blender is the platform libm and nothing else.
 *
 * `LIBM_PROOF=<set>/<case id> npm run test -- tests/parity/libmProof` evaluates the committed case
 * (`cases/<set>.json`, Blender's result from `cases/<set>.gt/` or `<worktree>/tmp/gt-5.2.2/cases/<set>/`):
 * 1. records every argument of the float trig functions in `src/blender/libm.ts` and writes them to
 *    `<worktree>/tmp/libm-proof/<case id>.inputs.json`;
 * 2. when `<case id>.apple.json` is next to it (`porting/blender/libm_eval.py` run on the reference platform:
 *    `"$BLENDER" --background --factory-startup --python porting/blender/libm_eval.py -- <inputs> <apple>`), evaluates
 *    the case again with those results substituted and requires it to be bit-exact.
 * Without `LIBM_PROOF` the test is skipped.
 */
import {describe, expect, it} from 'vitest'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {compareGeometry, ExpectedGeometry, GeometryNodesEvaluator} from '../../src'
import {libmProof, LibmName} from '../../src/blender/libm'
import {binResolver, DumpReferenced, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
import type {EvalOptions} from '../../src/runtime/context'
import type {ParityCase} from './cases/types'

const spec = process.env.LIBM_PROOF
const NAMES: LibmName[] = ['acosf', 'asinf', 'atan2f', 'sincosf']
const OUT = join(__dirname, '../../../../tmp/libm-proof')

describe.skipIf(!spec)('libm proof', () => {
    it(`${spec}`, () => {
        const [set, id] = spec!.split('/')
        const cases = JSON.parse(readFileSync(join(__dirname, 'cases', `${set}.json`), 'utf8')) as ParityCase[]
        const c = cases.find(x => x.id === id)
        if (!c) throw new Error(`no case ${id} in ${set}.json`)
        if (c.images) throw new Error('cases with images are not supported here')
        const dir = [join(__dirname, 'cases', `${set}.gt`), join(__dirname, '../../../../tmp/gt-5.2.2/cases', set)]
            .find(d => existsSync(join(d, `${id}.json`)))
        if (!dir) throw new Error(`no Blender result for ${set}/${id}`)
        const gt = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as {geometry: ExpectedGeometry, scene?: DumpReferenced, input?: ExpectedGeometry}
        const bin = join(dir, `${id}.bin`)
        const resolver = binResolver(existsSync(bin) ? {[`${id}.bin`]: readFileSync(bin)} : {})
        const expected = inlineBinRefs(gt.geometry, resolver)
        const evaluate = () => {
            const options: EvalOptions = gt.scene ? {scene: sceneFromDump(gt.scene, resolver), selfObject: id} : {}
            const ev = new GeometryNodesEvaluator(c.library, c.group, options)
            if (c.input !== 'empty' && gt.input) ev.setInputGeometry(geometryFromDump(gt.input, resolver))
            for (const [k, v] of Object.entries(c.inputs ?? {})) ev.setInput(k, v)
            return ev.evaluate().geometry!
        }
        mkdirSync(OUT, {recursive: true})
        const applePath = join(OUT, `${id}.apple.json`)
        const table = existsSync(applePath) ? JSON.parse(readFileSync(applePath, 'utf8')) as NonNullable<typeof libmProof.table> : undefined
        const run = (withTable: boolean) => {
            libmProof.record = Object.fromEntries(NAMES.map(n => [n, new Set<string>()])) as Record<LibmName, Set<string>>
            libmProof.table = withTable ? table : undefined
            try {
                return {diffs: compareGeometry(evaluate(), expected, {byteColor: 'srgb', ulps: 0}), seen: libmProof.record}
            } finally {
                libmProof.record = undefined
                libmProof.table = undefined
            }
        }
        const before = run(false)
        const after = table ? run(true) : undefined
        // The substituted results change later arguments: every argument of both runs needs a platform result.
        const inputs = Object.fromEntries(NAMES.map(n => [n, [...new Set([...before.seen[n], ...(after?.seen[n] ?? [])])]]))
        writeFileSync(join(OUT, `${id}.inputs.json`), JSON.stringify(inputs))
        const missing = NAMES.flatMap(n => inputs[n].filter(k => !table?.[n]?.[k]).map(k => `${n}(${k})`))
        writeFileSync(join(OUT, `${id}.result.txt`), [
            `before:`, ...before.diffs,
            after ? `with the platform libm:` : `no ${id}.apple.json yet`, ...(after ? (after.diffs.length ? after.diffs : ['exact']) : []),
            `arguments without a platform result: ${missing.length}`, '',
        ].join('\n'))
        expect(missing, 'run libm_eval.py on the recorded inputs (again)').toEqual([])
        expect(after!.diffs).toEqual([])
    })
})
