import {
    BackSide,
    BasicShadowMap,
    BufferGeometry,
    DoubleSide,
    FrontSide,
    glsl,
    IDisposable,
    IObject3D,
    IRenderTarget,
    Material,
    MaterialExtension,
    Matrix3,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshDepthMaterial,
    NoBlending,
    NoColorSpace,
    objectHasOwn,
    Object3D,
    onChange,
    OrthographicCamera,
    PhysicalMaterial,
    RedFormat,
    RenderManager,
    RGBAFormat,
    Scene,
    serialize,
    ShaderMaterial,
    ShaderMaterial2,
    shaderReplaceString,
    shaderUtils,
    ShadowMapType,
    SimpleEventDispatcher,
    Texture,
    ThreeSerialization,
    ThreeViewer,
    UnsignedByteType,
    UnsignedIntType,
    Vector2,
    Vector3,
    Vector4,
    WebGLRenderTarget,
} from 'threepipe'
import {RandomizedDirectionalLight} from './RandomizedDirectionalLight'
import seperableShadowBlur from './shaders/seperableShadowBlur.glsl'

const ShaderChunk = RenderManager.ShaderChunk

/**
 * The material three.js draws a shadow caster with in its shadow pass: the side opposite to the side of the material
 * (WebGLShadowMap, shadowSide), unless the material has its own shadowSide.
 */
const shadowSide = {[FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide}

/**
 * Bias matrix from clip space to the [0, 1] shadow map space, as in LightShadow.updateMatrices of three.js
 */
const shadowBiasMatrix = new Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0,
)
const shadowBiasMatrixReversed = new Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
)

/**
 * Bakes the soft shadow of the scene on a ground mesh: on each frame it renders the depth of the shadow casters from a few
 * randomized directional light positions, tests the ground against them, and adds the result to a running average in
 * {@link target} (RGBA8, the lit fraction packed with packDepthToRGBA, in the uv space of the ground mesh).
 *
 * It renders its own light space depth into its own render target ({@link depthTarget}), and does not use the shadow
 * maps of three.js, or change any shadow setting of the renderer.
 */
export class ShadowMapBaker extends SimpleEventDispatcher<'shadowBaking'|'shadowBaked'> implements IDisposable {
    enabled = true // do not serialize // this is to disable baking for a while, toggling this does not reset the baked shadow map

    get attachedMesh(): Mesh<BufferGeometry, PhysicalMaterial> | undefined {
        return this._attachedMesh
    }

    set attachedMesh(value: Mesh<BufferGeometry, PhysicalMaterial> | undefined) {
        if (this._attachedMesh !== value) {
            this._attachedMesh && this.cleanupMaterial()
            this._attachedMesh = value
            this._attachedMesh && this._updateMaterial()
        }
    }
    private _shadowBlurMat: ShaderMaterial2

    /**
     * The baked shadow: RGBA8, 1024x1024, the lit fraction (1 lit, 0 in shadow) packed with packDepthToRGBA, in the uv
     * space of the attached mesh. Created on the first bake frame.
     */
    get target(): WebGLRenderTarget | undefined {
        return this._target
    }

    private _target?: WebGLRenderTarget

    /**
     * The light space depth of the last bake frame, in its `depthTexture`: one tile of `light.shadow.mapSize` for each of
     * the {@link lightsPerFrame} light positions (as many as fit in the largest texture size of the device). Created on
     * the first bake frame.
     */
    get depthTarget(): WebGLRenderTarget | undefined {
        return this._depthTarget
    }

    private _depthTileColumns = 1
    private _depthTileCount = 1
    private readonly _depthTileSize = new Vector2(1024, 1024)
    private _depthTarget?: WebGLRenderTarget

    get light(): RandomizedDirectionalLight {
        return this._light
    }

    @serialize('randomizedLight') private readonly _light: RandomizedDirectionalLight
    private readonly _lightLayer = 5 // todo: get free one from the viewer.
    private _viewer: ThreeViewer

