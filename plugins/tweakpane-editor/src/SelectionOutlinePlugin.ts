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
    Material,
    Matrix3,
    Mesh,
    MeshPhysicalMaterial,
    NearestFilter,
    NoBlending,
    Object3D,
    onChange,
    PickingPlugin,
    RenderPass,
    ShaderMaterial,
    Texture,
    ThreeViewer,
    uiColor,
    uiFolderContainer,
    uiSlider,
    uiToggle,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'

/**
 * Selection Outline Plugin
 *
 * Draws the outline of the selected and hovered objects in the render pipeline, as in Figma or Blender.
 *
 * 1. A {@link SelectionMaskPass} renders the meshes of the selected and hovered objects into a half-float mask, with its
 *    own depth buffer: R = selected item, G = part inside that item, B = hovered, A = linear depth.
 * 2. An extension of the screen pass reads the mask after tonemapping and draws an anti-aliased outer outline around
 *    each selected object and the hovered object. Options: thin lines between the parts of an item ({@link parts}),
 *    a dashed outline where the selection is behind other objects ({@link xray}), a fill tint ({@link fill}), and a dim
 *    of all other objects ({@link dimOthers}).
 *
 * The objects come from the {@link PickingPlugin} when {@link followPicking} is on (the default; for the hover, turn on
 * `PickingPlugin.hoverEnabled`), else set {@link selected} and {@link hovered}. A change of the selection or the hover renders one more frame, it does not restart
 * the progressive render. Fat lines (`Line2`, `LineSegments2`) are in the mask with their own width.
 *
 * Requires the {@link GBufferPlugin} (the depth for the x-ray outline). Not saved with the viewer config.
 *
 * @category Plugins
 */
