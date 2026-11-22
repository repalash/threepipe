/**
 * `UiTags` lists every tag that threepipe sets in the `tags` of its uiConfigs. The values are the strings that the
 * configs used before the enum, so renderers and app code that read the strings (like `tags.includes('context-menu')`
 * in uiconfig-blueprint) keep working.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import type {UiObjectConfig} from 'uiconfig.js'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60000)

const label = (c: UiObjectConfig) => tp.UiConfigMethods.GetLabel(c)

/** Every config of a tree, folders included (dropdown options are not configs of the tree). */
function allConfigs(config: UiObjectConfig, list: UiObjectConfig[] = []) {
    list.push(config)
    if (config.type !== 'dropdown' && config.children)
        for (const c of tp.UiConfigMethods.GetChildren(config)) allConfigs(c, list)
    return list
}

/** The tags of the config with the label in the tree. */
function tagsOf(root: UiObjectConfig, configLabel: string) {
    const found = allConfigs(root).filter(c => label(c) === configLabel)
    expect(found.length, configLabel).toBeGreaterThan(0)
    return found[0].tags
}

describe('UiTags', () => {
    test('has the same string values that the configs used before the enum', () => {
        expect({...tp.UiTags}).toEqual({
            Basic: 'basic',
            ContextMenu: 'context-menu',
            HeaderAction: 'header-action',
            Interaction: 'interaction',
            Advanced: 'advanced',
            Performance: 'performance',
            Debug: 'debug',
            Widget: 'widget',
            GeneratedGeometry: 'generatedGeometry',
            Animation: 'animation',
            Constraints: 'constraints',
            Constraint: 'constraint',
        })
    })
})

describe('the core configs keep their tag strings', () => {
    test('object: menu actions, interactions and the uuid', () => {
        const root = new tp.Mesh2(new tp.BufferGeometry2(), new tp.PhysicalMaterial()).uiConfig!
        expect(tagsOf(root, 'Duplicate Object')).toEqual(['context-menu'])
        expect(tagsOf(root, 'Delete Object')).toEqual(['context-menu'])
        expect(tagsOf(root, 'Auto Center')).toEqual(['context-menu', 'interaction'])
        expect(tagsOf(root, 'Scale to Radius')).toEqual(['context-menu', 'interaction'])
        expect(tagsOf(root, 'Pivot to Node Center')).toEqual(['context-menu', 'interaction'])
        const uuid = allConfigs(root).find(c => Array.isArray(c.property) && c.property[1] === 'uuid')!
        expect(uuid.tags).toEqual(['advanced'])
    })

    test('geometry: menu actions and the uuid', () => {
        const root = new tp.BufferGeometry2().uiConfig!
        const all = allConfigs(root)
        const menu = all.filter(c => tp.hasUiTag(c, 'context-menu'))
        expect(menu.length).toBe(10)
        for (const c of menu) expect(c.tags).toEqual(['context-menu'])
        const uuid = all.find(c => Array.isArray(c.property) && c.property[1] === 'uuid')!
        expect(uuid.tags).toEqual(['advanced'])
    })

    test('camera: menu actions', () => {
        const root = new tp.PerspectiveCamera2().uiConfig
        expect(tagsOf(root, 'Set View')).toEqual(['context-menu'])
    })

    test('SSAO pass: performance and debug fields', () => {
        const root = new tp.SSAOPluginPass('ssao').uiConfig!
        expect(tagsOf(root, 'Num Samples')).toEqual(['performance'])
        expect(tagsOf(root, 'Split')).toEqual(['debug'])
    })

    test('constraint: its folder and the remove button', () => {
        const constraint = new tp.ObjectConstraint()
        expect(constraint.uiConfig.tags).toEqual(['constraint', tp.ObjectConstraintsPlugin.PluginType])
        expect(tagsOf(constraint.uiConfig, 'Remove Constraint')).toEqual(['context-menu'])
    })

    test('constraints folder of an object and the add button', () => {
        const mesh = new tp.Mesh2(new tp.BufferGeometry2(), new tp.PhysicalMaterial())
        ;(new tp.ObjectConstraintsPlugin() as any)._setupUiConfig(mesh)
        expect(tagsOf(mesh.uiConfig!, 'Constraints')).toEqual(['constraints', tp.ObjectConstraintsPlugin.PluginType])
        expect(tagsOf(mesh.uiConfig!, 'Add Constraint')).toEqual(['context-menu', 'header-action'])
    })

    test('generated geometry: one Generation Params folder, found again by its tag', () => {
        const geometry = new tp.BufferGeometry2()
        geometry.userData.generationParams = {type: 'test'}
        tp.updateUi(geometry, () => [])
        tp.updateUi(geometry, () => [])
        const folders = allConfigs(geometry.uiConfig!).filter(c => label(c) === 'Generation Params')
        expect(folders.length).toBe(1)
        expect(folders[0].tags).toEqual(['generatedGeometry'])
    })

    test('helper widget: its folder', () => {
        const helper = new tp.DirectionalLightHelper2(new tp.DirectionalLight2())
        expect(helper.uiConfig.tags).toBe('widget')
        helper.dispose()
    })
})