    constructor(viewer: ThreeViewer) {
        super()
        this._viewer = viewer
        const light = new RandomizedDirectionalLight(0xffffff, 10, {
            near: 1.5,
            far: 20,
            bias: 0.0,
            frustumSize: 4,
            width: 1024,
            height: 1024,
            enabled: true,
            radius: 10,
            normalBias: 0,
        }, {
            direction: new Vector3(0.2, 1, 0.2).normalize(),
            spread: 0.9,
            focus: 1.0,
            distanceScale: 20,
            minDistanceScale: new Vector3(10, 10, 10),
            normalDirection: new Vector3(0, 1, 0),
        })
        light.shadow.camera.updateProjectionMatrix()
        // the light only holds the parameters of the bake, it must not light the scene
        light.layers.disableAll()
        light.layers.set(this._lightLayer)

        this._light = light
        viewer.scene.addObject(this._light, {addToRoot: true})

        this._bakeMat = new ShaderMaterial({
            defines: {
                SHADOW_VIEWS: 1,
            },
            uniforms: {
                tLastThis: {value: null},
                bakeWeight: {value: 1},
                shadowDepth: {value: null},
                shadowMatrices: {value: [new Matrix4()]},
                shadowTiles: {value: [new Vector4(0, 0, 1, 1)]},
                shadowCount: {value: 1},
                shadowTexelSize: {value: new Vector2(1 / 1024, 1 / 1024)},
                shadowBias: {value: 0},
                shadowNormalBias: {value: 0},
                shadowIntensity: {value: 1},
                worldNormalMatrix: {value: new Matrix3()},
            },
            vertexShader: bakeVertexShader,
            fragmentShader: bakeFragmentShader,
            toneMapped: false,
            depthWrite: false,
            depthTest: false,
            transparent: false,
            blending: NoBlending,
        })
        this._bakeMesh.material = this._bakeMat
        this._bakeMesh.matrixAutoUpdate = false
        this._bakeMesh.matrixWorldAutoUpdate = false
        this._bakeMesh.frustumCulled = false
        this._bakeScene.matrixWorldAutoUpdate = false
        this._bakeScene.add(this._bakeMesh)

        this._shadowBlurMat = new ShaderMaterial2({
            uniforms: {
                'colorTexture': {value: null},
                'step': {value: 0.1},
                'size': {value: new Vector2(0.5, 0.5)},
                'direction': {value: new Vector2(0.5, 0.5)},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: seperableShadowBlur,
        })
    }

    dispose() {
        this._bakeMat.dispose()
        this._shadowBlurMat.dispose()
        this._hiddenMaterial.dispose()
        this._depthMaterials.forEach((m, source) => {
            source.removeEventListener('dispose', this._onSourceMaterialDispose)
            m.dispose()
        })
        this._depthMaterials.clear()
        this._depthMaterialKeys = new WeakMap()
        if (this._attachedMesh) this.cleanupMaterial()
        if (this._target) this._viewer.renderManager.disposeTarget(this._target as IRenderTarget)
        this._target = undefined
        if (this._depthTarget) this._viewer.renderManager.disposeTarget(this._depthTarget as IRenderTarget)
        this._depthTarget = undefined
        this._bakeMesh.geometry = this._emptyGeometry // the geometry of the attached mesh is not ours to dispose
        this._emptyGeometry.dispose()
        this._light.dispose() // removes the light from the scene
        this.reset()
    }

    public cleanupMaterial() {
        this._updateMaterial(true)
    }

    private _frameNumber = 0
    private _bakeFrame = 0

    /**
     * The number of randomized light positions that make the baked shadow. The bake ends when it has as many.
     */
    @onChange(ShadowMapBaker.prototype.reset)
    @serialize() maxFrameNumber = 400

    /**
     * The number of light positions rendered and added to the baked shadow on each frame. The baked shadow at the end
     * is the same for any value, as it is made of the same {@link maxFrameNumber} light positions: a larger value gets
     * there in fewer frames, for a longer time spent on each frame. A frame renders fewer when the depth target of that
     * many would be larger than the largest texture size of the device.
     */
    @onChange(ShadowMapBaker.prototype._lightsPerFrameChanged)
    @serialize() lightsPerFrame = 4

    @onChange(ShadowMapBaker.prototype.reset)
    @serialize() smoothShadow = false

    /**
     * @deprecated It has no effect: the baker compares against its own depth, as BasicShadowMap did, and does not
     * change the shadow map type of the renderer. Not saved; a saved value is ignored.
     */
    shadowMapType: ShadowMapType = BasicShadowMap

    private _lightsPerFrameChanged() {
        const n = Math.max(1, Math.min(16, Math.floor(this.lightsPerFrame) || 1))
        if (n !== this.lightsPerFrame) {
            this.lightsPerFrame = n // calls this again
            return
        }
        this.reset()
    }

    private _attachedMesh: Mesh<BufferGeometry, PhysicalMaterial> | undefined

    @onChange(ShadowMapBaker.prototype._groundMapModeChanged)
    @serialize() groundMapMode: 'aoMap' | 'map' | 'alphaMap' = 'aoMap'

    @serialize()
    @onChange(ShadowMapBaker.prototype._alphaVignetteChanged)
    alphaVignette = true // only works for transparent and transmissive materials.

    @serialize()
    @onChange(ShadowMapBaker.prototype._alphaVignetteChanged)
    alphaVignetteAxis = 'xy' // x or y or xy.

    private _groundMapModeChanged() {
        if (this._attachedMesh) {
            this.cleanupMaterial()
            this._updateMaterial()
            if (this.groundMapMode === 'alphaMap') this._attachedMesh.material.transparent = true
            else this._attachedMesh.material.transparent = false
        }
        this.reset()
    }
    private _alphaVignetteChanged() {
        this.materialExtension?.setDirty?.()
        this._viewer?.setDirty()
    }

    fromJSON(data: any, meta?: any, _internal: boolean = false): this {
        if (!_internal) {
            return ThreeSerialization.Deserialize(data, this, meta, false)
        } else {
            // shadowMapType of files saved before it was deprecated is not read: it is not serialized
            ThreeSerialization.Deserialize(data, this, meta, true)
            this.reset()
        }
        return this
    }

    reset(): void {
        this._frameNumber = 0
        this._bakeFrame = 0
    }

    /**
     * The number of light positions in the baked shadow so far, up to {@link maxFrameNumber}.
     */
    get frameNumber() {
        return this._frameNumber
    }

    shadowAutoUpdate = true

    private _bakeCounter = 0

    @serialize() maxBakeCount = Infinity

    autoUpdateShadow(): boolean {
        if (this.shadowAutoUpdate) {
            if (this._bakeCounter >= this.maxBakeCount) return false
            if (!this.updateShadow()) return false
            if (this._frameNumber === this.maxFrameNumber) {
                this.dispatchEvent({type: 'shadowBaked', bakeCount: ++this._bakeCounter})
            } else if (this._frameNumber > 0 && this._frameNumber < this.maxFrameNumber) {
                this.dispatchEvent({type: 'shadowBaking', progress: this._frameNumber / this.maxFrameNumber, bakeCount: this._bakeCounter})
            }
            return true
        }
        return false
    }

    private readonly _bakeMat: ShaderMaterial
    private readonly _bakeScene = new Scene()
    private readonly _emptyGeometry = new BufferGeometry()
    private readonly _bakeMesh = new Mesh(this._emptyGeometry)
    private readonly _depthCamera = new OrthographicCamera()

    updateShadow(): boolean {
        if (!this.enabled) return false
        const mesh = this._attachedMesh
        if (!mesh) return false
        if (this._frameNumber >= this.maxFrameNumber) return false

        const customSize = 1024
        const renderManager = this._viewer.renderManager
        if (!this._target) {
            this._target = renderManager.createTarget({
                type: UnsignedByteType,
                depthBuffer: false,
                size: customSize ? new Vector2(customSize, customSize) : undefined,
                sizeMultiplier: customSize ? undefined : 1,
                colorSpace: NoColorSpace,
                format: RGBAFormat,
            }) as WebGLRenderTarget
            // this._target.texture.userData.serializableRenderTarget = true // not working properly and exported image size is high, see BaseRenderer
        }
        const depthTarget = this._getDepthTarget()
        const count = Math.min(this._depthTileCount, this.maxFrameNumber - this._frameNumber)

        const renderer = renderManager.renderer
        const currentRt = renderer.getRenderTarget()
        const activeCubeFace = renderer.getActiveCubeFace()
        const activeMipLevel = renderer.getActiveMipmapLevel()
        const uniforms = this._bakeMat.uniforms

        // light space depth of each light position, in its tile
        const restoreCasters = this._light.castShadow ? this._prepareCasters() : undefined
        try {
            renderer.setRenderTarget(depthTarget)
            renderer.state.buffers.depth.setMask(true)
            renderer.clear(false, true, false) // the whole target: its scissorTest is false here
            for (let i = 0; i < count; i++) {
                const sample = this._frameNumber + i + 1
                if (sample < 3)
                    this._light.randomizePosition(0, 1, 0)
                else
                    this._light.randomizePosition(sample)
                this._updateDepthCamera()
                if (restoreCasters) {
                    // the tile of the shadowTiles uniform, in pixels
                    const {x: w, y: h} = this._depthTileSize
                    depthTarget.viewport.set(i % this._depthTileColumns * w, Math.floor(i / this._depthTileColumns) * h, w, h)
                    depthTarget.scissor.copy(depthTarget.viewport)
                    depthTarget.scissorTest = true
                    renderer.setRenderTarget(depthTarget)
                    renderer.renderWithModes({
                        shadowMapRender: false,
                        backgroundRender: false,
                        opaqueRender: true,
                        transparentRender: false,
                        transmissionRender: false,
                        mainRenderPass: false,
                    }, () => renderer.render(this._viewer.scene, this._depthCamera))
                }
                // after the render: it sets reversedDepth of the camera (and its projection) for a reversed depth buffer
                const cam = this._depthCamera
                const matrix = uniforms.shadowMatrices.value[i] as Matrix4
                matrix.multiplyMatrices(cam.reversedDepth ? shadowBiasMatrixReversed : shadowBiasMatrix, cam.projectionMatrix)
                    .multiply(cam.matrixWorldInverse)
            }
        } finally {
            restoreCasters?.()
            depthTarget.viewport.set(0, 0, depthTarget.width, depthTarget.height)
            depthTarget.scissor.set(0, 0, depthTarget.width, depthTarget.height)
            depthTarget.scissorTest = false
        }

        // the ground, in its uv space: the average of the shadow tests against the depth of each light position, added to the running average
        const lastThisTarget = (customSize ? renderManager.getTempTarget({
            type: UnsignedByteType,
            depthBuffer: false,
            size: new Vector2(customSize, customSize),
            colorSpace: NoColorSpace,
            format: RGBAFormat,
        }) : renderManager.composerTarget) as WebGLRenderTarget

        const texture = lastThisTarget.texture as Texture
        const lastThisTargetColorSpace = texture.colorSpace
        texture.colorSpace = NoColorSpace

        renderManager.blit(lastThisTarget as IRenderTarget, {clear: true, source: this._target.texture})

        const shadow = this._light.shadow
        uniforms.tLastThis.value = lastThisTarget.texture
        uniforms.bakeWeight.value = count / (this._frameNumber + count) // a running average of all the light positions
        uniforms.shadowDepth.value = depthTarget.depthTexture
        uniforms.shadowCount.value = count
        uniforms.shadowTexelSize.value.set(1 / this._depthTileSize.x, 1 / this._depthTileSize.y)
        uniforms.shadowBias.value = shadow.bias
        uniforms.shadowNormalBias.value = shadow.normalBias
        uniforms.shadowIntensity.value = shadow.intensity
        mesh.updateWorldMatrix(true, false)
        this._bakeMesh.geometry = mesh.geometry
        this._bakeMesh.matrixWorld.copy(mesh.matrixWorld)
        uniforms.worldNormalMatrix.value.getNormalMatrix(mesh.matrixWorld)

        renderer.setRenderTarget(this._target)
        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: false,
            transmissionRender: false,
            mainRenderPass: false,
        }, () => renderer.render(this._bakeScene, this._depthCamera))
        this._bakeMesh.geometry = this._emptyGeometry
        uniforms.tLastThis.value = null
        renderer.setRenderTarget(currentRt, activeCubeFace, activeMipLevel)