@uiFolderContainer('Selection Outline')
export class SelectionOutlinePlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'SelectionOutlinePlugin'
    dependencies = [GBufferPlugin]
    serializeWithViewer = false

    @onChange(SelectionOutlinePlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = true

    /** Use the selection and the hover of the {@link PickingPlugin} */
    @onChange(SelectionOutlinePlugin.prototype._refreshPicking)
    @uiToggle('Follow picking')
        followPicking = true

    /** Outline the selected objects */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('Selected')
        outlineSelected = true

    /** Outline the hovered objects */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('Hover')
        outlineHover = true

    /** The outline color. Call {@link redraw} after a change in place (`color.set(...)`). */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiColor<SelectionOutlinePlugin>('Color', t => ({onChange: () => t?.redraw()}))
        color = new Color('#0d99ff')

    /** The hover outline color. Call {@link redraw} after a change in place. */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiColor<SelectionOutlinePlugin>('Hover color', t => ({onChange: () => t?.redraw()}))
        hoverColor = new Color('#0d99ff')

    /** Outline width in CSS pixels. The hover outline is 3/4 of it, at least 1 px. */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiSlider('Width', [0.5, 6], 0.5)
        width = 2

    /** Thin lines between the parts of a selected object (see {@link partsOf}) */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('Parts')
        parts = true

    /** A dashed outline where the selection is behind other objects */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('X-ray')
        xray = true

    /** A light tint of the color inside the selection */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('Fill')
        fill = false

    /** Dim all the objects that are not selected */
    @onChange(SelectionOutlinePlugin.prototype.redraw)
    @uiToggle('Dim others')
        dimOthers = false

    /**
     * The parts of a selected object, for the lines between parts. Default: the children, below any chain of groups
     * with one child (the objects that a click inside the selection selects next).
     */
    partsOf: (object: IObject3D) => Object3D[] = (object) => {
        let o: Object3D = object
        while (o.children.length === 1) o = o.children[0]
        return o.children
    }

    readonly extraUniforms = {
        tSelectionMask: {value: null as Texture | null},
        selMaskSize: {value: new Vector2(1, 1)},
        selColor: {value: new Color()},
        selHoverColor: {value: new Color()},
        selWidth: {value: 2},
        selHoverWidth: {value: 1.5},
        selFill: {value: 0},
        selXray: {value: 1},
        selParts: {value: 0},
        selDim: {value: 0},
        selActive: {value: 0},
        selHasSel: {value: 0},
    }

    /** After tonemapping and the other extensions, so the colors are exact */
    priority = -110

    protected _shaderPatch = 'diffuseColor = selectionOutline(diffuseColor);'

    parsFragmentSnippet = () => this.isDisabled() ? '' : OUTLINE_GLSL

    private _selected: IObject3D[] = []
    private _hovered: IObject3D[] = []
    private _pass?: SelectionMaskPass
    private _target?: WebGLRenderTarget
    private _picking?: PickingPlugin

    /** The selected objects. Set it when {@link followPicking} is off. */
    get selected(): IObject3D[] {
        return this._selected
    }
    set selected(objects: IObject3D[]) {
        if (sameObjects(objects, this._selected)) return
        this._selected = [...objects]
        this.redraw()
    }

    /** The hovered objects. Set it when {@link followPicking} is off. */
    get hovered(): IObject3D[] {
        return this._hovered
    }
    set hovered(objects: IObject3D[]) {
        if (sameObjects(objects, this._hovered)) return
        this._hovered = [...objects]
        this.redraw()
    }

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
                ...maskAlphaUniforms(),
            },
            vertexShader: MASK_VERT,
            fragmentShader: MASK_FRAG,
            side: DoubleSide,
        }))
        this._pass.getItems = () => this.maskItems()
        viewer.renderManager.registerPass(this._pass)
        viewer.addEventListener('preRender', this._preRender)
        this._refreshPicking()
    }

    onRemove(viewer: ThreeViewer) {
        this._setPicking(undefined)
        viewer.removeEventListener('preRender', this._preRender)
        if (this._pass) {
            viewer.renderManager.unregisterPass(this._pass)
            this._pass.dispose()
        }
        if (this._target) viewer.renderManager.disposeTarget(this._target)
        this._pass = undefined
        this._target = undefined
        super.onRemove(viewer)
    }

    /**
     * The meshes in the mask and their data: x = selected item (1-based, 0 = not selected), y = part inside the item
     * (1-based, 0 = none), z = 1 when hovered.
     */
    maskItems(): Map<Object3D, Vector3> {
        const items = new Map<Object3D, Vector3>()
        if (!this._isActive()) return items
        const sel = this.outlineSelected ? this._selected : []
        sel.forEach((o, i) => {
            const parts = this.partsOf(o)
            o.traverseVisible(m => {
                if (!isMaskMesh(m)) return
                let p: Object3D | null = m
                while (p && p !== o && !parts.includes(p)) p = p.parent
                const part = p && p !== o ? parts.indexOf(p) + 1 : 0
                items.set(m, new Vector3(i + 1, part, 0))
            })
        })
        const hovers = this.outlineHover ? this._hovered : []
        for (const h of hovers) {
            if (this.outlineSelected && this._selected.includes(h)) continue
            h.traverseVisible(m => {
                if (!isMaskMesh(m)) return
                const v = items.get(m)
                if (v) v.z = 1
                else items.set(m, new Vector3(0, 0, 1))
            })
        }
        return items
    }

    private _isActive() {
        return !this.isDisabled() && (this.outlineSelected || this.outlineHover)
    }

    /**
     * Renders one more frame, without a restart of the progressive render: the outline is drawn over the final image.
     * The plugin calls it when the selection, the hover or a setting changes.
     */
    redraw() {
        this._viewer?.renderManager.setDirty()
    }

    private _refreshPicking() {
        this._setPicking(this.followPicking ? this._viewer?.getPlugin(PickingPlugin) : undefined)
    }

    private _setPicking(picking: PickingPlugin | undefined) {
        if (picking === this._picking) return
        this._picking?.removeEventListener('selectedObjectChanged', this._onPickingSelection)
        this._picking?.removeEventListener('hoverObjectChanged', this._onPickingHover)
        this._picking = picking
        picking?.addEventListener('selectedObjectChanged', this._onPickingSelection)
        picking?.addEventListener('hoverObjectChanged', this._onPickingHover)
        this._onPickingSelection()
        this._onPickingHover({object: null})
    }

    private _onPickingSelection = () => {
        if (!this._picking) return
        this.selected = this._picking.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
    }

    private _onPickingHover = (e: {object: IObject3D | null}) => {
        if (!this._picking) return
        this.hovered = e.object ? [e.object] : []
    }

    private _preRender = () => {
        if (!this._target || !this._viewer) return
        const u = this.extraUniforms
        const hasSel = this.outlineSelected && this._selected.length > 0
        const active = this._isActive() && (hasSel || this.outlineHover && this._hovered.length > 0)
        if (this._pass) this._pass.enabled = active
        u.selActive.value = active ? 1 : 0
        u.selHasSel.value = hasSel ? 1 : 0
        u.tSelectionMask.value = this._target.texture
        u.selMaskSize.value.set(this._target.width, this._target.height)
        u.selColor.value.copy(this.color)
        u.selHoverColor.value.copy(this.hoverColor)
        const scale = this._viewer.renderManager.renderScale
        u.selWidth.value = this.width * scale
        u.selHoverWidth.value = Math.max(1, this.width * 0.75) * scale
        u.selFill.value = this.fill ? 0.12 : 0
        u.selXray.value = this.xray ? 1 : 0
        u.selParts.value = this.parts ? 0.6 : 0
        u.selDim.value = this.dimOthers ? 0.55 : 0
        this._viewer.renderManager.screenPass.material.uniformsNeedUpdate = true
    }
}

