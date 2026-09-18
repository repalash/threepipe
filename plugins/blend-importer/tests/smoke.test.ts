/** Temporary sweep used while developing the n-gon path. Not a permanent test. */
import {describe, expect, it} from 'vitest'
import {listFixtures, loadBlend, meshLayout, meshName} from './fixtures'
import {createMeshData} from '../src/loader/meshData'

const files = listFixtures()

describe.skipIf(!files.length)('sweep', () => {
    it('decodes the corpus', async() => {
        const stats: Record<string, {ok: number, fail: number, ngon: number, faces: number}> = {}
        const failures: string[] = []
        const reasons = new Map<string, number>()
        for (const f of files) {
            let blend: any
            try {
                blend = await loadBlend(f)
            } catch (e) {
                continue
            }
            for (const m of blend.objects.Mesh ?? []) {
                const layout = meshLayout(m)
                const s = stats[layout] ??= {ok: 0, fail: 0, ngon: 0, faces: 0}
                let reason = ''
                const mesh = createMeshData(m, r => { reason ||= r })
                if (!mesh) {
                    s.fail++
                    reasons.set(layout + ': ' + reason.replace(/\d+/g, 'N'), (reasons.get(layout + ': ' + reason.replace(/\d+/g, 'N')) ?? 0) + 1)
                    if (failures.length < 20) failures.push(`${f.split('/').pop()}:${meshName(m)} [${layout}] ${reason}`)
                    continue
                }
                s.ok++
                s.faces += mesh.facesNum
                for (let i = 0; i < mesh.facesNum; i++) if (mesh.faceSize(i) > 4) { s.ngon++; break }
                expect(mesh.validate()).toEqual([])
            }
        }
        const fs = await import('node:fs')
        fs.writeFileSync('/tmp/blend-sweep.txt', 'files ' + files.length + '\nstats ' + JSON.stringify(stats, null, 1) + '\nreasons:\n' + [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}\t${k}`).join('\n') + '\nfailures:\n' + failures.join('\n'))
        expect(Object.keys(stats).length).toBeGreaterThan(0)
    }, 600000)
})
