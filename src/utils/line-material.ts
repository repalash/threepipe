import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import type {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js'
import {IObject3D, LineMaterial2} from '../core'
import {GBufferMaterial} from '../plugins/pipeline/GBufferMaterial'
import {IUniform, Material, MeshDepthMaterial, NoBlending, RGBADepthPacking} from 'three'
import {shaderReplaceString} from './shader-helpers'

/** The shader of a material in `onBeforeCompile`, as {@link mergeLineShader} changes it */
export interface LineMergeShader {
    vertexShader: string
    fragmentShader: string
    uniforms: Record<string, IUniform>
    defines?: Record<string, any>
}

/** The code that {@link mergeLineShader} adds to the line shaders */
export interface LineMergeParts {
    /** Declarations, before `main()` of the vertex shader */
    parsVert?: string
    /** Code in `main()` of the vertex shader, after `gl_Position` and `mvPosition` (the view-space point of the segment end) are set */
    mainVert?: string
    /** Declarations, before `main()` of the fragment shader */
    parsFrag?: string
    /**
     * Code in `main()` of the fragment shader after the caps and dashes are cut and `diffuseColor` and `alpha` are set.
     * It replaces the rest of `main()`, so it writes `gl_FragColor` and ends with the closing `}`. Not set: the line keeps
     * its own output (`diffuseColor.rgb` with `alpha`).
     */
    mainFrag?: string
}

/**
 * Makes a material draw fat lines (LineSegments2, Line2 with a LineMaterial): call it in the `onBeforeCompile` of the
 * material. A fat line is a set of instanced quads that the vertex shader of its LineMaterial turns into a screen-space
 * (or world-space) line, so another material draws it as big rectangles. This takes the shaders of the line material
 * and adds the code of the material to them ({@link LineMergeParts}). The uniforms of the line material (line width,
 * resolution, dashes) are added under those of `shader`, so the uniforms of the material win.
 * @param shader - the shader of `onBeforeCompile`
 * @param lineMaterial - the line material whose shaders draw the line
 * @param parts - the code to add
 * @param mergeDefines - add the defines of the line material (dashes, world units, alpha to coverage) under those of `shader`
 */
export function mergeLineShader(shader: LineMergeShader, lineMaterial: LineMaterial, parts: LineMergeParts, mergeDefines = true) {
    shader.uniforms = {
        ...lineMaterial.uniforms,
        ...shader.uniforms,
    }
    if (mergeDefines) shader.defines = {
        ...lineMaterial.defines,
        ...shader.defines,
    }
    shader.fragmentShader = shaderReplaceString(lineMaterial.fragmentShader, 'void main()', parts.parsFrag ?? '', {prepend: true})
    if (parts.mainFrag !== undefined) {
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <logdepthbuf_fragment>', parts.mainFrag + '\n//end-frag-patch\n', {append: true})
        shader.fragmentShader = shader.fragmentShader.split('//end-frag-patch')[0]
    }
    shader.vertexShader = shaderReplaceString(lineMaterial.vertexShader, 'void main()', parts.parsVert ?? '', {prepend: true})
    shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <clipping_planes_vertex>', parts.mainVert ?? '', {append: true})
}

// todo this should be set in the gbuffer plugin
export function createLineGBufferMaterial(object: LineSegments2 & IObject3D, lineDepthMaterial: Material = new GBufferMaterial(true, {
    blending: NoBlending, transparent: false,
})) {
    lineDepthMaterial.onBeforeCompile = (shader) => {
        if ((shader as any).__modified) return
        ;(shader as any).__modified = true
        let lineMaterial = object.material as LineMaterial2
        // this material, or another one set as forcedOverrideMaterial (ViewOverridesPlugin): the own material of the line
        if (!lineMaterial?.isLineMaterial)
            lineMaterial = object.currentMaterial as LineMaterial2
        if (!lineMaterial?.isLineMaterial) return
        mergeLineShader(shader, lineMaterial, {
            parsFrag: (shader.fragmentShader.split('void main()')[0].split('#glMarker importsEnd')[1] || '') + '\n',
            mainFrag: '\nvec3 normal = vec3(0.,0.,1.);\n' + shader.fragmentShader.split('#glMarker beforeOutput')[1],
            parsVert: shader.vertexShader.split('void main()')[0].split('#glMarker importsEnd')[1] || '',
            mainVert: shader.vertexShader.split('#glMarker beforeOutput')[1].replace(/}\s*$/, '') + '\n', // remove last }
        }, false)
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
        // this material, or another one set as forcedOverrideMaterial (ViewOverridesPlugin): the own material of the line
        if (!lineMaterial?.isLineMaterial)
            lineMaterial = object.currentMaterial as LineMaterial2
        if (!lineMaterial?.isLineMaterial) return
        mergeLineShader(shader, lineMaterial, {
            parsFrag: '\nvarying vec2 vHighPrecisionZW;\n#include <packing>\n',
            mainFrag: shader.fragmentShader.split('#include <logdepthbuf_fragment>')[1],
            parsVert: '\nvarying vec2 vHighPrecisionZW;\n',
            mainVert: '\nvHighPrecisionZW = gl_Position.zw;\n',
        })
    }
    return lineDepthMaterial
}
