/**
 * The `basic` tag (`UiTags.Basic`) marks the few fields of a uiConfig that a simple view (like an editor inspector)
 * shows. Tags are metadata only: renderers that do not read them render the same panels.
 * The rule: tag fields, not folders. A basic view reaches a folder through its basic fields; a folder tagged `basic`
 * is shown whole. See `findTaggedUiConfigs`.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import type {UiObjectConfig} from 'uiconfig.js'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

const label = (c: UiObjectConfig) => tp.UiConfigMethods.GetLabel(c)
/** The labels of the basic fields of a config, in the order of the tree. */
const basicLabels = (config: UiObjectConfig) => tp.findTaggedUiConfigs(config, tp.UiTags.Basic).map(r => label(r.config))

/** Every config of a tree, folders included (dropdown options are not configs of the tree). */
function allConfigs(config: UiObjectConfig, list: UiObjectConfig[] = []) {
    list.push(config)
    if (config.type !== 'dropdown' && config.children)
        for (const c of tp.UiConfigMethods.GetChildren(config)) allConfigs(c, list)
    return list
}

describe('hasUiTag', () => {
    test('reads a tags array and a single tag string', () => {
        expect(tp.hasUiTag({type: 'input', tags: ['advanced', 'basic']}, 'basic')).toBe(true)
        expect(tp.hasUiTag({type: 'input', tags: 'basic'}, 'basic')).toBe(true)
        expect(tp.hasUiTag({type: 'input', tags: ['advanced']}, 'basic')).toBe(false)
        expect(tp.hasUiTag({type: 'input', tags: 'basics'}, 'basic')).toBe(false)
        expect(tp.hasUiTag({type: 'input'}, 'basic')).toBe(false)
        expect(tp.hasUiTag(undefined, 'basic')).toBe(false)
    })
    test('UiTags.Basic is "basic"', () => {
        expect(tp.UiTags.Basic).toBe('basic')
    })
})

describe('findTaggedUiConfigs, the folder rule', () => {
    const tree = () => {
        const a: UiObjectConfig = {type: 'number', label: 'A', tags: ['basic']}
        const b: UiObjectConfig = {type: 'number', label: 'B'}
        const c: UiObjectConfig = {type: 'number', label: 'C', tags: ['basic']}
        const d: UiObjectConfig = {type: 'number', label: 'D'}
        const e: UiObjectConfig = {type: 'number', label: 'E', tags: 'basic'}
        const inner: UiObjectConfig = {type: 'folder', label: 'Inner', children: [c, d]}
        const whole: UiObjectConfig = {type: 'folder', label: 'Whole', tags: ['basic'], children: [{type: 'number', label: 'W', tags: ['basic']}]}
        const empty: UiObjectConfig = {type: 'folder', label: 'Empty', children: [{type: 'number', label: 'X'}]}
        const dropdown: UiObjectConfig = {type: 'dropdown', label: 'Mode', children: [{label: 'o', value: 1, tags: ['basic']} as UiObjectConfig]}
        const root: UiObjectConfig = {
            type: 'folder', label: 'Root',
            children: [a, b, {type: 'folder', label: 'Outer', children: [inner]}, whole, empty, dropdown, ()=>[e, undefined as any], {}],
        }
        return {root, a, c, e, inner, whole}
    }

    test('returns the tagged fields at any depth, in tree order, with the folders above them', () => {
        const {root, a, c, e, inner, whole} = tree()
        const res = tp.findTaggedUiConfigs(root, 'basic')
        expect(res.map(r => r.config)).toEqual([a, c, whole, e])
        expect(res[0].parents).toEqual([root])
        expect(res[1].parents.map(label)).toEqual(['Root', 'Outer', 'Inner'])
        expect(res[1].parents[2]).toBe(inner)
    })

    test('a tagged folder is returned whole: its children are not listed again', () => {
        const {root} = tree()
        expect(tp.findTaggedUiConfigs(root, 'basic').map(r => label(r.config))).not.toContain('W')
    })

    test('a folder without a tagged field is not reached, and dropdown options are not fields', () => {
        const {root} = tree()
        const res = tp.findTaggedUiConfigs(root, 'basic')
        expect(res.flatMap(r => r.parents).map(label)).not.toContain('Empty')
        expect(res.map(r => label(r.config))).not.toContain('o')
    })

    test('a tagged root is returned alone', () => {
        const root: UiObjectConfig = {type: 'folder', label: 'R', tags: ['basic'], children: [{type: 'number', label: 'A', tags: ['basic']}]}
        expect(tp.findTaggedUiConfigs(root, 'basic')).toEqual([{config: root, parents: []}])
    })

    test('a config that contains itself is walked once', () => {
        const root: UiObjectConfig = {type: 'folder', label: 'R', children: [{type: 'number', label: 'A', tags: ['basic']}]}
        root.children!.push(root)
        expect(tp.findTaggedUiConfigs(root, 'basic').map(r => label(r.config))).toEqual(['A'])
    })
})

