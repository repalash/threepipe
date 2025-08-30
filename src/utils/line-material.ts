import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {IObject3D, LineMaterial2} from '../core'
import {GBufferMaterial} from '../plugins/pipeline/GBufferMaterial'
import {Material, MeshDepthMaterial, NoBlending, RGBADepthPacking} from 'three'
import {shaderReplaceString} from './shader-helpers'

// todo this should be set in the gbuffer plugin
export function createLineGBufferMaterial(object: LineSegments2 & IObject3D, lineDepthMaterial: Material = new GBufferMaterial(true, {
    blending: NoBlending, transparent: false,
})) {
    lineDepthMaterial.onBeforeCompile = (shader) => {
        if ((shader as any).__modified) return
        ;(shader as any).__modified = true
        let lineMaterial = object.material as LineMaterial2
        if (lineMaterial === lineDepthMaterial as any)
            lineMaterial = object.currentMaterial as LineMaterial2
        if (!lineMaterial.isLineMaterial) return
        shader.uniforms = {
            ...lineMaterial.uniforms,
            ...shader.uniforms,
        }
        const parsFrag = shader.fragmentShader.split('void main()')[0].split('#glMarker importsEnd')[1] || ''
        const mainFrag = '\nvec3 normal = vec3(0.,0.,1.);\n' + shader.fragmentShader.split('#glMarker beforeOutput')[1]
        shader.fragmentShader = shaderReplaceString(lineMaterial.fragmentShader, 'void main()', parsFrag + '\n', {prepend: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <logdepthbuf_fragment>', mainFrag + '\n//end-frag-patch\n', {append: true})
        shader.fragmentShader = shader.fragmentShader.split('//end-frag-patch')[0]

        const parsVert = shader.vertexShader.split('void main()')[0].split('#glMarker importsEnd')[1] || ''
        const mainVert = shader.vertexShader.split('#glMarker beforeOutput')[1].replace(/}\s*$/, '') + '\n' // remove last }
        shader.vertexShader = shaderReplaceString(lineMaterial.vertexShader, 'void main()', parsVert, {prepend: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <clipping_planes_vertex>', mainVert, {append: true})
    }
    return lineDepthMaterial
}

export function createLineDepthMaterial(object: LineSegments2 & IObject3D, lineDepthMaterial: Material = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking, // this is required for three.js shadows
    blending: NoBlending,
    transparent: false,
})) {
    lineDepthMaterial.onBeforeCompile = (shader) => {
        if ((shader as any).__modified) return
        ;(shader as any).__modified = true
        let lineMaterial = object.material as LineMaterial2
        if (lineMaterial === lineDepthMaterial as any)
            lineMaterial = object.currentMaterial as LineMaterial2
        if (!lineMaterial.isLineMaterial) return
        shader.uniforms = {
            ...lineMaterial.uniforms,
            ...shader.uniforms,
        }
        shader.defines = {
            ...lineMaterial.defines,
            ...shader.defines,
        }
        const parsFrag = '\nvarying vec2 vHighPrecisionZW;\n#include <packing>\n'
        const mainFrag = shader.fragmentShader.split('#include <logdepthbuf_fragment>')[1]
        shader.fragmentShader = shaderReplaceString(lineMaterial.fragmentShader, 'void main()', parsFrag, {prepend: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <logdepthbuf_fragment>', mainFrag + '\n//end-frag-patch\n', {append: true})
        shader.fragmentShader = shader.fragmentShader.split('//end-frag-patch')[0]

        const parsVert = '\nvarying vec2 vHighPrecisionZW;\n'
        const mainVert = '\nvHighPrecisionZW = gl_Position.zw;\n'
        shader.vertexShader = shaderReplaceString(lineMaterial.vertexShader, 'void main()', parsVert, {prepend: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <clipping_planes_vertex>', mainVert, {append: true})
    }
    return lineDepthMaterial
}
