import {
    AScreenPassExtensionPlugin,
    Color,
    DoubleSide,
    GBufferPlugin,
    HalfFloatType,
    ICamera,
    IObject3D,
    IPipelinePass,
    IRenderManager,
    IScene,
    IWebGLRenderer,
    NearestFilter,
    Object3D,
    RenderPass,
    ShaderMaterial,
    Texture,
    ThreeViewer,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'

/**
 * Selection outline drawn in the render pipeline (replaces the OutlinePlugin of webgi-plugins, does not extend it).
 *
 * 1. {@link SelectionMaskPass} renders the selected and hovered meshes into a half-float mask:
 *    R = selected item id, G = part id inside that item, B = hovered, A = linear depth.
 *    It has its own depth buffer, so hidden parts of the selection are in the mask too.
 * 2. The screen pass extension reads the mask and draws, after tonemapping:
 *    an anti-aliased outer outline (selection and hover), thin lines between parts (segmentation),
 *    dashed outline where the selection is hidden behind other objects, a fill tint, and optionally dims the rest.
 */
export class SelectionOutlinePlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'SelectionOutlinePlugin'
    enabled = true
    dependencies = [GBufferPlugin, SelectionUxPlugin]

    readonly extraUniforms = {
        tSuxMask: {value: null as Texture | null},
        suxMaskSize: {value: new Vector2(1, 1)},
        suxSelColor: {value: new Color()},
        suxHoverColor: {value: new Color()},
        suxWidth: {value: 2},
        suxHoverWidth: {value: 1.5},
        suxFill: {value: 0},
        suxXray: {value: 1},
        suxParts: {value: 0},
        suxDim: {value: 0},
        suxActive: {value: 0},
        suxHasSel: {value: 0},
    }

    /** after tonemapping and the other extensions, so the colors are exact */
    priority = -110

    protected _shaderPatch = 'diffuseColor = suxOutline(diffuseColor);'

    parsFragmentSnippet = () => this.isDisabled() ? '' : OUTLINE_GLSL

    private _pass?: SelectionMaskPass
    private _target?: WebGLRenderTarget

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._target = viewer.renderManager.createTarget<WebGLRenderTarget>({
            type: HalfFloatType,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            generateMipmaps: false,
            depthBuffer: true,
        })
        this._target.texture.name = 'selectionMask'
        this._pass = new SelectionMaskPass(() => this._target, new ShaderMaterial({
            uniforms: {
                cameraNearFar: {value: new Vector2(0.1, 100)},
                itemData: {value: new Vector3()},
            },
            vertexShader: MASK_VERT,
            fragmentShader: MASK_FRAG,
            side: DoubleSide,
        }))
        this._pass.getItems = this._getItems
        viewer.renderManager.registerPass(this._pass)
        viewer.addEventListener('preRender', this._preRender)
        const ux = viewer.getPlugin(SelectionUxPlugin)!
        ux.addEventListener('uxUpdate', this._uxUpdate)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('preRender', this._preRender)
        viewer.getPlugin(SelectionUxPlugin)?.removeEventListener('uxUpdate', this._uxUpdate)
        if (this._pass) {
            viewer.renderManager.unregisterPass(this._pass)
            this._pass.dispose()
        }
        if (this._target) viewer.renderManager.disposeTarget(this._target)
        this._pass = undefined
        this._target = undefined
        super.onRemove(viewer)
    }

    private _lastKey = ''
    private _uxUpdate = (e: {reason: string}) => {
        // the mask only changes with the selection, the hover and the settings. Transforms re-render anyway.
        if (e.reason === 'drag' || e.reason === 'transform') return
        const key = this._stateKey()
        if (key === this._lastKey) return
        this._lastKey = key
        this._viewer?.setDirty()
    }

    private _ux() {
        return this._viewer?.getPlugin(SelectionUxPlugin)
    }

    private _stateKey() {
        const ux = this._ux()
        if (!ux) return ''
        const s = ux.settings
        return [ux.selected.map(o => o.uuid).join(), (ux.externalHover || ux.hovered)?.uuid, JSON.stringify(s)].join('|')
    }

    /** Which meshes go in the mask, and their ids */
    private _getItems = (): Map<Object3D, Vector3> => {
        const items = new Map<Object3D, Vector3>()
        const ux = this._ux()
        if (!ux || !this._active(ux)) return items
        const s = ux.settings
        const sel = s.outlineSelected ? ux.selected : []
        sel.forEach((o, i) => {
            // parts: the children one level down, the ones a double-click would select
            const L = ux.levels(o)
            const level = L.find(l => l.includes(o))
            const deepest = level ? level[level.length - 1] : o
            const parts = deepest.children
            o.traverseVisible(m => {
                if (!(m as IObject3D).geometry || !(m as any).isMesh) return
                let part = 0
                let p: Object3D | null = m
                while (p && p.parent && p.parent !== deepest && p !== o) p = p.parent
                if (p && p.parent === deepest) part = parts.indexOf(p) + 1
                items.set(m, new Vector3(i + 1, part, 0))
            })
        })
        const hover = s.outlineHover ? ux.externalHover || ux.hovered : null
        if (hover && !(ux.selected.includes(hover) && s.outlineSelected)) hover.traverseVisible(m => {
            if (!(m as IObject3D).geometry || !(m as any).isMesh) return
            const v = items.get(m)
            if (v) v.z = 1
            else items.set(m, new Vector3(0, 0, 1))
        })
        return items
    }

    private _active(ux: SelectionUxPlugin) {
        const s = ux.settings
        return !this.isDisabled() && s.visual !== 'legacy' && (s.outlineSelected || s.outlineHover)
    }

    private _preRender = () => {
        const ux = this._ux()
        if (!ux || !this._target || !this._viewer) return
        const s = ux.settings
        const u = this.extraUniforms
        const active = this._active(ux) && (ux.selected.length > 0 || !!(ux.externalHover || ux.hovered))
        if (this._pass) this._pass.enabled = active
        u.suxActive.value = active ? 1 : 0
        u.suxHasSel.value = s.outlineSelected && ux.selected.length ? 1 : 0
        u.tSuxMask.value = this._target.texture
        u.suxMaskSize.value.set(this._target.width, this._target.height)
        u.suxSelColor.value.set(s.accent)
        u.suxHoverColor.value.set(s.accent)
        const scale = this._viewer.renderManager.renderScale
        u.suxWidth.value = s.outlineWidth * scale
        u.suxHoverWidth.value = Math.max(1, s.outlineWidth * 0.75) * scale
        u.suxFill.value = s.fillTint ? 0.12 : 0
        u.suxXray.value = s.outlineXray ? 1 : 0
        u.suxParts.value = s.outlineParts ? 0.6 : 0
        u.suxDim.value = s.dimOthers ? 0.55 : 0
        this._viewer.renderManager.screenPass.material.uniformsNeedUpdate = true
    }
}

