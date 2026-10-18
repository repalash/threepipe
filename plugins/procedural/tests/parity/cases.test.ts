/**
 * Our own parity cases (`tests/parity/cases/<set>.ts`, written with the DSL) against Blender 5.2.2.
 * `tests/parity/cases/<set>.json` is the committed case list Blender evaluates (queue
 * `run_cases.py <set>.json tmp/gt-5.2.2/cases/<set>` on the Blender worker); this test fails when it is out of
 * date with the generator (`UPDATE_PARITY_CASES=1 npm run test -- tests/parity/cases` rewrites it).
 * Blender's results are read from `tests/parity/cases/<set>.gt/` when committed, else from
 * `<worktree>/tmp/gt-5.2.2/cases/<set>/`; cases without a result are skipped with that reason.
 */
import {describe, expect, it} from 'vitest'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {compareGeometry, ExpectedGeometry, GeometryNodesEvaluator} from '../../src'
import {binResolver, inlineBinRefs} from '../../src/io/geometryFromDump'
import {ParityCase} from './cases/types'
import {functionMathCases} from './cases/functionMath'
import {functionRandomCases} from './cases/functionRandom'
import {functionRotationCases} from './cases/functionRotation'
import {functionCurvesCases} from './cases/functionCurves'
import {functionSwitchCases} from './cases/functionSwitch'
import {textureCases} from './cases/textures'
import {instanceCases} from './cases/instances'
import {geometryCases} from './cases/geometry'

const SETS: Record<string, () => ParityCase[]> = {textures: textureCases, instances: instanceCases, geometry: geometryCases}
SETS.functionMath = functionMathCases
SETS.functionRandom = functionRandomCases
SETS.functionRotation = functionRotationCases
SETS.functionCurves = functionCurvesCases
SETS.functionSwitch = functionSwitchCases

for (const [set, generate] of Object.entries(SETS)) {
    describe(`parity cases: ${set}`, () => {
        const cases = generate()
        const file = join(__dirname, 'cases', `${set}.json`)
        // One case per line: compact, and diffs stay per case.
        const text = '[\n' + cases.map(c => JSON.stringify(c)).join(',\n') + '\n]\n'
        it('the committed case list matches the generator', () => {
            if (process.env.UPDATE_PARITY_CASES) writeFileSync(file, text)
            expect(existsSync(file) && readFileSync(file, 'utf8') === text, `${set}.json is out of date`).toBe(true)
        })
        const dirs = [join(__dirname, 'cases', `${set}.gt`), join(__dirname, '../../../../tmp/gt-5.2.2/cases', set)]
        const status: Record<string, string> = {}
        for (const c of cases) {
            const dir = dirs.find(d => existsSync(join(d, `${c.id}.json`)))
            if (!dir) {
                status[c.id] = 'no Blender result'
                it.skip(`${c.id} (no Blender result yet)`, () => undefined)
                continue
            }
            it(c.id, () => {
                const gt = JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8')) as {geometry?: ExpectedGeometry, error?: string}
                if (gt.error) throw new Error(`Blender failed on this case: ${gt.error}`)
                const bin = join(dir, `${c.id}.bin`)
                const expected = inlineBinRefs(gt.geometry!, binResolver(existsSync(bin) ? {[`${c.id}.bin`]: readFileSync(bin)} : {}))
                let diffs: string[]
                try {
                    const out = new GeometryNodesEvaluator(c.library, c.group).evaluate()
                    diffs = compareGeometry(out.geometry!, expected, {byteColor: 'srgb'})
                } catch (e) {
                    diffs = [`error: ${(e as Error).message}`]
                }
                // Float32 policy: record whether the case is bit-exact, not only within the 1e-5 tolerance.
                if (!diffs.length) {
                    const actual = new GeometryNodesEvaluator(c.library, c.group).evaluate().geometry!
                    const ulps = [0, 1, 2, 4, 16].find(u => !compareGeometry(actual, expected, {byteColor: 'srgb', ulps: u}).length)
                    status[c.id] = ulps === 0 ? 'exact' : `pass (${ulps === undefined ? '> 16' : `<= ${ulps}`} ulp)`
                } else {
                    status[c.id] = diffs.slice(0, 3).join(' | ')
                }
                expect(diffs, c.description).toEqual([])
            })
        }
        it('writes the status file', () => {
            writeFileSync(join(__dirname, 'cases', `${set}.status.json`), JSON.stringify(status, null, 1) + '\n')
        })
    })
}
