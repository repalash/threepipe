import {expect, test} from '@playwright/test'
import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
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
    // The terrain is a mesh only: nothing besides the evaluated mesh to draw (instances would be in `evaluatedGeometry`).
    expect(s.hasGeometry).toBe(false)
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

test('procedural-editor', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Procedural editor (geometry nodes)')
    const state = async() => page.evaluate(() => {
        const e = (window as any).modelling.document.entries[0]
        return {verts: e.evaluated.vertsNum, modifiers: e.modifiers.map((m: any) => ({type: m.type, group: m.group, inputs: m.inputs}))}
    })
    const before = await state()
    expect(before.modifiers).toEqual([{type: 'geometryNodes', group: 'Studs', inputs: {}}])
    expect(before.verts).toBeGreaterThan(8)

    // Properties > Modifiers lists the group's inputs as fields.
    await page.getByRole('tab', {name: 'Modifiers'}).click()
    const modifier = page.locator('.me-modifier[data-modifier-index="0"]')
    await expect(modifier.locator('.me-modifier-summary')).toHaveText('Studs')
    for (const label of ['Density', 'Size', 'Seed']) await expect(modifier.getByText(label, {exact: true})).toBeVisible()
    await screenshotMatch(page, testInfo, 'modifiers-panel')

    // Editing a field is a `modifier update` command: the stack and the evaluated mesh follow.
    const density = modifier.locator('#me-prop-Density')
    await density.fill('30')
    await density.press('Enter')
    await expect.poll(async() => (await state()).modifiers[0].inputs.Density).toBe(30)
    const after = await state()
    expect(after.verts).toBeGreaterThan(before.verts)

    // The node group as code.
    await modifier.getByTitle('Show the node group as code').click()
    await expect(modifier.locator('.me-modifier-code')).toContainText('geometryNodes("Studs"')

    // Undo returns to the default input and the same mesh.
    await page.evaluate(() => (window as any).modelling.run({op: 'undo'}))
    await expect.poll(async() => (await state()).verts).toBe(before.verts)

    // A group that makes instances: the evaluated mesh stays the plane, the cones are drawn as instances, and
    // applying the stack realizes them into the mesh (as Blender's apply does).
    const run = (c: Record<string, unknown>) => page.evaluate(cmd => (window as any).modelling.run(cmd), c)
    expect((await run({op: 'primitive', type: 'plane', name: 'ground', size: 3})).ok).toBe(true)
    expect((await run({op: 'modifier', object: 'ground', add: {type: 'geometryNodes', group: 'Scatter', inputs: {Density: 4}}})).ok).toBe(true)
    const ground = async() => page.evaluate(() => {
        const e = (window as any).modelling.document.find('ground')
        return {verts: e.evaluated.vertsNum, master: e.mesh.vertsNum, drawn: (window as any).procedural.drawn('ground')}
    })
    const scattered = await ground()
    expect(scattered.verts).toBe(scattered.master)
    expect(scattered.drawn.draws).toBeGreaterThan(5)
    expect(scattered.drawn.instancedMeshes).toBeGreaterThan(0)
    await screenshotMatch(page, testInfo, 'instances')
    expect((await run({op: 'modifier', object: 'ground', apply: true})).ok).toBe(true)
    const applied = await ground()
    expect(applied.drawn).toBeUndefined()
    expect(applied.master).toBeGreaterThan(scattered.master + (scattered.drawn.draws - 1) * 5)
})

// The bundle is made locally from the maintainer's .blend (porting/blender/bundle_dump.py); it is not in git.
test.describe(() => {
    test.skip(!existsSync(join(dirname(fileURLToPath(import.meta.url)), '../tmp/bundles/blender-procedural-buildings/bundle.json')), 'no local bundle (tmp/bundles)')
    test('procedural-blend-asset', async({page}, testInfo) => {
        await expect(page).toHaveTitle('Blender geometry nodes asset (procedural)')
        await expect(page.locator('#error')).toHaveText('')
        const stats = async() => page.evaluate(() => ({...(window as any).renderer.stats}))
        // The same draw list as in Node: Building 1's 351 instances of 18 referenced meshes.
        const first = await stats()
        expect(first.draws).toBe(351)
        expect(first.uniqueMeshes).toBe(18)
        await expect(page.locator('#source')).toContainText('blender-procedural-buildings.blend / Building 1 (Blender 5.2.2')
        await screenshotMatch(page, testInfo, 'building')

        // Inputs are live: a wider building has more modules; the original width gives the same draws back.
        const width = page.locator('label.row', {has: page.locator('span', {hasText: /^X$/})}).locator('input')
        const x = await width.inputValue()
        await width.fill(String(+x + 4))
        await width.dispatchEvent('change')
        await expect.poll(async() => (await stats()).draws).toBeGreaterThan(351)
        await width.fill(x)
        await width.dispatchEvent('change')
        await expect.poll(async() => (await stats()).draws).toBe(351)
    })
})
