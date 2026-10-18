/**
 * The skill cannot go stale: every cookbook example runs and passes its check, every command in it is
 * valid against the registry, and the committed SKILL.md and plugin manifest are exactly what the
 * generator writes now. Examples that draw run in tests/browser/skill.test.ts.
 */

import '../src/node/polyfill'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {validateParams} from '@threepipe/plugin-modelling'
import {NodeSession} from '../src/node/NodeSession'
import {COOKBOOK} from '../src/skill/cookbook'
import {renderMarketplace, renderPluginManifest, renderSkill, SkillCommandInfo} from '../src/skill/generate'
import modellingPackage from '../../modelling/package.json'

const ROOT = resolve(__dirname, '../../..')

describe('SKILL.md cookbook', () => {
    it('uses only valid commands and parameters', () => {
        const s = new NodeSession()
        for (const e of COOKBOOK) {
            for (const c of [...e.given ?? [], ...e.commands]) {
                const def = s.modelling.commands.get(c.op)
                expect(def, `${e.task}: ${c.op}`).toBeDefined()
                const {op: _op, ...params} = c
                expect(validateParams(def!, params), `${e.task}: ${JSON.stringify(c)}`).toEqual([])
            }
        }
        s.dispose()
    })

    for (const e of COOKBOOK.filter(x => !x.browser)) {
        it(`runs: ${e.task}`, async() => {
            const s = new NodeSession()
            for (const c of e.given ?? []) expect((await s.run(c)).error).toBeUndefined()
            const results = []
            for (const c of e.commands) results.push(await s.run(c))
            expect(results.map(r => r.error ?? null)).toEqual(results.map(() => null))
            expect(e.check(results)).toBeNull()
            s.dispose()
        })
    }
})

describe('generated files', () => {
    it('match the committed SKILL.md and .claude-plugin (run npm run modelling:skill)', () => {
        const s = new NodeSession()
        const commands = s.modelling.describeCommands() as SkillCommandInfo[]
        s.dispose()
        const v = modellingPackage.version
        expect(readFileSync(resolve(ROOT, 'skills/threepipe-modelling/SKILL.md'), 'utf8')).toBe(renderSkill(commands, v))
        expect(readFileSync(resolve(ROOT, '.claude-plugin/plugin.json'), 'utf8')).toBe(renderPluginManifest(v))
        expect(readFileSync(resolve(ROOT, '.claude-plugin/marketplace.json'), 'utf8')).toBe(renderMarketplace(v))
    })
})
