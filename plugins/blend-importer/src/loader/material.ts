import {ClampToEdgeWrapping, DoubleSide, FrontSide, MirroredRepeatWrapping, RepeatWrapping, SRGBColorSpace, Texture} from 'threepipe'
import {Ctx} from './ctx'

// Material.blend_flag bit for the "Backface Culling" toggle (DNA_material_types.h: MA_BL_CULL_BACKFACE).
// The Python `use_backface_culling` property binds to this exact bit (rna_material.cc:1136).
const MA_BL_CULL_BACKFACE = 1 << 2
// Material.blend_method: alpha-clip cutout (DNA_material_types.h: MA_BM_CLIP). HASHED(4)/BLEND(5)/SOLID(0)
// map to alpha blend; only CLIP becomes an alpha test.
const MA_BM_CLIP = 3

// Faithful-ish port of Blender's glTF exporter material extraction (Principled BSDF -> glTF PBR),
// mapped onto three.js MeshPhysicalMaterial (which is glTF-first). Reference:
//   .repos/gltf-blender-io/addons/io_scene_gltf2/blender/exp/material/{pbr_metallic_roughness,materials,search_node_tree}.py
// We read the shader that feeds the active Material Output, take each property from its named socket
// (constant default or a packed Image Texture), and apply the same defaults/clamps the exporter uses.
// Only packed images load (external file-path images are skipped). Linear vs sRGB matches glTF convention:
// base color + emissive factors are linear (Blender scene-linear == three.js linear); base/emissive
// textures are sRGB, all other maps (roughness/metallic/normal) are linear.

// ── Node-tree helpers ───────────────────────────────────────────────
function listBaseToArray(lb: any): any[] {
    const out: any[] = []
    if (!lb) return out
    let n = lb.first, guard = 0
    while (n && guard++ < 8192) { out.push(n); n = n.next }
    return out
}
const idnameOf = (n: any): string => (n && typeof n.idname === 'string' ? n.idname : '')
const nameOf = (s: any): string => (s && typeof s.name === 'string' ? s.name : '')

function socketByName(sockets: any[], ...names: string[]): any {
    for (const name of names) {
        const s = sockets.find(x => nameOf(x) === name)
        if (s) return s
    }
    return null
}
function inputsOf(node: any): any[] { return node ? listBaseToArray(node.inputs) : [] }

// A socket's constant value (bNodeSocketValueRGBA/Float/Vector expose default_value.value).
function socketConst(sock: any): any {
    const dv = sock && sock.default_value
    return dv ? dv.value : undefined
}
const num = (v: any): number | undefined => (typeof v === 'number' ? v : undefined)
const clamp01 = (c: number) => Math.max(0, Math.min(1, c))

// Follow the link into `socket`, hopping through Reroute nodes, and return the source node.
function nodeFeeding(links: any[], socket: any): any {
    if (!socket) return null
    let link = links.find(l => l.tosock === socket)
    let guard = 0
    while (link && idnameOf(link.fromnode).includes('Reroute') && guard++ < 32) {
        const re = inputsOf(link.fromnode)[0]
        link = links.find(l => l.tosock === re)
    }
    return link ? link.fromnode : null
}