/**
 * Renders the meshes of {@link SelectionOutlinePlugin} into its mask target, with their item data and linear depth.
 * The meshes are drawn on {@link SelectionMaskPass.Layer} during the pass.
 */
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
    /** The camera layer that the pass renders */
    static Layer = 7

    constructor(public target: () => WebGLRenderTarget | undefined, material: ShaderMaterial) {
        super(undefined, undefined, material, new Color(0, 0, 0), 1)
        material.onBeforeRender = (_r, _s, _c, _g, object) => {
            const d = this._items.get(object)
            if (d) material.uniforms.itemData.value.copy(d)
            setMaskAlpha(material, (object as Mesh).material)
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
            // fat lines are instanced quads that only a line shader turns into lines: give them a line-shaped mask material
            const lines: Object3D[] = []
            for (const o of this._items.keys()) {
                const line = o as any
                const lm = line.isLine2 || line.isLineSegments2 ? line.currentMaterial ?? line.material : null
                if (!lm?.isLineMaterial) continue
                line.forcedOverrideMaterial = this._lineMask(lm)
                lines.push(o)
            }
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
            for (const o of lines) delete (o as any).forcedOverrideMaterial
            this.camera.layers.mask = mask
        }
        renderer.setRenderTarget(t, face, mip)
    }

    private _lineMasks = new WeakMap<Material, ShaderMaterial>()

    /** The line material's own vertex shader (thick quads) with the mask output; shares its uniforms (width, resolution) */
    private _lineMask(lm: ShaderMaterial) {
        let m = this._lineMasks.get(lm)
        if (!m) {
            m = new ShaderMaterial({
                uniforms: {...lm.uniforms, itemData: {value: new Vector3()}, cameraNearFar: {value: new Vector2(0.1, 1000)}},
                defines: {...lm.defines},
                vertexShader: lm.vertexShader,
                fragmentShader: LINE_MASK_FRAG,
                blending: NoBlending,
            })
            m.allowOverride = false
            const mask = m
            m.onBeforeRender = (_r, _s, camera, _g, object) => {
                const d = this._items.get(object)
                if (d) mask.uniforms.itemData.value.copy(d)
                const cam = camera as any
                mask.uniforms.cameraNearFar.value.set(cam.near, cam.far)
                mask.uniformsNeedUpdate = true
            }
            this._lineMasks.set(lm, m)
        }
        return m
    }

    dispose() {
        this.scene = undefined
        this.camera = undefined
        this._items.clear()
        this.overrideMaterial.dispose()
        super.dispose?.()
    }
}

