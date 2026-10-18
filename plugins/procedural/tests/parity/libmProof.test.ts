/**
 * Proof that a parity case's remaining difference from Blender is the platform libm and nothing else.
 *
 * `LIBM_PROOF=<set>/<case id>[,...] npm run test -- tests/parity/libmProof` (or `LIBM_PROOF=pass`: every case
 * whose committed status is "pass (... ulp)") evaluates the committed cases (`cases/<set>.json`, Blender's result
 * from `cases/<set>.gt/` or `<worktree>/tmp/gt-5.2.2/cases/<set>/`):
 * 1. records every argument of the float trig functions in `src/blender/libm.ts` and writes them to
 *    `<worktree>/tmp/libm-proof/<name>.inputs.json` (`<name>`: the case id for one case, else `LIBM_PROOF_NAME` or
 *    `batch`), and a verdict per case to `<name>.result.txt`;
 * 2. when `<name>.apple.json` is next to it (`porting/blender/libm_eval.py` run on the reference platform:
 *    `"$BLENDER" --background --factory-startup --python porting/blender/libm_eval.py -- <inputs> <apple>`), evaluates
 *    the case again with those results substituted and requires it to be bit-exact.
 * Without `LIBM_PROOF` the test is skipped.
 */
import {afterAll, describe, expect, it} from 'vitest'
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {compareGeometry, ExpectedGeometry, GeometryNodesEvaluator} from '../../src'
import {libmProof, LibmName} from '../../src/blender/libm'
import {binResolver, DumpReferenced, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
import type {EvalOptions} from '../../src/runtime/context'
import type {ParityCase} from './cases/types'

const spec = process.env.LIBM_PROOF
const NAMES: LibmName[] = ['acosf', 'asinf', 'atan2f', 'sincosf', 'sinf', 'cosf', 'tanf', 'powf']
const OUT = join(__dirname, '../../../../tmp/libm-proof')
const CASES = join(__dirname, 'cases')

/** `<set>/<id>` list, or `pass`: every case whose committed status is "pass (... ulp)". */
function caseList(): [string, string][] {
    if (spec !== 'pass') return spec!.split(',').map(x => x.split('/') as [string, string])
    return readdirSync(CASES).filter(f => f.endsWith('.status.json')).flatMap(f => {
        const status = JSON.parse(readFileSync(join(CASES, f), 'utf8')) as Record<string, string>
        return Object.entries(status).filter(([, v]) => v.startsWith('pass (')).map(([id]) => [f.replace('.status.json', ''), id] as [string, string])
    })
}

describe.skipIf(!spec)('libm proof', () => {
    const list = spec ? caseList() : []
    const name = process.env.LIBM_PROOF_NAME ?? (list.length === 1 ? list[0][1] : 'batch')
    const applePath = join(OUT, `${name}.apple.json`)
    const table = existsSync(applePath) ? JSON.parse(readFileSync(applePath, 'utf8')) as NonNullable<typeof libmProof.table> : undefined
    const inputs = Object.fromEntries(NAMES.map(n => [n, new Set<string>()])) as Record<LibmName, Set<string>>
    const report: string[] = []
    afterAll(() => {
        mkdirSync(OUT, {recursive: true})
        writeFileSync(join(OUT, `${name}.inputs.json`), JSON.stringify(Object.fromEntries(NAMES.map(n => [n, [...inputs[n]]]))))
        writeFileSync(join(OUT, `${name}.result.txt`), report.join('\n') + '\n')
    })
    for (const [set, id] of list) it(`${set}/${id}`, () => {
        const cases = JSON.parse(readFileSync(join(CASES, `${set}.json`), 'utf8')) as ParityCase[]
        const c = cases.find(x => x.id === id)
        if (!c) throw new Error(`no case ${id} in ${set}.json`)
        if (c.images) throw new Error('cases with images are not supported here')
        const dir = [join(CASES, `${set}.gt`), join(__dirname, '../../../../tmp/gt-5.2.2/cases', set)]
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
        const run = (withTable: boolean) => {
            const seen = Object.fromEntries(NAMES.map(n => [n, new Set<string>()])) as Record<LibmName, Set<string>>
            libmProof.record = seen
            libmProof.table = withTable ? table : undefined
            try {
                return {diffs: compareGeometry(evaluate(), expected, {byteColor: 'srgb', ulps: 0}), seen}
            } finally {
                libmProof.record = undefined
                libmProof.table = undefined
            }
        }
        const before = run(false)
        const after = table ? run(true) : undefined
        // The substituted results change later arguments: every argument of both runs needs a platform result.
        let missing = 0
        for (const n of NAMES) for (const k of [...before.seen[n], ...(after?.seen[n] ?? [])]) {
            inputs[n].add(k)
            if (!table?.[n]?.[k]) missing++
        }
        const verdict = !after ? 'no platform results yet' : missing ? `${missing} arguments without a platform result`
            : after.diffs.length ? `NOT libm only: ${after.diffs.slice(0, 3).join(' | ')}` : 'exact with the platform libm'
        report.push(`${set}/${id}: ${verdict} (before: ${before.diffs.length ? before.diffs.slice(0, 2).join(' | ') : 'exact'})`)
        expect(missing, 'run libm_eval.py on the recorded inputs (again)').toBe(0)
        expect(after!.diffs).toEqual([])
    })
})
