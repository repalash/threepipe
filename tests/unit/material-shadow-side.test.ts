/**
 * The Shadow Side control of the material panel, and the shadow reset when a material's Side or Shadow Side changes.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

function findUi(config: any, label: string): any {
    if (!config) return undefined
    if (typeof config === 'function') return findUi(config(), label)
    if (Array.isArray(config)) {
        for (const c of config) {
            const r = findUi(c, label)
            if (r) return r
        }
        return undefined
    }
    if (config.label === label) return config
    return findUi(config.children, label)
}

describe('Material panel: Shadow Side', () => {
    test('reads Auto for null and writes the side, Auto back to null', () => {
        const material = new tp.PhysicalMaterial()
        const ui = findUi(material.uiConfig, 'Shadow Side')
        expect(ui?.type).toBe('dropdown')
        expect(ui.children.map((c: any) => c.label)).toEqual(['Auto', 'Front', 'Back', 'Double'])
        expect(material.shadowSide).toBe(null)
        expect(ui.getValue()).toBe(-1)
        ui.setValue(tp.FrontSide)
        expect(material.shadowSide).toBe(tp.FrontSide)
        expect(ui.getValue()).toBe(tp.FrontSide)
        ui.setValue(-1)
        expect(material.shadowSide).toBe(null)
    })

    test('a change sends materialUpdate with change shadowSide, without a shader update', () => {
        const material = new tp.PhysicalMaterial()
        const ui = findUi(material.uiConfig, 'Shadow Side')
        const events: any[] = []
        material.addEventListener('materialUpdate', (e: any) => events.push(e))
        const version = material.version
        ui.setValue(tp.DoubleSide)
        ui.onChange({config: ui, last: true})
        expect(events.length).toBe(1)
        expect(events[0].change).toBe('shadowSide')
        expect(material.version).toBe(version) // three.js picks the shadow side at each shadow render
    })

    test('the viewer draws the shadow maps again after a Side or Shadow Side change, not after other changes', () => {
        const viewer: any = {setDirty: vi.fn(), renderManager: {resetShadows: vi.fn()}, _scene: {}}
        const onUpdate = (tp.ThreeViewer.prototype as any)._onMaterialUpdate
        onUpdate.call(viewer, {type: 'materialUpdate', change: 'roughness'})
        expect(viewer.renderManager.resetShadows).not.toHaveBeenCalled()
        expect(viewer.setDirty).toHaveBeenCalledTimes(1)
        onUpdate.call(viewer, {type: 'materialUpdate', change: 'shadowSide'})
        onUpdate.call(viewer, {type: 'materialUpdate', change: 'side'})
        expect(viewer.renderManager.resetShadows).toHaveBeenCalledTimes(2)
    })

    test('shadowSide is saved and loaded with the material', () => {
        const material = new tp.PhysicalMaterial()
        material.shadowSide = tp.FrontSide
        const json = material.toJSON()
        const material2 = new tp.PhysicalMaterial()
        material2.fromJSON(json, undefined, true) // what the material manager calls on load
        expect(material2.shadowSide).toBe(tp.FrontSide)
    })
})