/** Uniforms for the alpha of the object's own material, so a mesh that is cut by its texture is cut in the mask too */
function maskAlphaUniforms() {
    return {
        maskOpacity: {value: 1},
        maskAlphaTex: {value: null as Texture | null},
        maskAlphaChannel: {value: -1},
        maskAlphaUvTransform: {value: new Matrix3()},
        maskAlphaCut: {value: 0.5},
    }
}

/**
 * The alpha of a material as in its own render: `opacity` when transparent, the alpha of `map` (transparent or alpha
 * test) or the green channel of `alphaMap`, cut at `alphaTest` (or 0.5)
 */
function setMaskAlpha(mask: ShaderMaterial, material: Material | Material[] | undefined) {
    const m = (Array.isArray(material) ? undefined : material) as MeshPhysicalMaterial | undefined
    const u = mask.uniforms
    const cut = m?.alphaTest || 0
    const useAlpha = !!m && (m.transparent || cut > 0)
    const tex = !useAlpha ? null : m.alphaMap ?? m.map ?? null
    u.maskOpacity.value = useAlpha && m.transparent ? m.opacity : 1
    u.maskAlphaTex.value = tex
    u.maskAlphaChannel.value = !tex ? -1 : tex === m?.alphaMap ? 1 : 3
    if (tex) {
        if (tex.matrixAutoUpdate) tex.updateMatrix()
        u.maskAlphaUvTransform.value.copy(tex.matrix)
    }
    u.maskAlphaCut.value = cut > 0 ? cut : 0.5
}

/** A mesh with a geometry: the objects that the mask pass draws */
function isMaskMesh(o: Object3D) {
    return !!(o as IObject3D).geometry && !!(o as any).isMesh
}

/** The same objects in the same order */
function sameObjects(a: IObject3D[], b: IObject3D[]) {
    return a.length === b.length && a.every((o, i) => o === b[i])
}

