/**
 * Materials for the edit-mode overlay: vertices, edges, face dots and faces coloured by a per-element
 * flag.
 *
 * The colours and sizes are Blender's default theme (`release/datafiles/userdef/userdef_default_theme.c`,
 * `space_view3d`, as listed in the research notes): unselected vertices and edges black, selected
 * vertices `#ff7a00`, selected edges `#ff9900`, selected faces `#ffa300` at 20%, face dots `#ff8a00`,
 * the active element white; `vertex_size` 3, `facedot_size` 3, `edge_width` 1. Hover pre-selection
 * is not in Blender's theme - Blender has no hover highlight in edit mode - so it uses a lighter tint
 * of the selection colour, distinct from both selected and active.
 *
 * The flag is read in the shader, so selection changes rewrite one small attribute instead of
 * geometry, which is what `overlays.ts` was built for. The previous materials multiplied per-vertex
 * colours into a near-black base colour, which made selected elements render black: a selection with
 * no visible effect.
 *
 * Edges are fat lines: each edge is an instanced screen-space quad, as three's `LineMaterial` draws
 * them and as Blender's `overlay_edit_mesh_edge_vert.glsl` expands its line list, with the flag per
 * end so vertex mode can fade an edge from a selected vertex to an unselected one.
 *
 * Points and lines are pulled slightly towards the camera so they draw over the surface they sit on;
 * otherwise they z-fight with it. Blender's overlay applies a similar depth offset
 * (`overlay_edit_mesh_vert.glsl:60`, `:98`).
 *
 * The fragment shaders end in `colorspace_fragment`, as any three.js `ShaderMaterial` drawn into the
 * scene must: threepipe renders into an RGBM-encoded target by default, and colour written without the
 * output conversion came out decoded as something else - black edges rendered as black-and-white dashes,
 * a red one as white.
 */

import {Color, ShaderMaterial, Vector2} from 'threepipe'
import {OverlayFlag} from './overlays'

/** Blender's default 3D-view edit-mesh theme colours and sizes. */
export const EditTheme = {
    vertex: '#000000',
    vertexSelect: '#ff7a00',
    edge: '#000000',
    edgeSelect: '#ff9900',
    faceSelect: '#ffa300',
    faceSelectAlpha: 0x33 / 255,
    /** `face_dot`: a selected face's dot. Unselected dots use the vertex colour. */
    faceDot: '#ff8a00',
    active: '#ffffff',
    /** Hover pre-selection. Not a Blender theme colour; Blender does not pre-highlight. */
    preselect: '#ffd9a8',
    /** `vertex_size = 3` at `U.pixelsize = 1`; points are drawn at twice that, as Blender's overlay does. */
    vertexSizePx: 3,
    /**
     * `facedot_size = 3`. Blender draws the dot at exactly this size; here it is drawn at twice that,
     * the same rule as vertices, so the dots read as the click targets they are.
     */
    facedotSizePx: 3,
    /**
     * `edge_width = 1`. Blender's edge quad is `max(1, edge_width) / 2` on each side plus half a pixel
     * for anti-aliasing (`overlay_edit_mesh_edge_vert.glsl:125`); the same total width is used here.
     */
    edgeWidthPx: 1,
} as const

const FLAG_FUNCTIONS = /* glsl */`
bool hasFlag(float flags, float bit) {
    return mod(floor(flags / bit), 2.0) >= 1.0;
}

vec3 flagColor(float flags, vec3 base, vec3 selectColor, vec3 activeColor, vec3 preselectColor) {
    vec3 c = base;
    if (hasFlag(flags, ${OverlayFlag.Preselect.toFixed(1)})) c = preselectColor;
    if (hasFlag(flags, ${OverlayFlag.Selected.toFixed(1)})) c = selectColor;
    if (hasFlag(flags, ${OverlayFlag.Active.toFixed(1)})) c = activeColor;
    return c;
}
`

const POINT_VERTEX = /* glsl */`
attribute float aFlag;
uniform vec3 uColor;
uniform vec3 uSelect;
uniform vec3 uActive;
uniform vec3 uPreselect;
uniform float uPointSize;
uniform float uDepthBias;
varying vec3 vColor;
varying float vFlag;

${FLAG_FUNCTIONS}

void main() {
    vFlag = aFlag;
    vColor = flagColor(aFlag, uColor, uSelect, uActive, uPreselect);
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

/**
 * The screen-space half of three's `LineMaterial` vertex shader (`examples/jsm/lines/LineMaterial.js`),
 * on `LineSegmentsGeometry`'s instanced quad, with the flag colour per end and the depth bias.
 */
const LINE_VERTEX = /* glsl */`
uniform float linewidth;
uniform vec2 resolution;
uniform vec3 uColor;
uniform vec3 uSelect;
uniform vec3 uActive;
uniform vec3 uPreselect;
uniform float uDepthBias;

attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute float instanceFlagStart;
attribute float instanceFlagEnd;

varying vec3 vColor;
varying vec2 vUv;

${FLAG_FUNCTIONS}

