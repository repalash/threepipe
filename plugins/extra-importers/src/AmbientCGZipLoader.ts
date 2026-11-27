import {EquirectangularReflectionMapping, MeshPhysicalMaterialParameters, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector2} from 'three'
import {type IAssetImporter, type IFile, type ILoader, type ImportAddOptions, type ITexture, PhysicalMaterial, ZipLoader} from 'threepipe'

/**
 * A map file in an ambientCG material zip, see {@link parseAmbientCGFileName}.
 */
export interface AmbientCGMapFile {
    /** The asset id, like `Fabric087` */
    assetId: string
    /** The resolution and format, like `1K-JPG` */
    variant: string
    /** The map name, like `Color` or `NormalGL` */
    map: string
    /** The file extension in lower case, like `jpg` */
    ext: string
}

/**
 * Where each map of an ambientCG material goes in a {@link PhysicalMaterial}.
 * `srgb` maps are colour data, the others are linear data.
 * `Normal` is the name of the normal map in older zips (OpenGL convention, like `NormalGL`).
 * `NormalDX` is used only when the zip has no `NormalGL`/`Normal` (its green channel is flipped with `normalScale.y = -1`).
 */
export const AmbientCGMaterialMaps: Readonly<Record<string, {slot: keyof PhysicalMaterial & string, srgb?: boolean}>> = {
    Color: {slot: 'map', srgb: true},
    NormalGL: {slot: 'normalMap'},
    Normal: {slot: 'normalMap'},
    NormalDX: {slot: 'normalMap'},
    Roughness: {slot: 'roughnessMap'},
    Metalness: {slot: 'metalnessMap'},
    AmbientOcclusion: {slot: 'aoMap'},
    Displacement: {slot: 'displacementMap'},
    Opacity: {slot: 'alphaMap'},
    Emission: {slot: 'emissiveMap', srgb: true},
}

/**
 * Parse the name of a map file in an ambientCG material zip, `<AssetId>_<Resolution>-<Format>_<Map>.<ext>`,
 * like `Fabric087_1K-JPG_Color.jpg`. Folders in the path are ignored.
 * @returns undefined for the other files in the zip (`.mtlx`, `.usdc`, `.blend`, `.tres`, the `<AssetId>.png` preview)
 */
export function parseAmbientCGFileName(path: string): AmbientCGMapFile | undefined {
    const name = path.split('/').pop() || ''
    const match = /^(.+)_([^_]+-[^_]+)_([A-Za-z]+)\.([A-Za-z0-9]+)$/.exec(name)
    if (!match) return undefined
    const [, assetId, variant, map, ext] = match
    return {assetId, variant, map, ext: ext.toLowerCase()}
}

/**
 * Pick the file of each material map from the paths of the files in an ambientCG material zip.
 * @returns the path for each map name in {@link AmbientCGMaterialMaps} (one normal map: `NormalGL`, else `Normal`, else `NormalDX`),
 * the asset id, and the map names in the zip that have no slot (like `Scattering`)
 */
export function pickAmbientCGMapFiles(paths: Iterable<string>) {
    const files: Record<string, string> = {}
    const unknown: string[] = []
    let assetId: string | undefined
    for (const path of paths) {
        if (path.startsWith('__MACOSX/') || (path.split('/').pop() || '').startsWith('._')) continue
        const file = parseAmbientCGFileName(path)
        if (!file) continue
        if (!AmbientCGMaterialMaps[file.map]) {
            unknown.push(file.map)
            continue
        }
        if (files[file.map]) continue // keep the first one
        files[file.map] = path
        if (!assetId) assetId = file.assetId
    }
    // one normal map, in the OpenGL convention when the zip has it
    const normal = files.NormalGL ? 'NormalGL' : files.Normal ? 'Normal' : files.NormalDX ? 'NormalDX' : undefined
    for (const n of ['NormalGL', 'Normal', 'NormalDX']) if (n !== normal) delete files[n]
    return {files, assetId, unknown}
}

/**
 * The parameters of a {@link PhysicalMaterial} for the maps of an ambientCG material (by map name, see {@link AmbientCGMaterialMaps}).
 * Sets the colour space and the repeat wrapping of the textures.
 *
 * - `color` is white, `roughness` is 1 and `metalness` is 1 with a `Metalness` map, else 0, so the maps give the values.
 * - `NormalDX` (used only without `NormalGL`) gets `normalScale` (1, -1).
 * - `Opacity` sets `alphaMap` and `transparent`.
 * - `Emission` sets `emissiveMap` and a white `emissive`.
 * - `Displacement` sets `displacementMap` with `displacementScale` 0: the depth in scene units depends on the size and
 *   the tessellation of the mesh, set `material.displacementScale` to use it.
 */
export function ambientCGMaterialParameters(textures: Record<string, ITexture | undefined>): MeshPhysicalMaterialParameters {
    const params: MeshPhysicalMaterialParameters & Record<string, any> = {
        color: 0xffffff,
        roughness: 1,
        metalness: textures.Metalness ? 1 : 0,
    }
    for (const [map, texture] of Object.entries(textures)) {
        const slot = AmbientCGMaterialMaps[map]
        if (!texture || !slot) continue
        texture.colorSpace = slot.srgb ? SRGBColorSpace : NoColorSpace
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        params[slot.slot] = texture
    }
    if (textures.NormalDX && params.normalMap === textures.NormalDX) params.normalScale = new Vector2(1, -1)
    if (params.alphaMap) params.transparent = true
    if (params.emissiveMap) params.emissive = 0xffffff
    if (params.displacementMap) params.displacementScale = 0
    return params
}

