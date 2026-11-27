/**
 * WEBGI_lights_ambient: ambient and hemisphere lights saved in glTF (GLTFLightsAmbientExtension), and kept by
 * gltf-transform (GLTFLightsAmbientExtensionGP).
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {LoadingManager} from 'three'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {GLTFLightsAmbientExtensionGP} from '../../plugins/gltf-transform/src/GLTFLightsAmbientExtensionGP'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
let NAME: string
beforeAll(async() => {
    tp = await import('threepipe')
    NAME = tp.GLTFLightsAmbientExtension.WebGiLightsAmbientExtension
})

function scene() {
    const root = new tp.Object3D2()
    const ambient = new tp.AmbientLight2('#ffffff', 0.13)
    ambient.name = 'Ambient'
    const hemisphere = new tp.HemisphereLight2('#88aaff', '#443322', 2)
    hemisphere.name = 'Sky'
    hemisphere.position.set(1, 2, 0)
    const white = new tp.AmbientLight2() // all defaults
    white.name = 'White'
    root.add(ambient, hemisphere, white)
    return {root, ambient, hemisphere, white}
}

async function exportJson(root: any) {
    const exporter = new tp.GLTFExporter2()
    for (const ext of tp.GLTFExporter2.ExportExtensions) exporter.register(ext)
    return new Promise<any>((resolve, reject) => exporter.parse(root, resolve as any, reject as any, {}))
}

async function importJson(json: any) {
    const loader = new tp.GLTFLoader2(new LoadingManager())
    for (const ext of tp.GLTFLoader2.ImportExtensions) loader.register(ext)
    return loader.parseAsync(JSON.stringify(json), '')
}

describe('WEBGI_lights_ambient', () => {
    test('export writes the lights at the root and a light index on their nodes, without the defaults', async() => {
        const {root, hemisphere} = scene()
        const json = await exportJson(root)
        expect(json.extensionsUsed).toContain(NAME)
        expect(json.extensionsRequired ?? []).not.toContain(NAME) // an optional extension: other loaders skip the lights
        const lights = json.extensions[NAME].lights
        expect(lights).toEqual([
            {type: 'ambient', name: 'Ambient', intensity: 0.13},
            {type: 'hemisphere', name: 'Sky', color: hemisphere.color.toArray(), groundColor: hemisphere.groundColor.toArray(), intensity: 2},
            {type: 'ambient', name: 'White'},
        ])
        const indices = json.nodes.filter((n: any) => n.extensions?.[NAME]).map((n: any) => [n.name, n.extensions[NAME].light])
        expect(indices).toEqual([['Ambient', 0], ['Sky', 1], ['White', 2]])
        const sky = json.nodes.find((n: any) => n.name === 'Sky')
        expect(sky.matrix ? sky.matrix.slice(12, 15) : sky.translation).toEqual([1, 2, 0]) // the sky direction (a matrix unless trs is set)
        expect(json.extensions.KHR_lights_punctual).toBeUndefined()
    })

    test('import gives the same lights, as AmbientLight2 and HemisphereLight2, with their names and positions', async() => {
        const s = scene()
        const gltf = await importJson(await exportJson(s.root))
        const ambient = gltf.scene.getObjectByName('Ambient') as any
        const hemisphere = gltf.scene.getObjectByName('Sky') as any
        const white = gltf.scene.getObjectByName('White') as any
        expect(ambient).toBeInstanceOf(tp.AmbientLight2) // a node with only the light is the light
        expect(hemisphere).toBeInstanceOf(tp.HemisphereLight2)
        expect(ambient.intensity).toBeCloseTo(0.13)
        expect(ambient.color.toArray()).toEqual(s.ambient.color.toArray())
        expect(hemisphere.intensity).toBe(2)
        for (const i of [0, 1, 2]) {
            expect(hemisphere.color.toArray()[i]).toBeCloseTo(s.hemisphere.color.toArray()[i], 6)
            expect(hemisphere.groundColor.toArray()[i]).toBeCloseTo(s.hemisphere.groundColor.toArray()[i], 6)
        }
        expect(hemisphere.position.toArray()).toEqual([1, 2, 0])
        expect(white.intensity).toBe(1)
        expect(white.color.toArray()).toEqual([1, 1, 1])
        expect(ambient.userData.gltfExtensions?.[NAME]).toBeUndefined() // a known extension, not kept in userData
    })

    test('a light used by two nodes gives each node its own light; a hemisphere light without a translation stays at the origin', async() => {
        const gltf = await importJson({
            asset: {version: '2.0'},
            scene: 0,
            scenes: [{nodes: [0, 1]}],
            nodes: [{name: 'a', extensions: {[NAME]: {light: 0}}}, {name: 'b', translation: [0, 3, 0], extensions: {[NAME]: {light: 0}}}],
            extensionsUsed: [NAME],
            extensions: {[NAME]: {lights: [{type: 'hemisphere', intensity: 0.5}]}},
        })
        const a = gltf.scene.getObjectByName('a') as any
        const b = gltf.scene.getObjectByName('b') as any
        expect(a.isHemisphereLight && b.isHemisphereLight).toBe(true)
        expect(a).not.toBe(b)
        expect(a.position.toArray()).toEqual([0, 0, 0]) // as the file says, like KHR_lights_punctual
        expect(b.position.toArray()).toEqual([0, 3, 0])
        expect(a.intensity).toBe(0.5)
    })

    test('gltf-transform keeps the lights with GLTFLightsAmbientExtensionGP', async() => {
        const json = await exportJson(scene().root)
        const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, GLTFLightsAmbientExtensionGP])
        const doc = await io.readJSON({json, resources: {}})
        const out = (await io.writeJSON(doc)).json as any
        expect(out.extensions[NAME]).toEqual(json.extensions[NAME])
        const names = (j: any) => j.nodes.filter((n: any) => n.extensions?.[NAME]).map((n: any) => [n.name, j.extensions[NAME].lights[n.extensions[NAME].light].name])
        expect(names(out)).toEqual(names(json))
        expect(out.extensionsUsed).toContain(NAME)

        // without it, gltf-transform drops the lights
        const plain = (await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeJSON(await new NodeIO().registerExtensions(ALL_EXTENSIONS).readJSON({json, resources: {}}))).json as any
        expect(plain.extensions?.[NAME]).toBeUndefined()
    })

    test('a light made in gltf-transform is written with the type and colours', async() => {
        const io = new NodeIO().registerExtensions([GLTFLightsAmbientExtensionGP])
        const doc = await io.readJSON({json: {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: []}]}, resources: {}})
        const ext = doc.createExtension(GLTFLightsAmbientExtensionGP)
        const light = ext.createLight('Sky').setType('hemisphere').setColor([0.5, 0.6, 1]).setGroundColor([0.2, 0.2, 0.1]).setIntensity(3)
        const node = doc.createNode('Sky').setTranslation([0, 1, 0]).setExtension(NAME, light)
        doc.getRoot().listScenes()[0].addChild(node)
        const out = (await io.writeJSON(doc)).json as any
        expect(out.extensions[NAME].lights).toEqual([{type: 'hemisphere', name: 'Sky', color: [0.5, 0.6, 1], groundColor: [0.2, 0.2, 0.1], intensity: 3}])
        const gltf = await importJson(out)
        const sky = gltf.scene.getObjectByName('Sky') as any
        expect(sky.isHemisphereLight).toBe(true)
        expect(sky.intensity).toBe(3)
        expect(sky.position.toArray()).toEqual([0, 1, 0])
    })
})
