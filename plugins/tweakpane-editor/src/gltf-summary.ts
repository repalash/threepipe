/**
 * What a glTF file holds, read from its JSON: the counts, the meshes, materials, images and animations, the viewer
 * config that threepipe saves in it (`WEBGI_viewer`, with the settings of each plugin), and the sizes in bytes.
 */
export interface GLTFSummary {
    /** The file name, or `Export` */
    name: string
    /** The size of the file, when known */
    fileBytes?: number
    /** The JSON part (in a .glb, its JSON chunk) */
    jsonBytes: number
    /** The binary part (in a .glb, its BIN chunk; buffers that are data URIs in a .gltf) */
    binBytes: number
    /** The part of {@link binBytes} in images */
    imageBytes: number
    generator?: string
    version?: string
    extensionsUsed: string[]
    extensionsRequired: string[]
    counts: {
        scenes: number, nodes: number, meshes: number, primitives: number, triangles: number, vertices: number,
        materials: number, textures: number, images: number, animations: number, cameras: number, lights: number, skins: number,
    }
    meshes: {name: string, primitives: number, triangles: number, vertices: number}[]
    materials: {name: string, extensions: string[]}[]
    images: {name: string, mimeType: string, bytes?: number}[]
    animations: {name: string, channels: number, duration?: number}[]
    /**
     * The viewer config in the first scene (`WEBGI_viewer`): the serialized plugins and resources, with their JSON sizes.
     * The exporter can keep the resources in `extras.BundledResources` instead of in the config; they are counted too.
     */
    viewerConfig?: {
        /** The config and its resources */
        bytes: number
        plugins: {type: string, bytes: number}[]
        /** The resources of the config (materials, textures, ...): their number by kind */
        resources: Record<string, number>
    }
}

/** The JSON and the binary chunk of a .glb, or the JSON of a .gltf (a buffer that does not start with `glTF`) */
export function parseGLTFBuffer(buffer: ArrayBuffer): {json: any, jsonBytes: number, binBytes: number} {
    const view = new DataView(buffer)
    const isGlb = buffer.byteLength >= 12 && view.getUint32(0, true) === 0x46546C67 // 'glTF'
    if (!isGlb) {
        const text = new TextDecoder().decode(buffer)
        const json = JSON.parse(text)
        return {json, jsonBytes: buffer.byteLength, binBytes: dataUriBytes(json.buffers)}
    }
    let offset = 12, json: any = undefined, jsonBytes = 0, binBytes = 0
    while (offset + 8 <= buffer.byteLength) {
        const length = view.getUint32(offset, true)
        const type = view.getUint32(offset + 4, true)
        if (type === 0x4E4F534A) { // 'JSON'
            json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length)))
            jsonBytes = length
        } else if (type === 0x004E4942) { // 'BIN'
            binBytes = length
        }
        offset += 8 + length
    }
    if (!json) throw new Error('No JSON chunk in the glb')
    return {json, jsonBytes, binBytes}
}

/** The bytes of buffers or images given as base64 data URIs (a .gltf without a .bin) */
function dataUriBytes(items: {uri?: string}[] | undefined) {
    let bytes = 0
    for (const it of items ?? []) {
        const uri = it.uri
        if (!uri?.startsWith('data:')) continue
        const comma = uri.indexOf(',')
        bytes += Math.floor((uri.length - comma - 1) * 3 / 4)
    }
    return bytes
}

/** The JSON size of a value, in bytes (UTF-8) */
function jsonSize(value: any) {
    return value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length
}

/**
 * What a glTF JSON holds
 * @param name - the file name
 * @param parsed - from {@link parseGLTFBuffer}
 * @param fileBytes - the size of the file, when known
 */