/**
 * The HDR image in an ambientCG HDRI zip (like `NightEnvironmentHDRI011_1K.zip`): the file named
 * `<AssetId>_<Resolution>_HDR.exr` (or `.hdr`). The zip also has a `_TONEMAPPED.jpg`, a `.blend`, a `.usdc`, a `.tres` and
 * the `<AssetId>.png` preview, which are not used.
 * @returns the path of the file, undefined for a zip that is not an HDRI
 */
export function findAmbientCGHDRIFile(paths: Iterable<string>): string | undefined {
    for (const path of paths) {
        if (path.startsWith('__MACOSX/') || (path.split('/').pop() || '').startsWith('._')) continue
        if (/_HDR\.(exr|hdr)$/i.test(path)) return path
    }
    return undefined
}

/**
 * Loads an [ambientCG](https://ambientcg.com) zip: a material zip (like `Fabric087_1K-JPG.zip`) as a {@link PhysicalMaterial}
 * with its maps set, an HDRI zip (like `NightEnvironmentHDRI011_1K.zip`) as the equirectangular HDR texture in it.
 * Registered in {@link AssetManager} for the extension `acgzip`, pass it in `fileExtension`:
 *
 * ```ts
 * const material = await viewer.load<PhysicalMaterial>(
 *     'https://acg-download.struffelproductions.com/file/ambientCG-Web/download/Fabric087_PbQRcKaT/Fabric087_1K-JPG.zip',
 *     {fileExtension: 'acgzip'})
 * await viewer.setEnvironmentMap(
 *     'https://acg-download.struffelproductions.com/file/ambientCG-Web/download/NightEnvironmentHDRI011_avlc9BKw/NightEnvironmentHDRI011_1K.zip',
 *     {fileExtension: 'acgzip'})
 * ```
 *
 * The files in the zip are loaded by the {@link AssetImporter} (as for any zip). A zip with a `_HDR.exr`/`_HDR.hdr` file
 * is an HDRI (see {@link findAmbientCGHDRIFile}), the others are materials (see {@link AmbientCGMaterialMaps} and
 * {@link ambientCGMaterialParameters} for the map slots and the material values).
 *
 * The material part is ported from [cc0textures-threejs](https://github.com/repalash/cc0textures-threejs) (ambientCG was CC0 Textures).
 */
export class AmbientCGZipLoader extends ZipLoader implements ILoader<Map<string, IFile>, PhysicalMaterial|ITexture|undefined> {
    /**
     * Set by {@link AssetManager}, loads the files in the zip.
     */
    importer?: IAssetImporter

    /**
     * Run after the zip is loaded: returns the HDR texture of an HDRI zip, or loads the maps of a material zip and returns the material.
     * @param files - the files in the zip, from {@link ZipLoader}
     * @param _ - the import options of the zip (not passed to the files in it)
     */
    async transform(files: Map<string, IFile>, _: ImportAddOptions): Promise<PhysicalMaterial|ITexture|undefined> {
        if (!this.importer) throw new Error('AmbientCGZipLoader: importer not set')
        const hdri = findAmbientCGHDRIFile(files.keys())
        if (hdri) return this._loadHDRI(hdri, files.get(hdri)!)
        return this._loadMaterial(files)
    }

    private async _loadHDRI(path: string, file: IFile): Promise<ITexture|undefined> {
        // not processed here: the texture is processed once as the result of the zip, so it gets the zip url as its
        // rootPath (and is saved as a reference to the zip). Fresh options: the options of the zip (fileExtension) are not for the file.
        const loaded = await this.importer!.importFiles(new Map([[path, file]]), {processRaw: false})
        const texture = loaded?.get(path)?.[0] as ITexture | undefined
        if (!texture?.isTexture) {
            console.error('AmbientCGZipLoader: unable to load the HDRI', path)
            return undefined
        }
        texture.mapping = EquirectangularReflectionMapping
        return texture
    }

    private async _loadMaterial(files: Map<string, IFile>): Promise<PhysicalMaterial|undefined> {
        const {files: mapFiles, assetId, unknown} = pickAmbientCGMapFiles(files.keys())
        if (unknown.length) console.warn('AmbientCGZipLoader: maps with no material slot are not used', unknown)
        const paths = Object.values(mapFiles)
        if (!paths.length) {
            console.error('AmbientCGZipLoader: no ambientCG maps or HDRI in the zip', [...files.keys()])
            return undefined
        }
        const imageFiles = new Map<string, IFile>(paths.map(p => [p, files.get(p)!]))
        // fresh options: the options of the zip (fileExtension) are not for the images
        const loaded = await this.importer!.importFiles(imageFiles, {})
        const textures: Record<string, ITexture | undefined> = {}
        for (const [map, path] of Object.entries(mapFiles)) {
            const texture = loaded?.get(path)?.[0] as ITexture | undefined
            if (texture?.isTexture) textures[map] = texture
            else console.error('AmbientCGZipLoader: unable to load the map', path)
        }
        const material = new PhysicalMaterial(ambientCGMaterialParameters(textures))
        if (assetId) material.name = assetId
        return material
    }
}