export class SelectionMaskPass extends RenderPass implements IPipelinePass<'selectionMask'> {
    readonly passId = 'selectionMask'
    before = ['render']
    after = ['gbuffer']
    required = ['render']
    enabled = true
    declare scene?: IScene
    declare camera?: ICamera
    declare overrideMaterial: ShaderMaterial
    getItems: () => Map<Object3D, Vector3> = () => new Map()
    private _items = new Map<Object3D, Vector3>()
    static Layer = 7

    constructor(public target: () => WebGLRenderTarget | undefined, material: ShaderMaterial) {
        super(undefined, undefined, material, new Color(0, 0, 0), 1)
        material.onBeforeRender = (_r, _s, _c, _g, object) => {
            const d = this._items.get(object)
            if (d) material.uniforms.itemData.value.copy(d)
            material.uniformsNeedUpdate = true
        }
    }

    beforeRender(scene: IScene, camera: ICamera, _: IRenderManager) {
        this.scene = scene
        this.camera = camera
        camera.updateShaderProperties(this.overrideMaterial)
    }

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget | null, _1?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        const target = this.target()
        if (!this.scene || !this.camera || !target) return
        const t = renderer.getRenderTarget()
        const face = renderer.getActiveCubeFace()
        const mip = renderer.getActiveMipmapLevel()
        this._items = this.getItems()
        if (!this._items.size) {
            const c = renderer.getClearColor(new Color())
            const a = renderer.getClearAlpha()
            renderer.setRenderTarget(target)
            renderer.setClearColor(0x000000, 1)
            renderer.clear(true, true)
            renderer.setClearColor(c, a)
        } else {
            const layer = SelectionMaskPass.Layer
            for (const o of this._items.keys()) o.layers.enable(layer)
            const mask = this.camera.layers.mask
            this.camera.layers.set(layer)
            renderer.renderWithModes({
                shadowMapRender: false,
                backgroundRender: false,
                opaqueRender: true,
                transparentRender: true,
                transmissionRender: false,
                mainRenderPass: false,
            }, () => super.render(renderer, writeBuffer as any, target, deltaTime as any, maskActive as any))
            for (const o of this._items.keys()) o.layers.disable(layer)
            this.camera.layers.mask = mask
        }
        renderer.setRenderTarget(t, face, mip)
    }

    dispose() {
        this.scene = undefined
        this.camera = undefined
        this._items.clear()
        this.overrideMaterial.dispose()
        super.dispose?.()
    }
}

