/**
 * `threepipe-modelling` verbs that need no browser: one JSON object per call on stdout, state in a GLB.
 */

import {mkdtemp, readFile, writeFile, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {runCli} from '../src/cli/main'

let dir: string

async function cli(...argv: string[]): Promise<{code: number, out: any, stdout: string, stderr: string}> {
    let stdout = ''
    let stderr = ''
    const code = await runCli(argv, {
        stdout: t => (stdout += t), stderr: t => (stderr += t), cwd: dir,
        readStdin: async() => '{"op": "primitive", "type": "cube", "name": "fromStdin"}',
    })
    // exactly one JSON object
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    return {code, out: JSON.parse(lines[0]), stdout, stderr}
}

beforeAll(async() => {
    dir = await mkdtemp(join(tmpdir(), 'tp-modelling-cli-'))
})

describe('threepipe-modelling', () => {
    it('lists its verbs and the commands', async() => {
        const r = await cli('help')
        expect(r.code).toBe(0)
        expect(Object.keys(r.out.verbs)).toEqual(expect.arrayContaining(['run', 'session', 'look', 'measure', 'validate', 'diff', 'export', 'help']))
        expect(r.out.commands.map((c: any) => c.op)).toEqual(expect.arrayContaining(['look', 'validate', 'diff', 'import']))
        const one = await cli('help', 'bevel')
        expect(one.out.inputSchema.type).toBe('object')
    })

    it('says which verb was meant', async() => {
        const r = await cli('valdate')
        expect(r.code).toBe(1)
        expect(r.out).toEqual({ok: false, error: 'unknown verb "valdate"', hint: 'did you mean "validate"?'})
    })

    it('keeps state in --doc across calls', async() => {
        const doc = join(dir, 'part.glb')
        const a = await cli('run', '[{"op":"primitive","type":"cube","name":"box","size":2},{"op":"checkpoint","name":"block"}]', '--doc', 'part.glb')
        expect(a.code).toBe(0)
        expect(a.out).toMatchObject({ok: true, ran: 2, failed: 0, saved: doc})
        expect((await stat(doc)).size).toBeGreaterThan(500)

        const b = await cli('run', '{"op":"extrude","object":"box","faces":[0],"distance":0.5}', '--doc', 'part.glb')
        expect(b.out.results[0].locality.local).toBe(true)

        const i = await cli('inspect', '--object', 'box', '--doc', 'part.glb')
        expect(i.out.ok).toBe(true)
        expect(i.out.data.faces).toBe(10) // the extrude survived the round trip, as n-gon topology

        const v = await cli('validate', '--doc', 'part.glb', '--object', 'box', '--spec', '{"manifold":{"closed":true},"counts":{"faces":10}}')
        expect(v.out.data.conforms).toBe(true)

        const m = await cli('measure', '{"mode":"topology"}', '--doc', 'part.glb')
        expect(m.out.data[0].closed).toBe(true)
    })

    it('reads commands from stdin and from a transcript file', async() => {
        const s = await cli('run', '-', '--doc', 'stdin.glb')
        expect(s.out.results[0].objects).toEqual(['fromStdin'])
        await writeFile(join(dir, 't.json'), JSON.stringify({operations: [{command: {op: 'primitive', type: 'cube', name: 'a'}}, {command: {op: 'inspect'}}]}))
        const t = await cli('run', 't.json')
        expect(t.out.ran).toBe(2)
        expect(t.out.saved).toBeNull()
    })

    it('fails with the registry\'s hint, and stops at the first failure', async() => {
        const r = await cli('run', '[{"op":"primitive","type":"cube","name":"c"},{"op":"bevl","object":"c"},{"op":"inspect"}]')
        expect(r.code).toBe(1)
        expect(r.out.ok).toBe(false)
        expect(r.out.ran).toBe(2)
        expect(r.out.error).toContain('unknown op "bevl"')
        expect(r.out.hint).toBe('did you mean "bevel"?')
    })

    it('exports and imports files', async() => {
        await cli('run', '{"op":"primitive","type":"cylinder","name":"post","segments":8}', '--doc', 'src.glb')
        const e = await cli('export', '--doc', 'src.glb', '--out', 'copy.glb')
        expect(e.out.ok).toBe(true)
        const i = await cli('import', 'copy.glb', '--doc', 'dest.glb')
        expect(i.out.data.imported[0]).toMatchObject({name: 'post', source: 'topology', faces: 10})
        expect(i.out.saved).toBe(join(dir, 'dest.glb'))
    })

    it('points look at a browser when there is nothing to render with', async() => {
        const r = await cli('look', '--connect', 'ws://127.0.0.1:1', '--token', 'x')
        expect(r.code).toBe(1)
        expect(r.out.error).toContain('cannot reach the relay')
        expect(r.out.hint).toContain('relay')
    })

    it('runs a build script in a Node session and writes its transcript', async() => {
        await writeFile(join(dir, 'build.mjs'), `export default async ({run, inspect, log}) => {
            await run({op: 'primitive', type: 'cube', name: 'hull', size: 2})
            await run({op: 'inset', object: 'hull', faces: [0], thickness: 0.2})
            log('inset done', (await inspect('hull')).faces)
        }`)
        const r = await cli('session', 'build.mjs', '--out-dir', 'out')
        expect(r.out).toMatchObject({ok: true, commands: 3, failed: 0})
        expect(r.stderr).toContain('inset done 10')
        const t = JSON.parse(await readFile(r.out.transcript, 'utf8'))
        expect(t.operations.map((o: any) => o.command.op)).toEqual(['primitive', 'inset', 'inspect'])
    })
})