        if (this.smoothShadow)
            this._applySmoothFilter(this._target, lastThisTarget as WebGLRenderTarget)

        lastThisTarget.texture.colorSpace = lastThisTargetColorSpace
        if (customSize) {
            renderManager.releaseTempTarget(lastThisTarget as IRenderTarget)
        }

        this._frameNumber += count
        this._bakeFrame++

        // the ground shows the new baked shadow in the next render: on the first frames, then on every 4th frame
        // (each render starts the progressive frames of the viewer again), and at the end
        const material = mesh.material
        if (this._target.texture !== material[this.groundMapMode]) this._updateMaterial()
        if (this._bakeFrame < 3 || this._frameNumber === this.maxFrameNumber ||
            this._frameNumber > Math.min(100, this.maxFrameNumber) && this._bakeFrame % 4 === 0) {
            material.setDirty({needsUpdate: false})
        }

        return true
    }

    /**
     * The depth target: a tile of `light.shadow.mapSize` for each light position of a frame, in a grid, with as many
     * tiles as fit in the largest texture size of the device (and tiles no larger than it, as three.js limits the size of
     * a shadow map).
     */
    private _getDepthTarget(): WebGLRenderTarget {
        const maxSize = this._viewer.renderManager.renderer.capabilities.maxTextureSize
        const w = Math.min(this._light.shadow.mapSize.x, maxSize)
        const h = Math.min(this._light.shadow.mapSize.y, maxSize)
        const maxCols = Math.floor(maxSize / w)
        const maxRows = Math.floor(maxSize / h)
        const n = Math.min(this.lightsPerFrame, maxCols * maxRows)
        const cols = Math.min(maxCols, Math.max(Math.ceil(Math.sqrt(n)), Math.ceil(n / maxRows)))
        const rows = Math.ceil(n / cols)
        this._depthTileCount = n
        this._depthTileColumns = cols
        this._depthTileSize.set(w, h)
        const width = w * cols
        const height = h * rows
        if (!this._depthTarget) {
            this._depthTarget = this._viewer.renderManager.createTarget({
                // only the depth is used, the color is not written (colorWrite false in the depth materials)
                type: UnsignedByteType,
                format: RedFormat,
                colorSpace: NoColorSpace,
                depthBuffer: true,
                depthTexture: true,
                depthTextureType: UnsignedIntType,
                size: new Vector2(width, height),
            }) as WebGLRenderTarget
            this._depthTarget.texture.name = 'ShadowMapBaker.depthColor'
            this._depthTarget.depthTexture!.name = 'ShadowMapBaker.depth'
        } else if (this._depthTarget.width !== width || this._depthTarget.height !== height) {
            this._depthTarget.setSize(width, height)
        }
        const uniforms = this._bakeMat.uniforms
        if (this._bakeMat.defines.SHADOW_VIEWS !== n) {
            this._bakeMat.defines.SHADOW_VIEWS = n
            uniforms.shadowMatrices.value = Array.from({length: n}, () => new Matrix4())
            uniforms.shadowTiles.value = Array.from({length: n}, () => new Vector4())
            this._bakeMat.needsUpdate = true
        }
        for (let i = 0; i < n; i++) {
            const tile = uniforms.shadowTiles.value[i] as Vector4
            tile.set((i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows)
        }
        return this._depthTarget
    }

    /**
     * The camera of the light at its current position, as three.js sets the shadow camera of a directional light
     * (LightShadow.updateMatrices), with the frustum and view offset of `light.shadow.camera`, and the layers of the main
     * camera.
     */
    private _updateDepthCamera() {
        const light = this._light
        const shadowCamera = light.shadow.camera
        const cam = this._depthCamera
        cam.left = shadowCamera.left
        cam.right = shadowCamera.right
        cam.top = shadowCamera.top
        cam.bottom = shadowCamera.bottom
        cam.near = shadowCamera.near
        cam.far = shadowCamera.far
        cam.zoom = shadowCamera.zoom
        // and its view offset, a part of the projection of the shadow camera of three.js (webgi's ProgressivePlugin
        // jitters the shadow camera of each light by a part of a texel on each frame)
        const view = shadowCamera.view
        cam.view = view?.enabled ? Object.assign(cam.view ?? {}, view) : null
        cam.updateProjectionMatrix()
        cam.position.setFromMatrixPosition(light.matrixWorld)
        cam.lookAt(_lookTarget.setFromMatrixPosition(light.target.matrixWorld))
        cam.updateMatrixWorld()
        cam.layers.mask = this._viewer.scene.mainCamera.layers.mask & ~(1 << this._lightLayer)
    }

    private readonly _hiddenMaterial = new MeshBasicMaterial({visible: false})
    private _depthMaterials = new Map<Material, MeshDepthMaterial>()
    private _depthMaterialKeys = new WeakMap<Material, string>()

    /**
     * Sets the depth material on each shadow caster of the scene, and a hidden one on the other objects, for the depth
     * renders of this frame, as three.js renders a shadow map: meshes, lines and points with castShadow (not the
     * attached mesh), with their customDepthMaterial or a depth material made like the one of three.js (getDepthMaterial
     * of WebGLShadowMap). It uses `forcedOverrideMaterial` of threepipe objects, and the material of other objects.
     * @returns a function that puts the materials back
     */
    private _prepareCasters(): () => void {
        const forced: [IObject3D, IObject3D['forcedOverrideMaterial']][] = []
        const swapped: [Mesh, Material | Material[]][] = []
        this._viewer.scene.traverseVisible((o: Object3D) => {
            const object = o as IObject3D
            if (!object.isMesh && !(object as any).isLine && !(object as any).isPoints && !(object as any).isSprite) return
            const material = object.material as Material | Material[] | undefined
            if (!material) return
            let depthMaterial: Material | Material[]
            if (object.castShadow && !(object as any).isSprite && object !== this._attachedMesh as any) {
                depthMaterial = Array.isArray(material) ?
                    material.map(m => this._getDepthMaterial(object, m)) :
                    this._getDepthMaterial(object, material)
            } else {
                depthMaterial = this._hiddenMaterial
            }
            if (objectHasOwn(object, '_currentMaterial')) {
                forced.push([object, object.forcedOverrideMaterial])
                object.forcedOverrideMaterial = depthMaterial
            } else {
                swapped.push([o as Mesh, material])
                ;(o as Mesh).material = depthMaterial
            }
        })
        return () => {
            for (const [object, m] of forced) {
                if (m === undefined) delete object.forcedOverrideMaterial
                else object.forcedOverrideMaterial = m
            }
            for (const [object, m] of swapped) object.material = m
        }
    }

    /**
     * The depth material for a caster, as in getDepthMaterial of WebGLShadowMap (three.js r182): customDepthMaterial of
     * the object, or a depth material for the material, with its side for shadows, alpha test, maps, displacement and
     * clipping. Skinning, morph targets, instancing and batching come from the object, in the program of three.js.
     * A material of its own for each source material, since the render list draws them after this, and needsUpdate
     * only when a property that changes its program changes.
     */
    private _getDepthMaterial(object: IObject3D, material: Material): Material {
        const m = material as Material & Partial<PhysicalMaterial> & {linewidth?: number, wireframeLinewidth?: number}
        let result: Material & Partial<MeshDepthMaterial> & {linewidth?: number}
        const custom = object.customDepthMaterial
        if (custom !== undefined) {
            result = custom as typeof result
        } else {
            let depthMaterial = this._depthMaterials.get(material)
            if (!depthMaterial) {
                depthMaterial = new MeshDepthMaterial({colorWrite: false})
                depthMaterial.allowOverride = false
                this._depthMaterials.set(material, depthMaterial)
                material.addEventListener('dispose', this._onSourceMaterialDispose)
            }
            result = depthMaterial
        }

        result.visible = m.visible
        result.wireframe = !!m.wireframe
        result.side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : shadowSide[m.side]
        result.alphaMap = m.alphaMap ?? null
        result.alphaTest = m.alphaToCoverage === true ? 0.5 : m.alphaTest
        result.map = m.map ?? null
        // local clipping planes of the material clip its shadow only with clipShadows (WebGLClipping)
        result.clipShadows = m.clipShadows
        result.clippingPlanes = m.clipShadows ? m.clippingPlanes : null
        result.clipIntersection = m.clipIntersection
        result.displacementMap = m.displacementMap ?? null
        result.displacementScale = m.displacementScale ?? 1
        result.displacementBias = m.displacementBias ?? 0
        result.wireframeLinewidth = m.wireframeLinewidth ?? 1
        result.linewidth = m.linewidth ?? 1

        if (custom === undefined) {
            // the program of three.js depends on these, which it does not check without needsUpdate (alphaTest changes
            // the version itself when it goes from or to 0)
            const key = result.side + '.' + !!result.map + '.' + !!result.alphaMap + '.' + !!result.displacementMap + '.' + result.wireframe + '.' + (result.clippingPlanes?.length ?? 0) + '.' + result.clipIntersection
            const lastKey = this._depthMaterialKeys.get(result)
            if (lastKey !== key) {
                if (lastKey !== undefined) result.needsUpdate = true
                this._depthMaterialKeys.set(result, key)
            }
        }
        return result
    }

    private _onSourceMaterialDispose = (event: {target: Material}) => {
        const material = event.target
        material.removeEventListener('dispose', this._onSourceMaterialDispose)
        const depthMaterial = this._depthMaterials.get(material)
        if (!depthMaterial) return
        depthMaterial.dispose()
        this._depthMaterials.delete(material)
    }

    private _updateMaterial(isNull = false) {
        if (!this._attachedMesh) return
        if (isNull) {
            if (this._attachedMesh.material.alphaMap === this._target?.texture) {
                this._attachedMesh.material.alphaMap = null
            }
            if (this._attachedMesh.material.aoMap === this._target?.texture) {
                this._attachedMesh.material.aoMap = null
            }
            if (this._attachedMesh.material.map === this._target?.texture) {
                this._attachedMesh.material.map = null
            }

        } else if (this._target) {
            if (this.groundMapMode === 'alphaMap') {
                this._attachedMesh.material.alphaMap = this._target.texture
            }
            if (this.groundMapMode === 'aoMap') {
                this._attachedMesh.material.aoMap = this._target.texture
            }
            if (this.groundMapMode === 'map') {
                this._attachedMesh.material.map = this._target.texture
            }
        }

        // needed in DepthNormalPass when rendering to depth
        if (this._attachedMesh.material) {
            this._attachedMesh.material.userData.ALPHA_I_RGBA_PACKING = !isNull && this.groundMapMode === 'alphaMap'
            this._attachedMesh.material.alphaTest = !isNull && this.groundMapMode === 'alphaMap' ? 0.01 : 0

            this._attachedMesh.material.needsUpdate = true
        }
    }

    private _applySmoothFilter(shadowReadBuffer: WebGLRenderTarget, shadowWriteBuffer: WebGLRenderTarget) {
        this._shadowBlurMat.uniforms.colorTexture.value = shadowReadBuffer.texture
        this._shadowBlurMat.uniforms.direction.value.set(1, 0)
        this._shadowBlurMat.uniforms.size.value.set(shadowReadBuffer.width, shadowReadBuffer.height)
        this._viewer.renderManager.blit(shadowWriteBuffer as IRenderTarget, {material: this._shadowBlurMat})

        this._shadowBlurMat.uniforms.colorTexture.value = shadowWriteBuffer.texture
        this._shadowBlurMat.uniforms.direction.value.set(0, 1)
        this._shadowBlurMat.uniforms.size.value.set(shadowWriteBuffer.width, shadowWriteBuffer.height)
        this._viewer.renderManager.blit(shadowReadBuffer as IRenderTarget, {material: this._shadowBlurMat})
    }

    readonly materialExtension: MaterialExtension = {

        parsFragmentSnippet: (_renderer, _material)=> {
            // unpackRGBAToDepth of the baked map (the material shaders do not include <packing> since three r182)
            return glsl`
            #include <packingOnce>
            uniform float transitionOpacity;
            `
        },

        extraUniforms: {
            transitionOpacity: {
                value: 1,
            },
        },

        shaderExtender: (shader, _material, renderer) => {
            if (this.groundMapMode === 'aoMap') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                    '#include <aomap_fragment>',
                    shaderReplaceString(ShaderChunk.aomap_fragment,
                        'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;',
                        'float ambientOcclusion = ( mix(1., unpackRGBAToDepth(texture2D( aoMap, vAoMapUv ) ), transitionOpacity) - 1.0) * aoMapIntensity + 1.0;'
                    ))
                // material.materialObject.transparent = false

            } else if (this.groundMapMode === 'map') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <map_fragment>',
                    shaderReplaceString(ShaderChunk.map_fragment,
                        'diffuseColor *= sampledDiffuseColor',
                        'float groundShadow = mix(1., unpackRGBAToDepth(sampledDiffuseColor), transitionOpacity); diffuseColor.rgb *= groundShadow; diffuseColor.a *= max(0., 1.-groundShadow) * transitionOpacity;'
                    ))
                // material.materialObject.transparent = false

            } else if (this.groundMapMode === 'alphaMap') {

                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <alphamap_fragment>',
                    shaderReplaceString(ShaderChunk.alphamap_fragment,
                        'texture2D( alphaMap, vAlphaMapUv ).g',
                        '1. - unpackRGBAToDepth( texture2D( alphaMap, vAlphaMapUv ) )',
                        {replaceAll: true},
                    ))
                // material.materialObject.transparent = true

            }

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>',
                glsl`#include <opaque_fragment>
                #ifndef OPAQUE
                    #ifdef USE_AOMAP
                        #if NUM_DIR_LIGHT_SHADOWS > 0
                            // TODO find a better solution
                            float alphaMod = length(reflectedLight.directDiffuse)*4./float(NUM_DIR_LIGHT_SHADOWS);
                        #else
                            float alphaMod = 1.;
                        #endif
                        float t1 = 1. - ambientOcclusion;
                        float t2 = max(1. - alphaMod, 0.);
                        float t = t1 + t2;
                        gl_FragColor.a *= max(t, 0.);
                    #endif
                #endif
            `)

            if (this.alphaVignette && renderer.capabilities.isWebGL2) {
                (shader as any).defines.USE_UV = ''
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>',
                    glsl`#include <opaque_fragment>
                    #ifndef OPAQUE
                    float weight = 0.;
                    #ifdef USE_UV // why are we checking for this? this is always supposed to be true
                    weight = 2.*abs(length(0.5 - vUv.${this.alphaVignetteAxis}));
                    #endif
                    #if defined(USE_LIGHTMAP) || defined(USE_AOMAP)
                    weight = 2.*abs(length(0.5 - vAoMapUv.${this.alphaVignetteAxis}));
                    #endif
                    weight = min(1., max(0., weight))-0.5;
                    weight = min(1., max(0., 1.0-2.*weight));
                    weight = pow(weight, 1.5);
                    gl_FragColor.a *= weight;
                    //gl_FragColor.rgb /= max(0.01, weight);
                    gl_FragColor = saturate(gl_FragColor);
                    //gl_FragColor.a = 0.5;
                    #endif
                    `)
            }
        },
        computeCacheKey: ()=>{
            return this.groundMapMode + '.' + this.alphaVignette + '.' + this.alphaVignetteAxis
        },
        onObjectRender: (_object, material) => {
            if (material.userData.gMapMode !== this.groundMapMode) {
                material.userData.gMapMode = this.groundMapMode
                material.needsUpdate = true
            }
        },
        isCompatible: material => {
            return (material).isPhysicalMaterial
        },
    }
}