const MASK_VERT = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vViewPosition;
varying vec2 vMaskUv;
void main() {
    vMaskUv = uv;
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
uniform float maskOpacity;
uniform sampler2D maskAlphaTex;
uniform float maskAlphaChannel;
uniform mat3 maskAlphaUvTransform;
uniform float maskAlphaCut;
varying vec3 vViewPosition;
varying vec2 vMaskUv;
void main() {
    // the alpha of the object's own material: a mesh cut by its texture is cut here too
    float alpha = maskOpacity;
    if (maskAlphaChannel > 0.) {
        vec4 t = texture2D(maskAlphaTex, (maskAlphaUvTransform * vec3(vMaskUv, 1.)).xy);
        alpha *= maskAlphaChannel > 2. ? t.a : t.g;
    }
    if (alpha < maskAlphaCut) discard;
    // same linear depth as the gbuffer: (viewZ - near) / (far - near)
    float d = clamp((vViewPosition.z - cameraNearFar.x) / (cameraNearFar.y - cameraNearFar.x), 0., 1.);
    gl_FragColor = vec4(itemData, d);
}
`

const LINE_MASK_FRAG = /* glsl */`
#include <packing>
uniform vec2 cameraNearFar;
uniform vec3 itemData;
void main() {
    // the line shader has no view position varying: the depth comes from the fragment depth (perspective camera)
    float viewZ = -perspectiveDepthToViewZ(gl_FragCoord.z, cameraNearFar.x, cameraNearFar.y);
    float d = clamp((viewZ - cameraNearFar.x) / (cameraNearFar.y - cameraNearFar.x), 0., 1.);
    gl_FragColor = vec4(itemData, d);
}
`

const OUTLINE_GLSL = /* glsl */`
uniform sampler2D tSelectionMask;
uniform vec2 selMaskSize;
uniform vec3 selColor;
uniform vec3 selHoverColor;
uniform float selWidth;
uniform float selHoverWidth;
uniform float selFill;
uniform float selXray;
uniform float selParts;
uniform float selDim;
uniform float selActive;
uniform float selHasSel;

// true when the masked surface at uv is hidden by another object in the scene
float selHidden(vec2 uv, float maskDepth) {
    return getDepth(uv) < maskDepth - 0.002 ? 1.0 : 0.0;
}

vec4 selectionOutline(in vec4 color) {
    if (selActive < 0.5) return color;
    vec2 px = 1.0 / selMaskSize;
    vec4 c = texture2D(tSelectionMask, vUv);
    float cSel = floor(c.r + 0.5);
    float cPart = floor(c.g + 0.5);
    float cHov = floor(c.b + 0.5);
    vec3 col = color.rgb;
    float dash = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 3.0), 2.0);

    // dim everything outside the selection
    if (selDim > 0.0 && selHasSel > 0.5 && cSel < 0.5) {
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(l) * 0.6 + 0.25, selDim);
    }

    // fill tint inside the selection (fainter where hidden)
    if (cSel > 0.5 && selFill > 0.0) {
        float hid = selHidden(vUv, c.a);
        col = mix(col, selColor, selFill * (hid > 0.5 ? 0.5 * selXray : 1.0));
    }

    // search around the pixel for the nearest different id. Rings of 12 taps.
    float maxR = max(selWidth, selHoverWidth) + 0.5;
    float dSel = 100.0, dHov = 100.0, dPart = 100.0;
    float hidSel = 0.0, hidHov = 0.0;
    for (int ri = 0; ri < 4; ri++) {
        float r = 0.75 + float(ri) * (maxR - 0.75) / 3.0;
        for (int i = 0; i < 12; i++) {
            float a = (float(i) + 0.5 * float(ri)) * 0.5235988;
            vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 uv = vUv + o * px;
            vec4 s = texture2D(tSelectionMask, uv);
            float sSel = floor(s.r + 0.5);
            float sPart = floor(s.g + 0.5);
            float sHov = floor(s.b + 0.5);
            // outer outline of each selected item (one-sided where two items touch)
            if (sSel > 0.5 && sSel != cSel && (cSel < 0.5 || sSel > cSel) && r < dSel) {
                dSel = r;
                hidSel = selHidden(uv, s.a);
            }
            if (sHov > 0.5 && cHov < 0.5 && r < dHov) {
                dHov = r;
                hidHov = selHidden(uv, s.a);
            }
            // segmentation lines between parts of the same item
            if (ri == 0 && sSel == cSel && cSel > 0.5 && sPart != cPart && sPart > cPart) dPart = min(dPart, r);
        }
    }

    if (selParts > 0.0 && dPart < 10.0) {
        float hid = selHidden(vUv, c.a);
        float a = selParts * (hid > 0.5 ? 0.5 * selXray * dash : 1.0);
        col = mix(col, selColor, a);
    }
    if (dHov < 10.0) {
        float a = clamp(selHoverWidth + 0.5 - dHov, 0.0, 1.0);
        if (hidHov > 0.5) a *= selXray * dash * 0.8;
        col = mix(col, selHoverColor, a);
    }
    if (dSel < 10.0) {
        float a = clamp(selWidth + 0.5 - dSel, 0.0, 1.0);
        if (hidSel > 0.5) a *= selXray * dash;
        col = mix(col, selColor, a);
    }
    return vec4(col, max(color.a, 0.0));
}
`
