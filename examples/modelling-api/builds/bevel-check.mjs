/** Bevel, end to end, with pictures. */
export default async ({run, capture, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'lighting', background: '#22262c'})

    await run({op: 'primitive', type: 'cube', name: 'chamfer', size: 1.4, position: [-2.4, 0, 0],
        color: '#8a8f86'})
    log('chamfer', JSON.stringify((await run({op: 'bevel', object: 'chamfer', offset: 0.12})).data))

    await run({op: 'primitive', type: 'cube', name: 'rounded', size: 1.4, position: [0, 0, 0],
        color: '#7d8a6f'})
    log('rounded', JSON.stringify((await run({op: 'bevel', object: 'rounded', offset: 0.18,
        segments: 6, profile: 0.5})).data))

    await run({op: 'primitive', type: 'cube', name: 'concave', size: 1.4, position: [2.4, 0, 0],
        color: '#8a6a3a'})
    log('concave', JSON.stringify((await run({op: 'bevel', object: 'concave', offset: 0.22,
        segments: 6, profile: 0.15})).data))

    const health = await run({op: 'selftest', verbose: true})
    log('selftest', JSON.stringify(health.data))
    await capture('bevel: chamfer, round, concave', {view: 'iso', fit: '*'})
}