// ── Packed image -> three.js Texture ────────────────────────────────
function imageMime(b: Uint8Array): string | null {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
    return null
}
// Load the packed image of an Image Texture node. `srgb` for color maps (base/emissive); false for data maps.
function packedTexture(imageNode: any, srgb: boolean): Texture | null {
    const img = imageNode && imageNode.id
    if (!img) return null
    const pf = img.packedfile || (img.packedfiles && img.packedfiles.first && img.packedfiles.first.packedfile)
    const block = pf && pf.data
    const size = pf && typeof pf.size === 'number' ? pf.size : 0
    if (!block || block.__data_address__ === undefined || size <= 0) return null
    // Bounds-check before constructing the view: a stale/corrupt PackedFile.size or address would otherwise
    // make `new Uint8Array(buffer, offset, size)` throw a RangeError that bubbles up and fails the whole
    // import. Skip the one bad texture instead.
    const buf = block.__blender_file__.byte.buffer
    if (block.__data_address__ + size > buf.byteLength) return null
    const bytes = new Uint8Array(buf, block.__data_address__, size).slice()
    const mime = imageMime(bytes)
    if (!mime || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof Image === 'undefined') return null
    const url = URL.createObjectURL(new Blob([bytes], {type: mime}))
    const el = new Image()
    const texture = new Texture(el)
    if (srgb) texture.colorSpace = SRGBColorSpace
    texture.name = (typeof img.aname === 'string' ? img.aname : '') || 'blendTexture'
    el.onload = () => { texture.needsUpdate = true; URL.revokeObjectURL(url) }
    el.onerror = () => { URL.revokeObjectURL(url) }
    el.src = url
    return texture
}
// Image source enum (DNA_image_types.h): GENERATED = 4, VIEWER = 5 have no backing file.
const IMA_SRC_GENERATED = 4, IMA_SRC_VIEWER = 5
// Resolve an Image Texture node's image to a Texture: packed bytes if embedded, else an external file
// load through threepipe's pipeline (ctx.loadExternalTexture, when provided). External images reference a
// file by path in `Image.name` (e.g. "//tex/wood.png"). `source` is usually IMA_SRC_FILE (1), but some
// files store 0 for a file reference that wasn't loaded at save time — so treat any non-packed image with
// a path as external, excluding only GENERATED/VIEWER (which have no real file).
// Map the Image Texture node's "Extension" (NodeTexImage.extension) to a three.js wrap mode. Blender's
// DEFAULT is Repeat (0) — three.js defaults to ClampToEdge, so without this any mesh whose UVs fall outside
// [0,1] (very common: tiled materials, the Poly Haven preview sphere whose unwrap spans U[-0.5,1.5]) clamps
// to the edge texel and smears it into stripes instead of tiling. SHD_IMAGE_EXTENSION_*: 0 Repeat, 1 Extend,
// 2 Clip, 3 Mirror.
function applyWrap(tex: Texture | null, imageNode: any): Texture | null {
    if (!tex) return tex
    const ext = imageNode?.storage?.extension
    tex.wrapS = tex.wrapT = ext === 1 || ext === 2 ? ClampToEdgeWrapping : ext === 3 ? MirroredRepeatWrapping : RepeatWrapping
    tex.needsUpdate = true
    return tex
}
function imageNodeTexture(imageNode: any, srgb: boolean, ctx: Ctx): Texture | null {
    const packed = packedTexture(imageNode, srgb)
    if (packed) return applyWrap(packed, imageNode)
    const img = imageNode && imageNode.id
    if (img && img.source !== IMA_SRC_GENERATED && img.source !== IMA_SRC_VIEWER
        && typeof img.name === 'string' && img.name && ctx.loadExternalTexture) {
        return applyWrap(ctx.loadExternalTexture(img.name, srgb), imageNode)
    }
    return null
}
// The Image Texture node feeding a socket (directly, or through a Normal Map node for normals), or null.
function imageNodeFeeding(links: any[], socket: any): any {
    let src = nodeFeeding(links, socket)
    if (src && idnameOf(src).includes('NormalMap')) src = nodeFeeding(links, socketByName(inputsOf(src), 'Color'))
    return src && idnameOf(src).includes('TexImage') ? src : null
}
// Trace a socket to its Image Texture node and load it.
function textureFromSocket(links: any[], socket: any, srgb: boolean, ctx: Ctx): Texture | null {
    const src = imageNodeFeeding(links, socket)
    return src ? imageNodeTexture(src, srgb, ctx) : null
}

