import {describe, expect, test} from 'vitest'
import {formatBytes, parseGLTFBuffer, summarizeGLTF} from '../../plugins/tweakpane-editor/src/gltf-summary'
import {GLTFContentsPlugin} from '../../plugins/tweakpane-editor/src/GLTFContentsPlugin'
import {AssetExporterPlugin} from '../../src'

/** A .glb with this JSON and a BIN chunk of `binBytes` bytes (both padded to 4 bytes, as the spec says) */
function glb(json: any, binBytes: number) {
    const text = new TextEncoder().encode(JSON.stringify(json))
    const jsonLength = Math.ceil(text.length / 4) * 4
    const binLength = Math.ceil(binBytes / 4) * 4
    const total = 12 + 8 + jsonLength + (binBytes ? 8 + binLength : 0)
    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    view.setUint32(0, 0x46546C67, true) // glTF
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, jsonLength, true)
    view.setUint32(16, 0x4E4F534A, true) // JSON
    const bytes = new Uint8Array(buffer)
    bytes.fill(0x20, 20, 20 + jsonLength)
    bytes.set(text, 20)
    if (binBytes) {
        view.setUint32(20 + jsonLength, binLength, true)
        view.setUint32(24 + jsonLength, 0x004E4942, true) // BIN
    }
    return buffer
}

const sample = {
    asset: {version: '2.0', generator: 'test'},
    extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_clearcoat', 'WEBGI_viewer'],
    extensionsRequired: ['KHR_lights_punctual'],
    scene: 0,
    scenes: [{nodes: [0], extensions: {WEBGI_viewer: {
        type: 'ThreeViewer',
        plugins: [{type: 'NotesPlugin', fileNotes: [{id: 'a', text: 'Check the prongs'}]}, {type: 'Tonemap'}],
        resources: {materials: {m1: {}, m2: {}}, textures: {}, __isLoadedResources: true},
    }}}],
    nodes: [{mesh: 0}, {mesh: 1}, {camera: 0}],
    accessors: [
        {count: 300}, // positions
        {count: 600}, // indices: 200 triangles
        {count: 12}, // positions without indices: 4 triangles
        {count: 10}, // strip: 8 triangles
        {count: 3, max: [2.5]}, // animation input
    ],
    meshes: [
        {name: 'Ring', primitives: [{attributes: {POSITION: 0}, indices: 1}, {attributes: {POSITION: 2}}]},
        {primitives: [{attributes: {POSITION: 3}, mode: 5}, {attributes: {POSITION: 3}, mode: 1}]},
    ],
    materials: [{name: 'Gold', extensions: {KHR_materials_clearcoat: {}}}, {}],
    textures: [{source: 0}, {source: 1}],
    images: [{name: 'albedo', mimeType: 'image/png', bufferView: 0}, {uri: 'data:image/jpeg;base64,AAAA'}],
    bufferViews: [{buffer: 0, byteLength: 1000}],
    animations: [{name: 'Spin', channels: [{}, {}], samplers: [{input: 4}]}],
    cameras: [{}],
    extensions: {KHR_lights_punctual: {lights: [{}, {}]}},
}

