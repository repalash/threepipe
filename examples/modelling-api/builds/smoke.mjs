/**
 * A short build that touches every part of the command API, used to check the whole path works:
 * generators, live modifiers, history, measurement, capture and export.
 *
 *     npm run modelling:session -- examples/modelling-api/builds/smoke.mjs --out tmp/smoke
 */

export default async ({run, capture, inspect, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'lighting', environmentIntensity: 1.1, background: '#2a2f36'})

    // --- generators ---------------------------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'body', width: 2, height: 1, depth: 5,
        position: [0, 1, 0], color: '#5d6b53'})
    await run({op: 'lathe', name: 'wheel', axis: 'x', segments: 24, color: '#3a3f36',
        profile: [[0, -0.08], [0.3, -0.08], [0.34, -0.04], [0.34, 0.04], [0.3, 0.08], [0, 0.08]],
        position: [-1.05, 0.4, -1.8]})
    await run({op: 'sweep', name: 'rail', radius: 0.03, steps: 8, color: '#9aa0a6',
        path: [[-0.9, 1.6, -2], [-0.9, 1.8, -1.2], [-0.9, 1.8, 1.2], [-0.9, 1.6, 2]]})
    await capture('generators')

    // --- a live array, and proof that editing the master moves every copy ------------------------

    await run({op: 'array', object: 'wheel', count: 5, step: [0, 0, 0.9], live: true})
    await capture('live array')

    const before = await inspect('wheel')
    log(`master ${before.verts} verts, evaluated through the stack`)

    await run({op: 'transform', object: 'wheel', scale: [1, 1.15, 1.15], pivot: 'center',
        verts: Array.from({length: before.verts}, (_, i) => i)})
    await capture('master edited, every copy follows')

    // --- mirror to the other side ---------------------------------------------------------------

    await run({op: 'duplicate', object: 'wheel', name: 'wheel-right', scale: [-1, 1, 1]})
    await capture('mirrored', {view: 'front', fit: '*'})

    // --- checks ----------------------------------------------------------------------------------

    const overlaps = await run({op: 'measure', mode: 'overlaps'})
    log(`overlapping pairs: ${overlaps.data.pairs}`)

    const health = await run({op: 'selftest', verbose: true})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)

    await capture('final', {view: 'iso', fit: '*'})
    await run({op: 'export', format: 'glb', path: 'tmp/smoke/smoke.glb'})
}