// ── Surface shader resolution ───────────────────────────────────────
// Prefer the Principled BSDF feeding the active Material Output (matches the exporter's
// check_if_is_linked_to_active_output); fall back to any Principled in the tree.
function resolveShaders(nodes: any[], links: any[]): {principled: any, emission: any} {
    const outputs = nodes.filter(n => idnameOf(n).includes('OutputMaterial'))
    const activeOut = outputs.find(n => n.is_active_output) || outputs[0]
    let principled: any = null, emission: any = null
    if (activeOut) {
        let surf = nodeFeeding(links, socketByName(inputsOf(activeOut), 'Surface'))
        // hop through a single Mix/Add Shader to find a Principled, best-effort
        let guard = 0
        while (surf && !idnameOf(surf).includes('BsdfPrincipled') && guard++ < 4) {
            if (idnameOf(surf).includes('Emission') && !emission) emission = surf
            const next = inputsOf(surf).map(s => nodeFeeding(links, s)).find(n => n && idnameOf(n).includes('BsdfPrincipled'))
            if (!next) break
            surf = next
        }
        if (surf && idnameOf(surf).includes('BsdfPrincipled')) principled = surf
    }
    if (!principled) principled = nodes.find(n => idnameOf(n).includes('BsdfPrincipled'))
    if (!emission) emission = nodes.find(n => idnameOf(n) === 'ShaderNodeEmission')
    return {principled, emission}
}

/**
 * Build a PhysicalMaterial from a Blender material, following Blender's glTF exporter mapping.
 */