describe('gltf-summary', () => {
    test('reads the JSON and the binary chunk of a glb', () => {
        const parsed = parseGLTFBuffer(glb(sample, 2000))
        expect(parsed.json.asset.generator).toBe('test')
        expect(parsed.binBytes).toBe(2000)
        expect(parsed.jsonBytes % 4).toBe(0)
    })

    test('reads a .gltf (JSON) with a data URI buffer', () => {
        const json = {asset: {version: '2.0'}, buffers: [{uri: 'data:application/octet-stream;base64,AAAAAAAA'}]}
        const buffer = new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer
        const parsed = parseGLTFBuffer(buffer)
        expect(parsed.json.asset.version).toBe('2.0')
        expect(parsed.binBytes).toBe(6)
        expect(parsed.jsonBytes).toBe(buffer.byteLength)
    })

    test('counts the triangles by primitive mode, the vertices, and lists the parts', () => {
        const s = summarizeGLTF('ring.glb', parseGLTFBuffer(glb(sample, 2000)), 9999)
        expect(s.fileBytes).toBe(9999)
        expect(s.counts).toEqual({
            scenes: 1, nodes: 3, meshes: 2, primitives: 4, triangles: 200 + 4 + 8, vertices: 300 + 12 + 10 + 10,
            materials: 2, textures: 2, images: 2, animations: 1, cameras: 1, lights: 2, skins: 0,
        })
        expect(s.meshes).toEqual([
            {name: 'Ring', primitives: 2, triangles: 204, vertices: 312},
            {name: 'Mesh 1', primitives: 2, triangles: 8, vertices: 20},
        ])
        expect(s.materials).toEqual([{name: 'Gold', extensions: ['KHR_materials_clearcoat']}, {name: 'Material 1', extensions: []}])
        expect(s.images).toEqual([{name: 'albedo', mimeType: 'image/png', bytes: 1000}, {name: 'Image 1', mimeType: 'image/jpeg', bytes: 3}])
        expect(s.imageBytes).toBe(1003)
        expect(s.animations).toEqual([{name: 'Spin', channels: 2, duration: 2.5}])
        expect(s.extensionsRequired).toEqual(['KHR_lights_punctual'])
    })

    test('lists the plugins of the viewer config with their sizes, and the resources by kind', () => {
        const s = summarizeGLTF('ring.glb', parseGLTFBuffer(glb(sample, 0)))
        expect(s.viewerConfig?.plugins.map(p => p.type)).toEqual(['NotesPlugin', 'Tonemap'])
        const notes = s.viewerConfig!.plugins[0]
        expect(notes.bytes).toBe(JSON.stringify(sample.scenes[0].extensions.WEBGI_viewer.plugins[0]).length)
        expect(s.viewerConfig?.resources).toEqual({materials: 2}) // no empty kinds, no __ keys
        expect(summarizeGLTF('a', {json: {}, jsonBytes: 2, binBytes: 0}).viewerConfig).toBeUndefined()
    })

    test('counts the resources that the exporter bundles in extras (an export with serialization metadata)', () => {
        const config = {type: 'ThreeViewer', plugins: [{type: 'Tonemap'}]}
        const resources = {materials: {m1: {}}, textures: {t1: {}, t2: {}}, images: {}}
        const json = {asset: {version: '2.0'}, scene: 0, scenes: [{extensions: {WEBGI_viewer: config}}], extras: {BundledResources: resources}}
        const s = summarizeGLTF('export.glb', parseGLTFBuffer(glb(json, 0)))
        expect(s.viewerConfig?.resources).toEqual({materials: 1, textures: 2})
        expect(s.viewerConfig?.bytes).toBe(JSON.stringify(config).length + JSON.stringify(resources).length)
    })

    test('formats sizes', () => {
        expect(formatBytes(undefined)).toBe('?')
        expect(formatBytes(512)).toBe('512 B')
        expect(formatBytes(2048)).toBe('2.0 KB')
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
    })
})

describe('GLTFContentsPlugin', () => {
    /** A viewer with the asset manager events and, optionally, an exporter */
    function setup(exporter?: any) {
        const listeners: Record<string, ((e: any) => any)[]> = {}
        const viewer: any = {
            assetManager: {
                addEventListener: (t: string, f: any) => (listeners[t] ??= []).push(f),
                removeEventListener: (t: string, f: any) => listeners[t] = (listeners[t] ?? []).filter(x => x !== f),
            },
            getPlugin: (c: any) => c === AssetExporterPlugin ? exporter : undefined,
            console,
            addEventListener: () => {},
            removeEventListener: () => {},
        }
        const plugin = new GLTFContentsPlugin()
        plugin.onAdded(viewer)
        const load = async (data: any) => Promise.all((listeners.loadAsset ?? []).map(async f => f({data})))
        return {plugin, viewer, load, listeners}
    }

    test('a loaded glb is read from its file and shown; other loads are not', async () => {
        const {plugin, load} = setup()
        const file = Object.assign(new Blob([glb(sample, 2000)]), {name: 'ring.glb'})
        await load({assetType: 'model', __rootBlob: file})
        await load({assetType: 'model', __rootBlob: Object.assign(new Blob(['x']), {name: 'part.obj'})})
        await load({assetType: 'texture', __rootBlob: Object.assign(new Blob(['x']), {name: 'env.hdr'})})
        expect(plugin.files.map(f => f.name)).toEqual(['ring.glb'])
        expect(plugin.shownSummary?.counts.triangles).toBe(212)
        expect(plugin.shownSummary?.fileBytes).toBe(file.size)
    })

    test('Check the export makes the file of the exporter and shows it first; without an exporter it says so', async () => {
        const blob = Object.assign(new Blob([glb(sample, 100)]), {ext: 'glb'})
        const exporter = {exportScene: async () => blob, exportOptions: {name: 'ring'}}
        const {plugin} = setup(exporter)
        const s = await plugin.checkExport()
        expect(s?.name).toBe('Export: ring.glb')
        expect(plugin.shown).toBe('export')
        expect(plugin.shownSummary).toBe(s)
        expect(plugin.status).toBe('')

        const none = setup().plugin
        expect(await none.checkExport()).toBeUndefined()
        expect(none.status).toBe('Add the AssetExporterPlugin to check the export')
    })

    test('removing the plugin stops reading loads', async () => {
        const {plugin, viewer, load} = setup()
        plugin.onRemove(viewer)
        await load({assetType: 'model', __rootBlob: Object.assign(new Blob([glb(sample, 0)]), {name: 'ring.glb'})})
        expect(plugin.files).toHaveLength(0)
    })
})