void trimSegment(const in vec4 start, inout vec4 end) {
    // Trim the end segment so it terminates between the camera plane and the near plane.
    float a = projectionMatrix[2][2];
    float b = projectionMatrix[3][2];
    float nearEstimate = -0.5 * b / a;
    float alpha = (nearEstimate - start.z) / (end.z - start.z);
    end.xyz = mix(start.xyz, end.xyz, alpha);
}

void main() {
    float flags = (position.y < 0.5) ? instanceFlagStart : instanceFlagEnd;
    vColor = flagColor(flags, uColor, uSelect, uActive, uPreselect);
    vUv = uv;

    float aspect = resolution.x / resolution.y;

    // Camera space.
    vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
    vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);

    // Segments that end in or behind the camera plane would project wrongly; trim them.
    bool perspective = (projectionMatrix[2][3] == -1.0);
    if (perspective) {
        if (start.z < 0.0 && end.z >= 0.0) {
            trimSegment(start, end);
        } else if (end.z < 0.0 && start.z >= 0.0) {
            trimSegment(end, start);
        }
    }

    // Clip space.
    vec4 clipStart = projectionMatrix * start;
    vec4 clipEnd = projectionMatrix * end;

    // NDC space.
    vec3 ndcStart = clipStart.xyz / clipStart.w;
    vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

    // Direction, with the clip-space aspect ratio accounted for.
    vec2 dir = ndcEnd.xy - ndcStart.xy;
    dir.x *= aspect;
    dir = normalize(dir);

    vec2 offset = vec2(dir.y, -dir.x);
    dir.x /= aspect;
    offset.x /= aspect;

    // Sign flip.
    if (position.x < 0.0) offset *= -1.0;

    // Endcaps.
    if (position.y < 0.0) {
        offset += -dir;
    } else if (position.y > 1.0) {
        offset += dir;
    }

    // Adjust for linewidth, then for the clip-space to screen-space conversion.
    offset *= linewidth;
    offset /= resolution.y;

    // Select the end.
    vec4 clip = (position.y < 0.5) ? clipStart : clipEnd;

    // Back to clip space.
    offset *= clip.w;
    clip.xy += offset;

    gl_Position = clip;
    gl_Position.z -= uDepthBias * gl_Position.w;
}
`

const LINE_FRAGMENT = /* glsl */`
varying vec3 vColor;
varying vec2 vUv;
void main() {
    // Round the endcaps, as three's LineMaterial does.
    if (abs(vUv.y) > 1.0) {
        float a = vUv.x;
        float b = (vUv.y > 0.0) ? vUv.y - 1.0 : vUv.y + 1.0;
        float len2 = a * a + b * b;
        if (len2 > 1.0) discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
}
`

function colorUniforms(colors: {base: string, select: string}) {
    return {
        uColor: {value: new Color(colors.base)},
        uSelect: {value: new Color(colors.select)},
        uActive: {value: new Color(EditTheme.active)},
        uPreselect: {value: new Color(EditTheme.preselect)},
        uDepthBias: {value: 2e-4},
    }
}

function pointMaterial(colors: {base: string, select: string}, pointSize: number): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: POINT_VERTEX,
        fragmentShader: POINT_FRAGMENT,
        uniforms: {...colorUniforms(colors), uPointSize: {value: pointSize}},
    })
    // Theme colours are display colours; keep them out of tone mapping.
    material.toneMapped = false
    return material
}

/** Vertex dots. `pixelRatio` converts the theme's CSS-pixel size to drawing-buffer pixels. */
export function createVertexMaterial(pixelRatio: number): ShaderMaterial {
    return pointMaterial({base: EditTheme.vertex, select: EditTheme.vertexSelect}, 2 * EditTheme.vertexSizePx * pixelRatio)
}

/** Face dots: the vertex colour when unselected, the facedot colour when selected, white when active. */
export function createFaceDotMaterial(pixelRatio: number): ShaderMaterial {
    return pointMaterial({base: EditTheme.vertex, select: EditTheme.faceDot}, 2 * EditTheme.facedotSizePx * pixelRatio)
}

/** The width in CSS pixels a fat edge is drawn at: Blender's edge width plus its anti-aliasing pixel. */
export function edgeLineWidthPx(): number {
    return Math.max(1, EditTheme.edgeWidthPx) + 1
}

/**
 * Fat edges for a `LineSegments2` whose geometry carries `instanceFlagStart` / `instanceFlagEnd`.
 * `resolution` is in CSS pixels, which `LineSegments2.onBeforeRender` keeps up to date from the
 * renderer's viewport, so `linewidth` is in CSS pixels too.
 */
export function createEdgeMaterial(): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: LINE_VERTEX,
        fragmentShader: LINE_FRAGMENT,
        uniforms: {
            ...colorUniforms({base: EditTheme.edge, select: EditTheme.edgeSelect}),
            linewidth: {value: edgeLineWidthPx()},
            resolution: {value: new Vector2(1, 1)},
        },
    })
    material.toneMapped = false
    return material
}

export function setOverlayPixelRatio(material: ShaderMaterial, pixelRatio: number, sizePx = EditTheme.vertexSizePx): void {
    material.uniforms.uPointSize.value = 2 * sizePx * pixelRatio
}

export function setOverlayXray(material: ShaderMaterial, xray: boolean): void {
    material.depthTest = !xray
    material.needsUpdate = true
}
