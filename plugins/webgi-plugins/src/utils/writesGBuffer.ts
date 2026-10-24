import {IMaterial, PhysicalMaterial} from 'threepipe'

/**
 * Whether the G-buffer holds the surface of this material (the rules of GBufferRenderPass.preprocessMaterial). A
 * screen-space buffer at a pixel (SSGI, the SSR trace pass) belongs to the surface in the G-buffer; applied to a
 * surface in front of it, such as glass (transmission) or alpha-blended materials, it would show what is behind it.
 */
export function writesGBuffer(material: IMaterial) {
    const ud = material.userData
    if (ud.pluginsDisabled) return false
    const render = ud.renderToDepth ?? ud.renderToGBuffer
    if (material.transparent) return !!render || material.opacity > 0.99 && !material.map && !material.alphaMap
    if (Math.abs((material as PhysicalMaterial).transmission || 0) > 0) return !!render
    return render !== false
}
