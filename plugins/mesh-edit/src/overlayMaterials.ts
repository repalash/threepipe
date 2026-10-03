/**
 * Materials for the edit-mode overlay: vertices, edges and faces coloured by a per-element flag.
 *
 * The colours are Blender's default theme (`release/datafiles/userdef/userdef_default_theme.c`,
 * `space_view3d`): unselected vertices and edges black, selected vertices `#ff7a00`, selected edges
 * `#ff9900`, selected faces `#ffa300` at 20%, the active element white. Hover pre-selection is not in
 * Blender's default theme - Blender has no hover highlight in edit mode - so it uses a lighter tint of the
 * selection colour, distinct from both selected and active.
 *
 * The flag is read in the shader, so selection changes rewrite one small attribute instead of geometry,
 * which is what `overlays.ts` was built for. The previous materials multiplied per-vertex colours into a
 * near-black base colour, which made selected elements render black: a selection with no visible effect.
 *
 * Points and lines are pulled slightly towards the camera so they draw over the surface they sit on;
 * otherwise they z-fight with it. Blender's overlay applies a similar depth offset.
 *
 * The fragment shaders end in `colorspace_fragment`, as any three.js `ShaderMaterial` drawn into the
 * scene must: threepipe renders into an RGBM-encoded target by default, and colour written without the
 * output conversion came out decoded as something else - black edges rendered as black-and-white dashes,
 * a red one as white.
 */

import {Color, ShaderMaterial} from 'threepipe'
import {OverlayFlag} from './overlays'

/** Blender's default 3D-view edit-mesh theme colours. */
export const EditTheme = {
    vertex: '#000000',
    vertexSelect: '#ff7a00',
    edge: '#000000',
    edgeSelect: '#ff9900',
    faceSelect: '#ffa300',
    faceSelectAlpha: 0x33 / 255,
    active: '#ffffff',
    /** Hover pre-selection. Not a Blender theme colour; Blender does not pre-highlight. */
    preselect: '#ffd9a8',
    /** `vertex_size = 3` at `U.pixelsize = 1`; points are drawn at twice that, as Blender's overlay does. */
    vertexSizePx: 3,
} as const

const OVERLAY_VERTEX = /* glsl */`
attribute float aFlag;
uniform vec3 uColor;
uniform vec3 uSelect;
uniform vec3 uActive;
uniform vec3 uPreselect;
uniform float uPointSize;
uniform float uDepthBias;
varying vec3 vColor;
varying float vFlag;

bool hasFlag(float flags, float bit) {
    return mod(floor(flags / bit), 2.0) >= 1.0;
}

void main() {
    vFlag = aFlag;
    vColor = uColor;
    if (hasFlag(aFlag, ${OverlayFlag.Preselect.toFixed(1)})) vColor = uPreselect;
    if (hasFlag(aFlag, ${OverlayFlag.Selected.toFixed(1)})) vColor = uSelect;
    if (hasFlag(aFlag, ${OverlayFlag.Active.toFixed(1)})) vColor = uActive;
    // Selected and hovered points are drawn a little larger, so they stand out from a dense mesh.
    float grow = (hasFlag(aFlag, ${OverlayFlag.Selected.toFixed(1)}) || hasFlag(aFlag, ${OverlayFlag.Preselect.toFixed(1)})) ? 1.35 : 1.0;
    gl_PointSize = uPointSize * grow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pull towards the camera in clip space so the overlay wins the depth test against its own surface.
    gl_Position.z -= uDepthBias * gl_Position.w;
}
`

const POINT_FRAGMENT = /* glsl */`
varying vec3 vColor;
varying float vFlag;
void main() {
    // Round dots, as Blender draws vertices.
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
}
`

const LINE_FRAGMENT = /* glsl */`
varying vec3 vColor;
void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
}
`

function overlayMaterial(fragment: string, colors: {base: string, select: string}, pointSize: number): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: OVERLAY_VERTEX,
        fragmentShader: fragment,
        uniforms: {
            uColor: {value: new Color(colors.base)},
            uSelect: {value: new Color(colors.select)},
            uActive: {value: new Color(EditTheme.active)},
            uPreselect: {value: new Color(EditTheme.preselect)},
            uPointSize: {value: pointSize},
            uDepthBias: {value: 2e-4},
        },
    })
    // Theme colours are display colours; keep them out of tone mapping.
    material.toneMapped = false
    return material
}

/** Vertex dots. `pixelRatio` converts the theme's CSS-pixel size to drawing-buffer pixels. */
export function createVertexMaterial(pixelRatio: number): ShaderMaterial {
    return overlayMaterial(POINT_FRAGMENT, {base: EditTheme.vertex, select: EditTheme.vertexSelect},
        2 * EditTheme.vertexSizePx * pixelRatio)
}

export function createEdgeMaterial(): ShaderMaterial {
    return overlayMaterial(LINE_FRAGMENT, {base: EditTheme.edge, select: EditTheme.edgeSelect}, 1)
}

export function setOverlayPixelRatio(material: ShaderMaterial, pixelRatio: number): void {
    material.uniforms.uPointSize.value = 2 * EditTheme.vertexSizePx * pixelRatio
}

export function setOverlayXray(material: ShaderMaterial, xray: boolean): void {
    material.depthTest = !xray
    material.needsUpdate = true
}
