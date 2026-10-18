import {expect, test} from '@playwright/test'
import {screenshotMatch, setupTestHooks} from './helpers'

setupTestHooks()

// ─── Procedural (geometry nodes) examples ───────────────────────────────────

test('procedural-terrain', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Procedural terrain (geometry nodes)')
    const run = async(command: Record<string, unknown>) => page.evaluate(c => (window as any).modelling.run(c), command)
    const state = async() => page.evaluate(() => {
        const e = (window as any).modelling.document.find('terrain')
        return {
            master: e.mesh.vertsNum,
            verts: e.evaluated.vertsNum,
            faces: e.evaluated.facesNum,
            modifiers: e.modifiers.map((m: any) => ({type: m.type, group: m.group, inputs: m.inputs})),
            hasGeometry: !!e.evaluatedGeometry,
        }
    })

    // The page added the group, a plane and the geometryNodes modifier through commands.
    const listed = await run({op: 'nodeGroup'})
    expect(listed.ok).toBe(true)
    expect(listed.data.groups).toEqual(['Terrain'])
    const described = await page.evaluate(() => (window as any).modelling.describeCommands())
    const modifier = described.find((d: any) => d.name === 'modifier')
    expect(modifier.inputSchema.properties.add.properties.type.enum).toContain('geometryNodes')
    expect(described.some((d: any) => d.name === 'nodeGroup')).toBe(true)

    let s = await state()
    expect(s.master).toBe(4)
    expect(s.verts).toBe(96 * 96)
    expect(s.faces).toBe(95 * 95)
    expect(s.modifiers).toEqual([{type: 'geometryNodes', group: 'Terrain', inputs: {}}])
    expect(s.hasGeometry).toBe(true)
    await screenshotMatch(page, testInfo, 'terrain-default')

    // An input change is one undoable command; the grid follows Resolution.
    const changed = await run({op: 'modifier', object: 'terrain', index: 0, update: {inputs: {Resolution: 40, Height: 8, Seed: 7}}})
    expect(changed.ok).toBe(true)
    s = await state()
    expect(s.verts).toBe(40 * 40)
    // The page follows commands it did not send itself (an agent's, the console's).
    await expect(page.locator('label.row', {hasText: 'Resolution'}).locator('output')).toHaveText('40')
    await expect(page.locator('#stats')).toContainText('verts 1600, faces 1521')
    await screenshotMatch(page, testInfo, 'terrain-changed')

    // A wrong input name fails with the group's inputs listed, and changes nothing.
    const wrong = await run({op: 'modifier', object: 'terrain', index: 0, update: {inputs: {Hieght: 1}}})
    expect(wrong.ok).toBe(false)
    expect(wrong.error).toContain('has no input "Hieght"')
    expect((await state()).verts).toBe(40 * 40)

    // Undo restores the previous inputs and evaluation; redo reapplies.
    expect((await run({op: 'undo'})).ok).toBe(true)
    expect((await state()).verts).toBe(96 * 96)
    expect((await run({op: 'redo'})).ok).toBe(true)
    expect((await state()).verts).toBe(40 * 40)

    // Replacing the group re-evaluates objects that use it; undo restores the old group.
    const flat = await page.evaluate(() => {
        const lib = (window as any).modelling.document.getData('nodeGroups')
        const t = JSON.parse(JSON.stringify(lib.Terrain))
        // Drop the lift: link the grid straight into Set Shade Smooth.
        t.links = t.links.filter((l: any) => l.to[0] !== 'Set Shade Smooth')
        t.links.push({from: ['Grid', 'Mesh'], to: ['Set Shade Smooth', 'Geometry']})
        return t
    })
    expect((await run({op: 'nodeGroup', name: 'Terrain', tree: flat})).ok).toBe(true)
    const zs = async() => page.evaluate(() => {
        const p = (window as any).modelling.document.find('terrain').evaluated.positions
        let max = 0
        for (let i = 2; i < p.length; i += 3) max = Math.max(max, Math.abs(p[i]))
        return max
    })
    expect(await zs()).toBe(0)
    expect((await run({op: 'undo'})).ok).toBe(true)
    expect(await zs()).toBeGreaterThan(0.5)

    // Show as code prints the DSL for the group.
    await page.getByRole('button', {name: 'Show as code'}).click()
    await expect(page.locator('#code')).toContainText('geometryNodes("Terrain"')

    // Apply bakes the evaluated mesh into the master.
    expect((await run({op: 'modifier', object: 'terrain', apply: true})).ok).toBe(true)
    s = await state()
    expect(s.modifiers).toEqual([])
    expect(s.master).toBe(40 * 40)
})