export function createMaterial(mat: any, ctx: Ctx) {
    const material = new ctx.MeshPhysicalMaterial()

    // Blender materials default to backface culling OFF, i.e. they render double-sided. The glTF exporter
    // maps this directly: doubleSided = not use_backface_culling (materials.py:289). three.js defaults to
    // FrontSide, so without this most thin/open geometry (planes, leaves, interiors) is invisible from
    // behind. Only the explicit "Backface Culling" toggle (MA_BL_CULL_BACKFACE) forces single-sided.
    material.side = (typeof mat.blend_flag === 'number' && (mat.blend_flag & MA_BL_CULL_BACKFACE)) ? FrontSide : DoubleSide

    const nodes = mat.nodetree ? listBaseToArray(mat.nodetree.nodes) : []
    const links = mat.nodetree ? listBaseToArray(mat.nodetree.links) : []
    const {principled, emission} = resolveShaders(nodes, links)

    let applied = false
    if (principled) {
        const inp = inputsOf(principled)
        applied = true

        // Base color: texture takes precedence; factor (clamped) otherwise. (pbr_metallic_roughness.py:73)
        const baseSock = socketByName(inp, 'Base Color', 'BaseColor')
        const baseImgNode = imageNodeFeeding(links, baseSock)
        const baseTex = baseImgNode ? imageNodeTexture(baseImgNode, true, ctx) : null
        if (baseTex) {
            material.map = baseTex
            material.color.setRGB(1, 1, 1)
        } else {
            const base = socketConst(baseSock)
            if (base && base.length >= 3) material.color.setRGB(clamp01(base[0]), clamp01(base[1]), clamp01(base[2]))
        }

        // Roughness / Metallic (factor or grayscale map; three.js reads G/B but greyscale maps work).
        const roughSock = socketByName(inp, 'Roughness')
        const roughTex = textureFromSocket(links, roughSock, false, ctx)
        if (roughTex) material.roughnessMap = roughTex
        else { const r = num(socketConst(roughSock)); if (r !== undefined) material.roughness = r }
        const metalSock = socketByName(inp, 'Metallic')
        const metalTex = textureFromSocket(links, metalSock, false, ctx)
        if (metalTex) material.metalnessMap = metalTex
        else { const m = num(socketConst(metalSock)); if (m !== undefined) material.metalness = m }

        // Normal map + strength (materials.py:376; Normal Map node "Strength").
        const normSrc = nodeFeeding(links, socketByName(inp, 'Normal'))
        if (normSrc) {
            const normTex = textureFromSocket(links, socketByName(inp, 'Normal'), false, ctx)
            if (normTex) {
                material.normalMap = normTex
                const strength = num(socketConst(socketByName(inputsOf(normSrc), 'Strength')))
                if (strength !== undefined && material.normalScale) material.normalScale.set(strength, strength)
            }
        }

        // Alpha -> opacity (constant) or alphaMap (texture), plus the alpha *mode* from the material's
        // Eevee blend_method. Only applied when the material actually has an alpha input, so opaque
        // materials are never made see-through (notably the default material, which reports HASHED but
        // is fully opaque at alpha=1). Mode mapping is the canonical glTF one: CLIP -> alpha test
        // (cutout, using alpha_threshold); HASHED/BLEND/SOLID -> alpha blend. The 4.2+ glTF exporter
        // derives this from the node graph, but blend_method is the authoritative stored value for <=4.1
        // and a usable hint after (gather_alpha_info — search_node_tree.py).
        const alphaSock = socketByName(inp, 'Alpha')
        const alphaImgNode = imageNodeFeeding(links, alphaSock)
        // If Alpha comes from the SAME image as Base Color (the common cutout setup: Image.Color -> Base
        // Color, Image.Alpha -> Alpha), three.js material.map (RGBA) already supplies per-pixel opacity from
        // the texture's alpha channel. A separate material.alphaMap would instead read the GREEN channel
        // (three.js samples alphaMap.g), giving wrong cutouts — so only use a distinct alphaMap when the
        // alpha image differs from the base image.
        const alphaFromBase = !!(alphaImgNode && baseImgNode && alphaImgNode === baseImgNode)
        const alphaTex = (alphaImgNode && !alphaFromBase) ? imageNodeTexture(alphaImgNode, false, ctx) : null
        const alphaC = num(socketConst(alphaSock))
        const hasAlpha = !!alphaTex || alphaFromBase || (alphaC !== undefined && alphaC < 1.0)
        if (alphaTex) material.alphaMap = alphaTex
        else if (!alphaFromBase && alphaC !== undefined && alphaC < 1.0) material.opacity = alphaC
        if (hasAlpha) {
            if (mat.blend_method === MA_BM_CLIP) {
                const thr = num(mat.alpha_threshold)
                material.alphaTest = thr !== undefined && thr > 0 ? thr : 0.5
            } else material.transparent = true
        }

        // IOR (extensions/ior.py — default 1.5).
        const ior = num(socketConst(socketByName(inp, 'IOR')))
        if (ior !== undefined && (material as any).ior !== undefined) (material as any).ior = ior

        // Transmission (extensions/transmission.py — "Transmission Weight"/"Transmission").
        const trans = num(socketConst(socketByName(inp, 'Transmission Weight', 'Transmission')))
        if (trans !== undefined && trans > 0 && (material as any).transmission !== undefined) {
            (material as any).transmission = trans
        }

        // Clearcoat / Coat (extensions/clearcoat.py — "Coat Weight"/"Clearcoat", roughness default 0.03).
        const coat = num(socketConst(socketByName(inp, 'Coat Weight', 'Clearcoat')))
        if (coat !== undefined && coat > 0 && (material as any).clearcoat !== undefined) {
            (material as any).clearcoat = coat
            const cr = num(socketConst(socketByName(inp, 'Coat Roughness', 'Clearcoat Roughness')))
            if (cr !== undefined) (material as any).clearcoatRoughness = cr
        }

        // Sheen (extensions/sheen.py — "Sheen Weight"/"Sheen" gates; color + roughness).
        const sheen = num(socketConst(socketByName(inp, 'Sheen Weight', 'Sheen')))
        if (sheen !== undefined && sheen > 0 && (material as any).sheen !== undefined) {
            (material as any).sheen = sheen
            const stint = socketConst(socketByName(inp, 'Sheen Tint'))
            if (stint && stint.length >= 3 && (material as any).sheenColor) (material as any).sheenColor.setRGB(stint[0], stint[1], stint[2])
            const sr = num(socketConst(socketByName(inp, 'Sheen Roughness')))
            if (sr !== undefined) (material as any).sheenRoughness = sr
        }

        // Specular IOR Level -> specularIntensity (extensions/specular.py — factor is ×2, three.js range 0..1).
        const spec = num(socketConst(socketByName(inp, 'Specular IOR Level', 'Specular')))
        if (spec !== undefined && (material as any).specularIntensity !== undefined) {
            (material as any).specularIntensity = Math.min(1, spec * 2)
        }
    }

    // Displacement: Material Output "Displacement" <- Displacement node <- Height image. three.js
    // `displacementMap` moves vertices along the normal (needs tessellated geometry); we also drive
    // `bumpMap` from the same height so the relief is visible on coarse meshes, but only when there is no
    // normal map (bump + normal would double-perturb). Scale comes from the Displacement node, clamped.
    const matOutput = nodes.find(n => idnameOf(n).includes('OutputMaterial') && n.is_active_output)
        || nodes.find(n => idnameOf(n).includes('OutputMaterial'))
    const dispNode = matOutput ? nodeFeeding(links, socketByName(inputsOf(matOutput), 'Displacement')) : null
    if (dispNode && idnameOf(dispNode).includes('Displacement')) {
        const heightTex = textureFromSocket(links, socketByName(inputsOf(dispNode), 'Height'), false, ctx)
        if (heightTex) {
            const scale = num(socketConst(socketByName(inputsOf(dispNode), 'Scale')))
            const s = scale !== undefined && scale > 0 ? scale : 1
            const mid = num(socketConst(socketByName(inputsOf(dispNode), 'Midlevel')))
            if ((material as any).displacementMap !== undefined) {
                (material as any).displacementMap = heightTex
                ;(material as any).displacementScale = s
                ;(material as any).displacementBias = -(mid ?? 0.5) * s
            }
            // Bump fallback for un-tessellated meshes — only when the material has no normal map.
            if (!material.normalMap && (material as any).bumpMap !== undefined) {
                (material as any).bumpMap = heightTex
                ;(material as any).bumpScale = s
            }
        }
    }

    // Emission: dedicated Emission node "Color"/"Strength", else Principled "Emission Color"/"Emission".
    const emSock = emission ? socketByName(inputsOf(emission), 'Color')
        : (principled ? socketByName(inputsOf(principled), 'Emission Color', 'Emission') : null)
    const emStrSock = emission ? socketByName(inputsOf(emission), 'Strength')
        : (principled ? socketByName(inputsOf(principled), 'Emission Strength') : null)
    const emTex = textureFromSocket(links, emSock, true, ctx)
    let emCol = socketConst(emSock)
    // When a texture drives emission, the Emission Color factor multiplies it. Blender's default factor is
    // black [0,0,0] (and stays black even with a texture linked), which would zero out the map — so treat a
    // missing/short/all-black factor as white so the emissive map is actually visible.
    if (emTex && (!emCol || emCol.length < 3 || (!emCol[0] && !emCol[1] && !emCol[2]))) emCol = [1, 1, 1]
    if (emCol && emCol.length >= 3 && (emCol[0] || emCol[1] || emCol[2] || emTex)) {
        const f = [emCol[0], emCol[1], emCol[2]]
        const strength = num(socketConst(emStrSock))
        if (typeof strength === 'number') for (let i = 0; i < 3; i++) f[i] *= strength
        // Split intensity from color like the exporter (materials.py:149): keep color <=1, push the rest into intensity.
        const peak = Math.max(f[0], f[1], f[2])
        if (peak > 1) { material.emissiveIntensity = peak; material.emissive.setRGB(f[0] / peak, f[1] / peak, f[2] / peak) }
        else material.emissive.setRGB(f[0], f[1], f[2])
    }

    if (!applied) {
        // Legacy fallback — Blender material's viewport diffuse color (often just 0.8 grey).
        if (mat.r !== undefined) material.color.setRGB(mat.r, mat.g, mat.b)
        material.roughness = mat.roughness !== undefined ? mat.roughness : 0.4
        material.metalness = mat.metallic !== undefined ? mat.metallic : 0.0
    }

    return material
}
