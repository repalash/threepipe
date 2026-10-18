/**
 * Parity against Blender 5.2.2 output: the geonodes-kit reference cases (see `geonodes-kit/NOTICE`).
 * A case runs when every node type in it is ported; otherwise it is reported as skipped with the
 * missing types, never approximated. `tests/parity/geonodes-kit.status.json` records the result per
 * case for the coverage report.
 */

import {describe, expect, it} from 'vitest'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {CaseJSON, compareGeometry, ExpectedGeometry, GeometryNodesEvaluator, getNodeType, importCase} from '../../src'
import {BUILTIN_TYPES} from '../../src/runtime/evaluator'

const dir = join(__dirname, 'geonodes-kit')
const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'cases.json').sort()

interface Status {
    status: 'pass' | 'fail' | 'skip'
    reason?: string
}

// Structural nodes the runtime evaluates itself.
const BUILTIN = BUILTIN_TYPES
const results: Record<string, Status> = {}

function missingTypes(c: CaseJSON): string[] {
    const types = new Set((c.tree?.nodes ?? []).map(n => n.type))
    return [...types].filter(t => !BUILTIN.has(t) && !getNodeType(t)).sort()
}

describe('geonodes-kit reference cases (Blender 5.2.2)', () => {
    for (const file of files) {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {case: CaseJSON, geometry: ExpectedGeometry}
        const c = data.case
        const missing = missingTypes(c)
        if (missing.length) {
            results[c.id] = {status: 'skip', reason: `not ported: ${missing.join(', ')}`}
            it.skip(`${c.id} (not ported: ${missing.join(', ')})`, () => undefined)
            continue
        }
        if (c.scene?.length || c.objects?.length) {
            results[c.id] = {status: 'skip', reason: 'needs scene objects created by Blender operators'}
            it.skip(`${c.id} (needs scene objects)`, () => undefined)
            continue
        }
        it(c.id, () => {
            let diffs: string[]
            try {
                const {library, group} = importCase(c)
                const ev = new GeometryNodesEvaluator(library, group)
                const out = ev.evaluate()
                const geometry = out.outputs['Geometry']
                if (!geometry || typeof geometry !== 'object' || !('describe' in geometry)) throw new Error('no geometry output')
                diffs = compareGeometry(out.geometry!, data.geometry, {noneAsEmptyGeometry: true})
            } catch (e) {
                diffs = [`error: ${(e as Error).message}`]
            }
            results[c.id] = diffs.length ? {status: 'fail', reason: diffs.slice(0, 4).join(' | ')} : {status: 'pass'}
            expect(diffs, c.description).toEqual([])
        })
    }
    it('writes the status file', () => {
        const ordered = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)))
        writeFileSync(join(__dirname, 'geonodes-kit.status.json'), JSON.stringify(ordered, null, 1) + '\n')
        const counts = Object.values(results).reduce((m, r) => ({...m, [r.status]: (m[r.status] ?? 0) + 1}), {} as Record<string, number>)
        console.log(`geonodes-kit parity: ${JSON.stringify(counts)}`)
    })
})