const _lookTarget = new Vector3()

/**
 * The bake pass: draws the attached mesh in its uv space. The shadow coordinate of each light position, as the
 * shadowmap_vertex chunk of three.js makes it (with shadowNormalBias), from the world position.
 */
const bakeVertexShader = glsl`
uniform mat3 worldNormalMatrix;
uniform float shadowNormalBias;
varying vec2 vUv;
varying vec3 vShadowWorldPosition;
void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vShadowWorldPosition = worldPosition.xyz;
    if (shadowNormalBias != 0.) vShadowWorldPosition += normalize(worldNormalMatrix * normal) * shadowNormalBias;
    gl_Position = vec4(uv * 2. - 1., 0., 1.);
}
`

/**
 * The shadow test of BasicShadowMap (getShadow of the shadowmap_pars_fragment chunk of three.js r182) for each light
 * position, in its tile of the depth texture, with the dither of each sample of the earlier baker (FSShadowMaterial),
 * and the running average with the baked shadow of the last frame, packed in RGBA8.
 */
const bakeFragmentShader = glsl`
#include <common>
#include <packing>
uniform sampler2D tLastThis;
uniform float bakeWeight;
uniform sampler2D shadowDepth;
uniform mat4 shadowMatrices[SHADOW_VIEWS];
uniform vec4 shadowTiles[SHADOW_VIEWS];
uniform int shadowCount;
uniform vec2 shadowTexelSize;
uniform float shadowBias;
uniform float shadowIntensity;
varying vec2 vUv;
varying vec3 vShadowWorldPosition;

float getBakeShadow(vec4 shadowCoord, vec4 tile) {
    float shadow = 1.0;
    shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.z += shadowBias;
    bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
    bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
    if (frustumTest) {
        // in the tile of this light position, at the texel that the whole shadow map would sample (nearest, clamped to the edge)
        vec2 uv = clamp(shadowCoord.xy, 0.5 * shadowTexelSize, 1.0 - 0.5 * shadowTexelSize);
        float depth = texture2D(shadowDepth, tile.xy + uv * tile.zw).r;
        #ifdef USE_REVERSED_DEPTH_BUFFER
            shadow = step(depth, shadowCoord.z);
        #else
            shadow = step(shadowCoord.z, depth);
        #endif
    }
    return mix(1.0, shadow, shadowIntensity);
}

void main() {
    float dither = mix(-1./512., 1./512., rand(gl_FragCoord.xy));
    float shadow = 0.;
    for (int i = 0; i < SHADOW_VIEWS; i++) {
        if (i >= shadowCount) break;
        shadow += clamp(getBakeShadow(shadowMatrices[i] * vec4(vShadowWorldPosition, 1.0), shadowTiles[i]) + dither, 0., 1.);
    }
    shadow /= float(shadowCount);
    float last = unpackRGBAToDepth(texture2D(tLastThis, vUv));
    gl_FragColor = packDepthToRGBA(mix(last, shadow, bakeWeight));
}
`