export function summarizeGLTF(name: string, parsed: {json: any, jsonBytes: number, binBytes: number}, fileBytes?: number): GLTFSummary {
    const json = parsed.json ?? {}
    const accessors: any[] = json.accessors ?? []
    const bufferViews: any[] = json.bufferViews ?? []
    const count = (i: number | undefined) => i === undefined ? 0 : accessors[i]?.count ?? 0

    let triangles = 0, vertices = 0, primitives = 0
    const meshes = (json.meshes ?? []).map((m: any, i: number) => {
        let t = 0, v = 0
        for (const p of m.primitives ?? []) {
            const positions = count(p.attributes?.POSITION)
            const indices = p.indices !== undefined ? count(p.indices) : positions
            const mode = p.mode ?? 4
            if (mode === 4) t += Math.floor(indices / 3)
            else if (mode === 5 || mode === 6) t += Math.max(0, indices - 2) // strip, fan
            v += positions
        }
        primitives += m.primitives?.length ?? 0
        triangles += t
        vertices += v
        return {name: m.name || 'Mesh ' + i, primitives: m.primitives?.length ?? 0, triangles: t, vertices: v}
    })

    const images = (json.images ?? []).map((img: any, i: number) => {
        let bytes: number | undefined
        if (img.bufferView !== undefined) bytes = bufferViews[img.bufferView]?.byteLength
        else if (img.uri?.startsWith('data:')) bytes = dataUriBytes([img])
        const mimeType = img.mimeType || img.uri?.match(/^data:([^;,]+)/)?.[1] || img.uri?.split('.').pop() || ''
        return {name: img.name || img.uri && !img.uri.startsWith('data:') && img.uri || 'Image ' + i, mimeType, bytes}
    })
    const imageBytes = images.reduce((s: number, im: {bytes?: number}) => s + (im.bytes ?? 0), 0)

    const animations = (json.animations ?? []).map((a: any, i: number) => {
        let duration: number | undefined
        for (const s of a.samplers ?? []) {
            const max = accessors[s.input]?.max?.[0]
            if (typeof max === 'number') duration = Math.max(duration ?? 0, max)
        }
        return {name: a.name || 'Animation ' + i, channels: a.channels?.length ?? 0, duration}
    })

    const scene = json.scenes?.[json.scene ?? 0]
    const config = scene?.extensions?.WEBGI_viewer
    // with serialization metadata the exporter moves the resources of the config here (GLTFExporter2)
    const bundled = config?.resources ? undefined : json.extras?.BundledResources
    const viewerConfig = config ? {
        bytes: jsonSize(config) + jsonSize(bundled),
        plugins: (config.plugins ?? []).map((p: any) => ({type: String(p?.type ?? '?'), bytes: jsonSize(p)})),
        resources: Object.fromEntries(Object.entries(config.resources ?? bundled ?? {})
            .filter(([k, v]) => !k.startsWith('__') && v && typeof v === 'object')
            .map(([k, v]) => [k, Object.keys(v as object).length])
            .filter(([, n]) => n as number > 0)) as Record<string, number>,
    } : undefined

    return {
        name, fileBytes,
        jsonBytes: parsed.jsonBytes, binBytes: parsed.binBytes, imageBytes,
        generator: json.asset?.generator, version: json.asset?.version,
        extensionsUsed: json.extensionsUsed ?? [], extensionsRequired: json.extensionsRequired ?? [],
        counts: {
            scenes: json.scenes?.length ?? 0, nodes: json.nodes?.length ?? 0, meshes: meshes.length, primitives, triangles, vertices,
            materials: json.materials?.length ?? 0, textures: json.textures?.length ?? 0, images: images.length,
            animations: animations.length, cameras: json.cameras?.length ?? 0,
            lights: json.extensions?.KHR_lights_punctual?.lights?.length ?? 0, skins: json.skins?.length ?? 0,
        },
        meshes,
        materials: (json.materials ?? []).map((m: any, i: number) => ({name: m.name || 'Material ' + i, extensions: Object.keys(m.extensions ?? {})})),
        images,
        animations,
        viewerConfig,
    }
}

/** A size in bytes, as `12.3 KB` */
export function formatBytes(bytes: number | undefined) {
    if (bytes === undefined) return '?'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
