/** Check inset and solidify end to end, with pictures. */
export default async ({run, capture, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'lighting', background: '#22262c'})

    // A hatch: a plate, a recess inset into its top, and a raised rim around that.
    await run({op: 'primitive', type: 'cube', name: 'plate', width: 2, height: 0.2, depth: 2,
        color: '#7d8a6f'})
    const faces = await run({op: 'inspect', object: 'plate', detail: true})
    const top = faces.data.faceVerts
        .map((verts, i) => ({i, y: verts.reduce((a, v) => a + faces.data.vertices[v][1], 0) / verts.length}))
        .filter(f => f.y > 0.05).map(f => f.i)
    log('top faces', JSON.stringify(top))

    const inset1 = await run({op: 'inset', object: 'plate', faces: top, thickness: 0.18, depth: -0.06})
    log('inset ->', JSON.stringify(inset1.data))
    const inset2 = await run({op: 'inset', object: 'plate', faces: inset1.data.insetFaces,
        thickness: 0.12, depth: 0.03})
    log('inset ->', JSON.stringify(inset2.data))
    await capture('inset hatch', {view: 'iso', fit: '*'})

    // A fender: a plane given thickness, with a rim closing it.
    await run({op: 'primitive', type: 'grid', name: 'fender', xSegments: 6, ySegments: 2,
        width: 3, depth: 1, position: [0, 1.6, 0], color: '#8a6a3a'})
    const grid = await run({op: 'inspect', object: 'fender', detail: true})
    // Bend the leading edge down before solidifying, so the even-offset correction has work to do.
    const front = grid.data.vertices.map((v, i) => v[2] > 0.4 ? i : -1).filter(i => i >= 0)
    await run({op: 'vertices', object: 'fender', relative: true,
        verts: front.map(i => [i, 0, -0.35, 0])})
    const shell = await run({op: 'solidify', object: 'fender', thickness: 0.06, offset: 0})
    log('solidify ->', JSON.stringify(shell.data))
    await capture('solidified fender', {view: 'iso', fit: '*'})

    const health = await run({op: 'selftest', verbose: true})
    log('selftest', JSON.stringify(health.data))
    await capture('both', {view: 'iso', fit: '*'})
}