const MASK_VERT = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vViewPosition;
void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    #include <clipping_planes_vertex>
    vViewPosition = - mvPosition.xyz;
}
`

const MASK_FRAG = /* glsl */`
uniform vec2 cameraNearFar;
uniform vec3 itemData;
varying vec3 vViewPosition;
void main() {
    // same linear depth as the gbuffer: (viewZ - near) / (far - near)
    float d = clamp((vViewPosition.z - cameraNearFar.x) / (cameraNearFar.y - cameraNearFar.x), 0., 1.);
    gl_FragColor = vec4(itemData, d);
}
`

const OUTLINE_GLSL = /* glsl */`
uniform sampler2D tSuxMask;
uniform vec2 suxMaskSize;
uniform vec3 suxSelColor;
uniform vec3 suxHoverColor;
uniform float suxWidth;
uniform float suxHoverWidth;
uniform float suxFill;
uniform float suxXray;
uniform float suxParts;
uniform float suxDim;
uniform float suxActive;
uniform float suxHasSel;

// true when the masked surface at uv is hidden by another object in the scene
float suxHidden(vec2 uv, float maskDepth) {
    return getDepth(uv) < maskDepth - 0.002 ? 1.0 : 0.0;
}

vec4 suxOutline(in vec4 color) {
    if (suxActive < 0.5) return color;
    vec2 px = 1.0 / suxMaskSize;
    vec4 c = texture2D(tSuxMask, vUv);
    float cSel = floor(c.r + 0.5);
    float cPart = floor(c.g + 0.5);
    float cHov = floor(c.b + 0.5);
    vec3 col = color.rgb;
    float dash = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 3.0), 2.0);

    // dim everything outside the selection
    if (suxDim > 0.0 && suxHasSel > 0.5 && cSel < 0.5) {
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(l) * 0.6 + 0.25, suxDim);
    }

    // fill tint inside the selection (fainter where hidden)
    if (cSel > 0.5 && suxFill > 0.0) {
        float hid = suxHidden(vUv, c.a);
        col = mix(col, suxSelColor, suxFill * (hid > 0.5 ? 0.5 * suxXray : 1.0));
    }

    // search around the pixel for the nearest different id. Rings of 12 taps.
    float maxR = max(suxWidth, suxHoverWidth) + 0.5;
    float dSel = 100.0, dHov = 100.0, dPart = 100.0;
    float hidSel = 0.0, hidHov = 0.0;
    for (int ri = 0; ri < 4; ri++) {
        float r = 0.75 + float(ri) * (maxR - 0.75) / 3.0;
        for (int i = 0; i < 12; i++) {
            float a = (float(i) + 0.5 * float(ri)) * 0.5235988;
            vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 uv = vUv + o * px;
            vec4 s = texture2D(tSuxMask, uv);
            float sSel = floor(s.r + 0.5);
            float sPart = floor(s.g + 0.5);
            float sHov = floor(s.b + 0.5);
            // outer outline of each selected item (one-sided where two items touch)
            if (sSel > 0.5 && sSel != cSel && (cSel < 0.5 || sSel > cSel) && r < dSel) {
                dSel = r;
                hidSel = suxHidden(uv, s.a);
            }
            if (sHov > 0.5 && cHov < 0.5 && r < dHov) {
                dHov = r;
                hidHov = suxHidden(uv, s.a);
            }
            // segmentation lines between parts of the same item
            if (ri == 0 && sSel == cSel && cSel > 0.5 && sPart != cPart && sPart > cPart) dPart = min(dPart, r);
        }
    }

    if (suxParts > 0.0 && dPart < 10.0) {
        float hid = suxHidden(vUv, c.a);
        float a = suxParts * (hid > 0.5 ? 0.5 * suxXray * dash : 1.0);
        col = mix(col, suxSelColor, a);
    }
    if (dHov < 10.0) {
        float a = clamp(suxHoverWidth + 0.5 - dHov, 0.0, 1.0);
        if (hidHov > 0.5) a *= suxXray * dash * 0.8;
        col = mix(col, suxHoverColor, a);
    }
    if (dSel < 10.0) {
        float a = clamp(suxWidth + 0.5 - dSel, 0.0, 1.0);
        if (hidSel > 0.5) a *= suxXray * dash;
        col = mix(col, suxSelColor, a);
    }
    return vec4(col, max(color.a, 0.0));
}
`
