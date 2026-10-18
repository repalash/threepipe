/** The cookbook examples that draw, in the headless browser (run under the browser lock). */

import {afterAll, describe, expect, it} from 'vitest'
import {BrowserSession} from '../../src/browser/BrowserSession'
import {COOKBOOK} from '../../src/skill/cookbook'

const sessions: BrowserSession[] = []
afterAll(async() => {
    for (const s of sessions) await s.close()
})

describe('SKILL.md cookbook in a browser', () => {
    for (const e of COOKBOOK.filter(x => x.browser)) {
        it(`runs: ${e.task}`, async() => {
            const s = await BrowserSession.start({width: 800, height: 600})
            sessions.push(s)
            for (const c of e.given ?? []) expect((await s.run(c)).error).toBeUndefined()
            const results = []
            for (const c of e.commands) results.push(await s.run(c))
            expect(results.map(r => r.error ?? null)).toEqual(results.map(() => null))
            expect(e.check(results)).toBeNull()
            await s.close()
            sessions.pop()
        }, 120000)
    }
})
