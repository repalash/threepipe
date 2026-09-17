/** Screenshot the page with its panels, to check the split layout. Not part of any build. */
export default async ({run, page, outDir, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'primitive', type: 'cube', name: 'hull', width: 2.44, height: 0.85, depth: 6.77,
        position: [0, 0.9, 0], color: '#54604a'})
    await run({op: 'lathe', name: 'roadwheel', axis: 'x', segments: 20, color: '#3a4034',
        profile: [[0, -0.08], [0.1, -0.08], [0.12, -0.05], [0.24, -0.05], [0.275, -0.03],
            [0.275, 0.03], [0.24, 0.05], [0.12, 0.05], [0.1, 0.08], [0, 0.08]],
        position: [-1.21, 0.365, -2.05]})
    await run({op: 'array', object: 'roadwheel', count: 6, step: [0, 0, 0.82], live: true})
    await run({op: 'duplicate', object: 'roadwheel', name: 'roadwheel-r', scale: [-1, 1, 1]})
    await run({op: 'reference', name: 'quarter', plane: 'right', image: '/tmp/reference/lmw.jpg',
        calibrate: {from: [0.18, 0.62], to: [0.86, 0.62], distance: 6.77},
        origin: [-2.6, 0, 0], align: 'bottom', opacity: 0.45})
    await run({op: 'select', object: 'roadwheel'})
    await run({op: 'camera', view: 'iso', fit: '*'})
    await new Promise(r => setTimeout(r, 2500))
    await page.screenshot({path: `${outDir}/ui.png`})
    log('wrote ui.png')
}