describe('basic fields of the core uiConfigs', () => {
    test('Mesh2: visibility, name, shadows and the transform; no actions', () => {
        const mesh = new tp.Mesh2(new tp.BufferGeometry2(), new tp.PhysicalMaterial())
        expect(basicLabels(mesh.uiConfig!)).toEqual(['Visible', 'Name', 'Casts Shadow', 'Receive Shadow', 'Position', 'Rotation', 'Scale'])
    })

    test('PhysicalMaterial: name, colour and map, opacity, rough/metal, normal map, emission, refraction', () => {
        const material = new tp.PhysicalMaterial()
        expect(basicLabels(material.uiConfig!)).toEqual([
            'name', 'color', 'map',
            'opacity', 'transparent',
            'roughness', 'metalness',
            'normalMap',
            'emissive', 'emissiveIntensity',
            'ior', 'transmission', 'thickness',
        ])
        // each basic field of a sub-folder is reached through its folder
        const byField = Object.fromEntries(tp.findTaggedUiConfigs(material.uiConfig!, 'basic')
            .map(r => [label(r.config), r.parents.map(label)]))
        expect(byField.roughness).toEqual(['Physical Material', 'Rough/Metal'])
        expect(byField.ior).toEqual(['Physical Material', 'Refraction'])
        expect(byField.name).toEqual(['Physical Material'])
    })

    test('UnlitMaterial: name, colour, map and opacity', () => {
        const material = new tp.UnlitMaterial()
        expect(basicLabels(material.uiConfig!)).toEqual(['name', 'color', 'map', 'opacity', 'transparent'])
    })

    test('line materials: name, colour, line width and opacity', () => {
        expect(basicLabels(new tp.UnlitLineMaterial().uiConfig!)).toEqual(['name', 'color', 'linewidth', 'opacity', 'transparent'])
        expect(basicLabels(new tp.LineMaterial2().uiConfig!)).toEqual(['name', 'color', 'linewidth', 'opacity', 'transparent'])
    })

    test('lights: enabled, name, colour, intensity, cast shadow and the main shape values', () => {
        expect(basicLabels(new tp.SpotLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Color', 'Intensity', 'Angle', 'Penumbra', 'Cast Shadow'])
        expect(basicLabels(new tp.PointLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Color', 'Intensity', 'Distance', 'Cast Shadow'])
        expect(basicLabels(new tp.DirectionalLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Color', 'Intensity', 'Cast Shadow'])
        expect(basicLabels(new tp.AmbientLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Color', 'Intensity'])
        expect(basicLabels(new tp.HemisphereLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Sky Color', 'Ground Color', 'Intensity'])
        expect(basicLabels(new tp.RectAreaLight2().uiConfig)).toEqual(['Enabled', 'Name', 'Color', 'Intensity', 'Width', 'Height'])
    })

    test('cameras: name and field of view (perspective) or zoom (orthographic)', () => {
        expect(basicLabels(new tp.PerspectiveCamera2().uiConfig)).toEqual(['Name', 'Field Of View'])
        expect(basicLabels(new tp.OrthographicCamera2().uiConfig)).toEqual(['Name', 'Zoom'])
    })

    test('geometry: no basic field', () => {
        const geometry = new tp.BufferGeometry2()
        expect(basicLabels(geometry.uiConfig!)).toEqual([])
    })

    test('core material extensions: only the main toggle, under the folder of the extension', () => {
        const material = new tp.PhysicalMaterial()
        const extensions = [
            new tp.ClearcoatTintPlugin().materialExtension,
            new tp.CustomBumpMapPlugin().materialExtension,
            new tp.FragmentClippingExtensionPlugin().materialExtension,
            new tp.NoiseBumpMaterialPlugin().materialExtension,
            new tp.SSAOPluginPass('ssao').materialExtension,
        ]
        for (const ext of extensions) {
            const config = ext.getUiConfig!(material) as UiObjectConfig
            const res = tp.findTaggedUiConfigs(config, 'basic')
            expect(res.map(r => label(r.config)), label(config)).toEqual(['Enabled'])
            expect(res[0].parents).toEqual([config])
        }
    })
})

describe('tags are metadata only', () => {
    const roots = () => [
        new tp.Mesh2(new tp.BufferGeometry2(), new tp.PhysicalMaterial()).uiConfig!,
        new tp.PhysicalMaterial().uiConfig!,
        new tp.UnlitMaterial().uiConfig!,
        new tp.SpotLight2().uiConfig,
        new tp.PerspectiveCamera2().uiConfig,
    ]

    test('the basic fields stay in place in the full panel, in their folders', () => {
        for (const root of roots()) {
            const all = allConfigs(root)
            for (const {config, parents} of tp.findTaggedUiConfigs(root, 'basic')) {
                expect(all).toContain(config)
                const parent = parents[parents.length - 1]
                expect(tp.UiConfigMethods.GetChildren(parent)).toContain(config)
            }
        }
    })

    test('finding the tagged fields does not change the configs', () => {
        for (const root of roots()) {
            const before = allConfigs(root).map(c => ({c, keys: Object.keys(c).sort().join(), tags: JSON.stringify(c.tags)}))
            tp.findTaggedUiConfigs(root, 'basic')
            for (const {c, keys, tags} of before) {
                expect(Object.keys(c).sort().join()).toBe(keys)
                expect(JSON.stringify(c.tags)).toBe(tags)
            }
        }
    })

    test('no field is both basic and advanced; existing tags are kept', () => {
        for (const root of roots()) {
            for (const c of allConfigs(root)) {
                expect(tp.hasUiTag(c, 'basic') && tp.hasUiTag(c, 'advanced')).toBe(false)
            }
        }
        const mesh = new tp.Mesh2(new tp.BufferGeometry2(), new tp.PhysicalMaterial())
        const duplicate = allConfigs(mesh.uiConfig!).find(c => c.label === 'Duplicate Object')!
        expect(duplicate.tags).toEqual(['context-menu'])
    })
})
