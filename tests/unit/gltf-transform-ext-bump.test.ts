/**
 * Unit test for EXT_materials_bump surviving the glTF-Transform round-trip (Node).
 *
 * three.js writes bump maps as the standard EXT_materials_bump (the legacy WEBGI_materials_bumpmap
 * writer was dropped in 0.17.0). glTF-Transform's ALL_EXTENSIONS does not include it, so unless
 * GLTFDracoExportPlugin registers it as a generic extension, the Draco export/spec-gloss convert
 * round-trip silently drops the bump binding from every material. See WG-52.
 */
import {beforeAll, describe, expect, it} from 'vitest'

// Deferred imports — the plugin source pulls threepipe core, which has circular static-init
// dependencies that only resolve once the graph is fully loaded (same pattern as dracojs-adapter.test.ts).
let createGenericExtensionClass: typeof import('../../plugins/gltf-transform/src/GLTFDracoExporterBase').createGenericExtensionClass
let GLTFMaterialsBumpMapExtension: typeof import('threepipe').GLTFMaterialsBumpMapExtension
// @gltf-transform is only installed under plugins/gltf-transform, deep-import it from there.
let NodeIO: any, ALL_EXTENSIONS: any
beforeAll(async() => {
    const threepipe = await import('threepipe') // initialize the core module graph in canonical order first (avoids circular static-init)
    GLTFMaterialsBumpMapExtension = threepipe.GLTFMaterialsBumpMapExtension;
    ({createGenericExtensionClass} = await import('../../plugins/gltf-transform/src/GLTFDracoExporterBase'));
    ({NodeIO} = await import('../../plugins/gltf-transform/node_modules/@gltf-transform/core/dist/index.modern.js') as any);
    ({ALL_EXTENSIONS} = await import('../../plugins/gltf-transform/node_modules/@gltf-transform/extensions/dist/index.modern.js') as any)
})

// A minimal glTF with a bump-mapped material, shaped like the three.js GLTFExporter output
// (EXT_materials_bump: bumpTexture + bumpFactor), one 1x1 png texture, positions in a glb buffer.
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const makeJson = () => ({
    asset: {version: '2.0'},
    extensionsUsed: ['EXT_materials_bump'],
    scenes: [{nodes: [0]}],
    scene: 0,
    nodes: [{mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, material: 0}]}],
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0]}],
    materials: [{
        name: 'bumped',
        pbrMetallicRoughness: {},
        extensions: {['EXT_materials_bump']: {bumpFactor: 0.5, bumpTexture: {index: 0}}},
    }],
    textures: [{source: 0}],
    images: [{uri: 'data:image/png;base64,' + png1x1}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}],
    buffers: [{byteLength: 36}],
})

async function roundTrip(extra: any[]) {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerExtensions(extra)
    const doc = await io.readJSON({json: makeJson(), resources: {['@glb.bin']: new Uint8Array(36)}})
    const out = await io.writeJSON(doc)
    return out.json.materials?.[0]?.extensions?.['EXT_materials_bump']
}

describe('EXT_materials_bump through glTF-Transform', () => {
    it('is dropped by a round-trip when not registered (why registration is needed)', async() => {
        expect(await roundTrip([])).toBeUndefined()
    })

    it('survives a round-trip with the generic extension registered, keeping the texture binding', async() => {
        const ext = await roundTrip([
            createGenericExtensionClass(GLTFMaterialsBumpMapExtension.ExtMaterialsBumpExtension, GLTFMaterialsBumpMapExtension.Textures),
        ])
        expect(ext).toBeTruthy()
        expect(ext.bumpFactor).toBe(0.5)
        expect(typeof ext.bumpTexture?.index).toBe('number')
    })
})
