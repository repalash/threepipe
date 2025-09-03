import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {generateUiConfig, uiDropdown, uiInput, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {MaterialExtension} from '../../materials'
import {Box3, DirectionalLight, Group, MathUtils, Matrix4, Object3D, ShaderChunk, Vector2, Vector3} from 'three'
import {onChange, serialize} from 'ts-browser-helpers'
import {DirectionalLight2, ICamera, IObject3D, IObject3DEventMap, ISceneEventMap} from '../../core'
import {shaderReplaceString} from '../../utils'

// Original three-csm implementation - https://github.com/StrandedKitty/three-csm

export interface CSMLightData {
    cascades?: number;
    shadowMapSize?: number;
    shadowBias?: number|undefined;
    lightNear?: number|undefined;
    lightFar?: number|undefined;
    // lightRadius?: number;
    lightMargin?: number;
}

const defaultData = {
    cascades: 3,
    // maxFar: 100000,
    // mode: 'practical',
    shadowMapSize: 2048,
    shadowBias: undefined,
    lightNear: undefined,
    lightFar: undefined,
    lightMargin: 200,
    // lightRadius: 1,
} as const satisfies CSMLightData

export class CascadedShadowsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'CascadedShadowsPlugin'

    @uiToggle()
    @serialize()
    @onChange('setDirty')
        enabled = true

    camera?: ICamera // todo camera onchange
    parent: Object3D = new Group()

    /**
     * Total cascades
     */
    // @onChange('refreshLights')
    // totalCascades

    // @onChange('refreshLights')
    //     cascades = 3
    //
    @onChange('cameraNeedsUpdate')
    @serialize()
    @uiInput()
        maxFar = 100000

    @onChange('cameraNeedsUpdate')
    @serialize()
    @uiDropdown(undefined, ['uniform', 'logarithmic', 'practical'/* , 'custom'*/])
        mode: 'uniform'|'logarithmic'|'practical'|'custom' = 'practical'

    /**
     * Automatically attach to first found directional light in the scene if none is attached yet.
     */
    @uiToggle()
    @serialize()
        attachToFirstLight = true

    @onChange('cameraNeedsUpdate')
    @serialize()
    @uiToggle()
        fade: boolean

    // todo
    //  multi light support can also be added
    //  directional light only for now
    //  patch ui config for attached lights
    //  add light helper option?

    @onChange('refreshLights')
        light?: DirectionalLight&IObject3D

    @onChange('cameraNeedsUpdate')
        customSplitsCallback?: (amount: number, near: number, far: number, breaks: number[]) => void

    mainFrustum: CSMFrustum
    frustums: CSMFrustum[] = []
    breaks: number[] = []
    extendedBreaks: (Vector3|Vector2)[] = []
    lights: DirectionalLight[] = []


    constructor() {
        super()
        this.injectInclude()
        this._lastEnabled = this.enabled

        this.mainFrustum = new CSMFrustum()
    }

    private _lightRef: CascadedShadowsPlugin['light']|undefined = undefined
    private _lightUpdate = (e: IObject3DEventMap['objectUpdate'])=>{
        if (e?.object !== this.light) return
        this.refreshLights(e)
    }

    setLightParams(params: CSMLightData, light?: DirectionalLight&IObject3D) {
        light = light || this.light
        if (!light) {
            this._viewer?.console.warn('CascadedShadowsPlugin: No light attached to CascadedShadowsPlugin')
            return
        }
        let userData = light.userData[CascadedShadowsPlugin.PluginType] as CSMLightData|undefined
        if (!userData) {
            userData = {}
            light.userData[CascadedShadowsPlugin.PluginType] = userData
        }
        Object.assign(userData, params)

        if (light === this.light)
            this.refreshLights()
    }

    refreshLights = (e?: any) => {
        if (this._lightRef && this._lightRef !== this.light) {
            this._lightRef.removeEventListener('objectUpdate', this._lightUpdate)
            if (this._lightAutoAttached) this._lightAutoAttached = false
            this._lightRef = undefined
        }

        if (!this.light) {
            return
        }

        if (!this._lightRef) {
            this.light.addEventListener('objectUpdate', this._lightUpdate)
            this._lightRef = this.light
        }

        if (this.isDisabled()) return

        this.light.castShadow = false // todo this will be set as false in gltf then
        this.light.visible = false // todo this will be set as false in gltf then
        this.parent.visible = true


        let userData = this.light.userData[CascadedShadowsPlugin.PluginType] as CSMLightData|undefined
        if (!userData) {
            userData = {}
            this.light.userData[CascadedShadowsPlugin.PluginType] = userData
        }
        const data = {
            ...defaultData,
            ...userData,
        }

        for (let i = 0; i < data.cascades; i++) {

            if (!this.lights[i]) {
                const light = new DirectionalLight(0xffffff, 1)
                light.name = 'CSM Light ' + i
                this.lights.push(light)
                this.parent.add(light)
                this.parent.add(light.target)
            }
            const light = this.lights[i]

            light.intensity = this.light.intensity
            light.castShadow = true
            light.shadow.mapSize.width = data.shadowMapSize
            light.shadow.mapSize.height = data.shadowMapSize

            light.shadow.camera.near = data.lightNear ?? this.light.shadow.camera.near
            light.shadow.camera.far = data.lightFar ?? this.light.shadow.camera.far
            light.shadow.bias = data.shadowBias ?? this.light.shadow.bias
            light.shadow.normalBias = this.light.shadow.normalBias
            light.shadow.radius = this.light.shadow.radius
            // todo blurSamples? anything else?

        }

        if (this.lights.length > data.cascades) {
            const remove = this.lights.splice(data.cascades, this.lights.length - data.cascades)
            for (const light of remove) {
                this.parent.remove(light.target)
                this.parent.remove(light)
            }
        }

        const changeKey = e?.change ?? e?.key
        if (!changeKey && ![
            'intensity', 'castShadow', 'mapSize', 'bias', 'radius', 'shadow',
        ].includes(changeKey)) this.cameraNeedsUpdate()
    }

    private _mainCameraChange = (event: ISceneEventMap['mainCameraChange']) => {
        this.camera = event.camera
        this.cameraNeedsUpdate()
    }

    private _cameraUpdated = false
    private _mainCameraUpdate = (event: ISceneEventMap['mainCameraUpdate']) => {
        if (event.projectionUpdated !== false) this.cameraNeedsUpdate()
        else this.setDirty()
    }
    cameraNeedsUpdate = () => {
        this._cameraUpdated = true
        this._viewer?.setDirty()
    }

    private _needsUpdate = false
    private _lastEnabled: boolean
    setDirty = () => {
        const enabled = !this.isDisabled()
        if (enabled !== this._lastEnabled) {
            this._lastEnabled = enabled
            this.refreshLights()
            if (!enabled) {
                if (this.light) {
                    this.light.castShadow = true
                    this.light.visible = true
                    this.parent.visible = false
                    this.light.setDirty()
                }
                this.extendedBreaks.length = 0
                this._sversion++
                this.materialExtension.setDirty && this.materialExtension.setDirty()
                this._viewer?.setDirty()
            }
        }
        if (!enabled) return
        this._needsUpdate = true
        this._viewer?.setDirty()
    }

    protected _viewerListeners = {
        preRender: () => {
            if (this.isDisabled() || !this.light) return
            let updated = false
            if (/* this.camera?.isOrthographicCamera || */this._cameraUpdated) {
                // updateOrthoCamera()
                this._updateFrustums()
                updated = true
                // if (params.autoUpdateHelper) {
                //     csmHelper.update()
                // }
            } else {
                // if (params.autoUpdateHelper) {
                //     csmHelper.update()
                // }
            }
            if (this._needsUpdate && !this.update()) updated = true
            if (updated) this._viewer?.renderManager.resetShadows()
        },
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)
        viewer.scene.addEventListener('mainCameraUpdate', this._mainCameraUpdate)
        viewer.renderManager.addEventListener('resize', this.cameraNeedsUpdate)
        this.camera = viewer.scene.mainCamera
        viewer.materialManager.registerMaterialExtension(this.materialExtension)

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)

        viewer.scene.addObject(this.parent, {addToRoot: true, indexInParent: 0}) // we need to be before modelRoot so other lights dont interfere in the shader
        // this.parent = viewer.scene
        this.refreshLights()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        viewer.scene.removeEventListener('mainCameraUpdate', this._mainCameraUpdate)
        viewer.renderManager.removeEventListener('resize', this.cameraNeedsUpdate)
        viewer.materialManager.unregisterMaterialExtension(this.materialExtension)

        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))

        for (const light of this.lights) {
            // todo dispose shadowmaps
            this.parent.remove(light.target)
            this.parent.remove(light)
        }
        this.parent.clear()
        this.parent.removeFromParent()

        this.camera = undefined

        super.onRemove(viewer)
    }

    protected _initCascades(breaks: number[]) {
        const camera = this.camera
        if (!camera) return this.frustums
        camera.updateProjectionMatrix && camera.updateProjectionMatrix() // this is not needed actually
        this.mainFrustum.setFromProjectionMatrix(camera.projectionMatrix, this.maxFar)
        this.mainFrustum.split(breaks, this.frustums)

        return this.frustums
    }

    protected _updateShadowBounds() {

        for (let i = 0; i < this.frustums.length; i++) {

            const light = this.lights[i]
            const shadowCam = light.shadow.camera
            const frustum = this.frustums[i]

            // Get the two points that represent that furthest points on the frustum assuming
            // that's either the diagonal across the far plane or the diagonal across the whole
            // frustum itself.
            const nearVerts = frustum.vertices.near
            const farVerts = frustum.vertices.far
            const point1 = farVerts[0]
            let point2
            if (point1.distanceTo(farVerts[2]) > point1.distanceTo(nearVerts[2])) {

                point2 = farVerts[2]

            } else {

                point2 = nearVerts[2]

            }

            let squaredBBWidth = point1.distanceTo(point2)
            if (this.fade && this.camera) {

                // expand the shadow extents by the fade margin if fade is enabled.
                const camera = this.camera
                const far = Math.max(camera.far, this.maxFar)
                const linearDepth = frustum.vertices.far[0].z / (far - camera.near)
                const margin = 0.25 * Math.pow(linearDepth, 2.0) * (far - camera.near)

                squaredBBWidth += margin

            }

            shadowCam.left = -squaredBBWidth / 2
            shadowCam.right = squaredBBWidth / 2
            shadowCam.top = squaredBBWidth / 2
            shadowCam.bottom = -squaredBBWidth / 2
            shadowCam.updateProjectionMatrix()

        }

    }

    protected _getBreaks(cascades: number) {
        this.breaks.length = 0

        const camera = this.camera
        if (!camera) return this.breaks

        const far = Math.min(camera.far, this.maxFar)

        let mode = this.mode
        if (mode === 'custom' && this.customSplitsCallback === undefined) {
            console.error('CSM: Custom split scheme callback not defined.')
            mode = 'practical'
        }


        switch (mode) {

        case 'uniform':
            this._uniformSplit(cascades, camera.near, far, this.breaks)
            break
        case 'logarithmic':
            this._logarithmicSplit(cascades, camera.near, far, this.breaks)
            break
        case 'practical':
        default:
            this._practicalSplit(cascades, camera.near, far, 0.5, this.breaks)
            break
        case 'custom':
            this.customSplitsCallback!(cascades, camera.near, far, this.breaks)
            break

        }

        return this.breaks
    }

    /**
     * Uniform split function for shadow cascades
     */
    private _uniformSplit(amount: number, near: number, farValue: number, target: number[]): void {
        for (let i = 1; i < amount; i++) {
            target.push((near + (farValue - near) * i / amount) / farValue)
        }
        target.push(1)
    }

    /**
     * Logarithmic split function for shadow cascades
     */
    private _logarithmicSplit(amount: number, near: number, farValue: number, target: number[]): void {
        for (let i = 1; i < amount; i++) {
            target.push(near * (farValue / near) ** (i / amount) / farValue)
        }
        target.push(1)
    }

    /**
     * Practical split function for shadow cascades
     */
    private _practicalSplit(amount: number, near: number, farValue: number, lambda: number, target: number[]): void {
        this._uniformArray.length = 0
        this._logArray.length = 0
        this._logarithmicSplit(amount, near, farValue, this._logArray)
        this._uniformSplit(amount, near, farValue, this._uniformArray)

        for (let i = 1; i < amount; i++) {
            target.push(MathUtils.lerp(this._uniformArray[i - 1], this._logArray[i - 1], lambda))
        }
        target.push(1)
    }

    private _lastCenters: Vector3[] = []

    update() {
        this._needsUpdate = false
        const camera = this.camera
        if (!camera || !this.light) return true

        const frustums = this.frustums

        const {
            shadowMapSize = defaultData.shadowMapSize,
            lightMargin = defaultData.lightMargin,
        } = this.light.userData[CascadedShadowsPlugin.PluginType] as CSMLightData|undefined || {}

        {
            this.light.updateMatrixWorld()
            const lightPos = this.light.getWorldPosition(this._center)
            // const lightPos = this._center.copy(this.light.position)
            this.light.target.updateMatrixWorld()
            this.light.target.getWorldPosition(this._lightDirection)
            // this._lightDirection.copy(this.light.target.position)

            // console.log(lightPos, this._lightDirection, this.light)

            // for each frustum we need to find its min-max box aligned with the light orientation
            // the position in lightOrientationMatrix does not matter, as we transform there and back
            this._lightOrientationMatrix.lookAt(lightPos, this._lightDirection, this._up)
            this._lightOrientationMatrixInverse.copy(this._lightOrientationMatrix).invert()

            this._lightDirection.sub(lightPos).normalize()
        }

        const centers = []
        for (let i = 0; i < frustums.length; i++) {

            const light = this.lights[i]
            const shadowCam = light.shadow.camera
            const texelWidth = (shadowCam.right - shadowCam.left) / shadowMapSize
            const texelHeight = (shadowCam.top - shadowCam.bottom) / shadowMapSize
            this._cameraToLightMatrix.multiplyMatrices(this._lightOrientationMatrixInverse, camera.matrixWorld)
            frustums[i].toSpace(this._cameraToLightMatrix, this._lightSpaceFrustum)

            const nearVerts = this._lightSpaceFrustum.vertices.near
            const farVerts = this._lightSpaceFrustum.vertices.far
            this._bbox.makeEmpty()
            for (let j = 0; j < 4; j++) {

                this._bbox.expandByPoint(nearVerts[j])
                this._bbox.expandByPoint(farVerts[j])

            }

            this._bbox.getCenter(this._center)
            this._center.z = this._bbox.max.z + lightMargin
            this._center.x = Math.floor(this._center.x / texelWidth) * texelWidth
            this._center.y = Math.floor(this._center.y / texelHeight) * texelHeight
            this._center.applyMatrix4(this._lightOrientationMatrix)

            centers.push(this._center.clone())
            light.position.copy(this._center)
            light.target.position.copy(this._center).add(this._lightDirection)

        }
        let same = true
        if (centers.length === this._lastCenters.length) {
            for (let i = 0; i < centers.length; i++) {
                if (Math.abs(centers[i].x - this._lastCenters[i].x) + Math.abs(centers[i].y - this._lastCenters[i].y) + Math.abs(centers[i].z - this._lastCenters[i].z) > 0.001) {
                    same = false
                    break
                }
            }
        } else same = false
        this._lastCenters = centers
        return same
    }

    private _lightAutoAttached = false
    private _objectAdd = (e: {object?: IObject3D})=>{
        if (this.light || !this.attachToFirstLight) return
        const obj = e.object
        if (!obj?.isDirectionalLight || !obj.castShadow) return
        const light = obj as DirectionalLight2
        this.light = light
        this._lightAutoAttached = true
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        if (!this._lightAutoAttached || !this.light) return
        const obj = e.object as any
        if (obj !== this.light) return
        this.light = undefined
        this._lightAutoAttached = false
    }

    private _sversion = 0
    protected _updateFrustums = () => {
        if (!this.light) return

        const {
            cascades = defaultData.cascades,
        } = this.light.userData[CascadedShadowsPlugin.PluginType] as CSMLightData|undefined || {}

        const breaks = this._getBreaks(cascades)
        /* const frustums = */this._initCascades(breaks)
        this._updateShadowBounds()

        // Compute and cache extended breaks for material extension
        this.extendedBreaks.length = 0
        for (let i = 0; i < breaks.length; i++) {
            const amount = breaks[i]
            this.extendedBreaks.push(new Vector2(breaks[i - 1] || 0, amount/* , cascades + 0.1*/)) // setting total cascades for that light so it can be used in shader in the future
        }

        // this.updateUniforms()
        this._sversion++
        this.materialExtension.setDirty && this.materialExtension.setDirty()
        this._cameraUpdated = false
        this.setDirty()
    }

    /**
     * Total cascades
     */
    get cascades() {
        if (this.isDisabled() || !this.light) return 0
        return this.frustums.length
    }

    materialExtension: MaterialExtension = {
        extraDefines: {
            ['CSM_CASCADES']: () => this.cascades.toString(),
            ['USE_CSM']: ()=>this.light && !this.isDisabled() ? '1' : undefined,
            ['CSM_FADE']: () => this.fade ? '1' : undefined,
        },
        extraUniforms: {
            // ['CSM_cascades']: {value: []},
            // ['cameraNear']: ()=>({value: this.camera?.near ?? 0.01}), // todo test dynamic prop
            // ['shadowFar']: ()=>{
            //     console.log('update uniform')
            //     return {value: Math.min(this.camera?.far ?? 1000, this.maxFar)}
            // },
        },
        computeCacheKey: (_) => {
            // todo need uniforms also here, or just make a integer cache key for the whole plugin
            return (this.isDisabled() ? '1' : '0') + this.lights.length + (this.fade ? '1' : '0') + this.light?.uuid
        },
        // shaderExtender: (shader) => {
        //     // console.log('shader extend')
        //     // if (!shader.uniforms.CSM_cascades) shader.uniforms.CSM_cascades = {value: []}
        //     // this.getExtendedBreaks(shader.uniforms.CSM_cascades.value)
        // },
        onObjectRender: (_, material) => {
            if (material.extraUniformsToUpload.CSM_cascades) material.extraUniformsToUpload.CSM_cascades.needsUpdate = false
            if (material.extraUniformsToUpload.cameraNear) material.extraUniformsToUpload.cameraNear.needsUpdate = false
            if (material.extraUniformsToUpload.shadowFar) material.extraUniformsToUpload.shadowFar.needsUpdate = false

            if (this.isDisabled() || !this.light) return

            if (!material.extraUniformsToUpload) material.extraUniformsToUpload = {}

            if (!material.extraUniformsToUpload.CSM_cascades) material.extraUniformsToUpload.CSM_cascades = {value: []}
            if (!material.extraUniformsToUpload.cameraNear) material.extraUniformsToUpload.cameraNear = {value: 0}
            if (!material.extraUniformsToUpload.shadowFar) material.extraUniformsToUpload.shadowFar = {value: 0}

            if (!(material as any).__csmVersion) (material as any).__csmVersion = 0
            if ((material as any).__csmVersion === this._sversion) return
            ;(material as any).__csmVersion = this._sversion
            material.extraUniformsToUpload.cameraNear.value = this.camera?.near ?? 0.01
            material.extraUniformsToUpload.shadowFar.value = Math.min(this.camera?.far ?? 1000, this.maxFar)
            material.extraUniformsToUpload.CSM_cascades.value = this.extendedBreaks// .map(v=>v.clone())

            material.extraUniformsToUpload.cameraNear.needsUpdate = true
            material.extraUniformsToUpload.shadowFar.needsUpdate = true
            material.extraUniformsToUpload.CSM_cascades.needsUpdate = true
        },

        isCompatible: (material: any) => {
            return material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial
        },
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Cascaded Shadows (CSM)',
        children: [
            ...generateUiConfig(this),
            {
                type: 'button',
                label: ()=>this.light ? 'Select Light' : 'No Light Attached',
                disabled: ()=>!this.light,
                onClick: ()=>{
                    if (!this.light) return
                    this.light.dispatchEvent({type: 'select', ui: true, value: this.light, object: this.light})
                },
            },
        ],
    }

    // todo in three.js r166 update, add shadow intensity in shader calls
    injectInclude() {

        // ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin
        ShaderChunk.lights_fragment_begin = shaderReplaceString(
            ShaderChunk.lights_fragment_begin,
            '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )\n', `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM ) && defined( CSM_CASCADES )

	DirectionalLight directionalLight;
	float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif

	#if defined( USE_SHADOWMAP ) && defined( CSM_FADE )
		vec2 cascade;
		float cascadeCenter;
		float closestEdge;
		float margin;
		float csmx;
		float csmy;

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

			directionalLight = directionalLights[ i ];
			getDirectionalLightInfo( directionalLight, directLight );

			#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			
            #if ( UNROLLED_LOOP_INDEX < CSM_CASCADES )

				// NOTE: Depth gets larger away from the camera.
				// cascade.x is closer, cascade.y is further
				cascade = CSM_cascades[ UNROLLED_LOOP_INDEX ];
				cascadeCenter = ( cascade.x + cascade.y ) / 2.0;
				closestEdge = linearDepth < cascadeCenter ? cascade.x : cascade.y;
				margin = 0.25 * pow( closestEdge, 2.0 );
				csmx = cascade.x - margin / 2.0;
				csmy = cascade.y + margin / 2.0;
				if( linearDepth >= csmx && ( linearDepth < csmy || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 ) ) {

					float dist = min( linearDepth - csmx, csmy - linearDepth );
					float ratio = clamp( dist / margin, 0.0, 1.0 );

					vec3 prevColor = directLight.color;
					directionalLightShadow = directionalLightShadows[ i ];
					directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

					bool shouldFadeLastCascade = UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth > cascadeCenter;
					directLight.color = mix( prevColor, directLight.color, shouldFadeLastCascade ? ratio : 1.0 );

					ReflectedLight prevLight = reflectedLight;
					RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

					bool shouldBlend = UNROLLED_LOOP_INDEX != CSM_CASCADES - 1 || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth < cascadeCenter;
					float blendRatio = shouldBlend ? ratio : 1.0;

					reflectedLight.directDiffuse = mix( prevLight.directDiffuse, reflectedLight.directDiffuse, blendRatio );
					reflectedLight.directSpecular = mix( prevLight.directSpecular, reflectedLight.directSpecular, blendRatio );
					reflectedLight.indirectDiffuse = mix( prevLight.indirectDiffuse, reflectedLight.indirectDiffuse, blendRatio );
					reflectedLight.indirectSpecular = mix( prevLight.indirectSpecular, reflectedLight.indirectSpecular, blendRatio );

				}
				
				
            #else 
            
                directionalLightShadow = directionalLightShadows[ i ];
                directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
    
                RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

			#endif
			
			#endif

		}
		#pragma unroll_loop_end
	#elif defined (USE_SHADOWMAP)

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

			directionalLight = directionalLights[ i ];
			getDirectionalLightInfo( directionalLight, directLight );

			#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )

                directionalLightShadow = directionalLightShadows[ i ];
				
				#if ( UNROLLED_LOOP_INDEX < CSM_CASCADES )

					if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y) directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

					if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && (linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

				#else

					directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

					RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

				#endif
				
			#endif

		}
		#pragma unroll_loop_end

	#elif ( NUM_DIR_LIGHT_SHADOWS > 0 )
		// note: no loop here - all CSM lights are in fact one light only
		getDirectionalLightInfo( directionalLights[0], directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	#endif

	#if ( NUM_DIR_LIGHTS > NUM_DIR_LIGHT_SHADOWS)
		// compute the lights not casting shadows (if any)

		#pragma unroll_loop_start
		for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {

			directionalLight = directionalLights[ i ];

			getDirectionalLightInfo( directionalLight, directLight );

			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

		}
		#pragma unroll_loop_end

	#endif

#endif


#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !( defined( USE_CSM ) && defined( CSM_CASCADES ) )
`)
        // ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin
        ShaderChunk.lights_pars_begin = `
#if defined( USE_CSM ) && defined( CSM_CASCADES )
uniform vec2 CSM_cascades[CSM_CASCADES];
uniform float cameraNear;
uniform float shadowFar;
#endif
	` + ShaderChunk.lights_pars_begin

    }

    // temp variables
    private readonly _lightDirection = new Vector3()
    private readonly _cameraToLightMatrix = new Matrix4()
    private readonly _lightSpaceFrustum = new CSMFrustum()
    private readonly _center = new Vector3()
    private readonly _bbox = new Box3()
    private readonly _uniformArray: number[] = []
    private readonly _logArray: number[] = []
    private readonly _lightOrientationMatrix = new Matrix4()
    private readonly _lightOrientationMatrixInverse = new Matrix4()
    private readonly _up = new Vector3(0, 1, 0)

}

export interface FrustumParams {
    projectionMatrix?: Matrix4;
    maxFar?: number;
}

export interface FrustumVertices {
    far: Vector3[];
    near: Vector3[]
}

export class CSMFrustum {
    private _inverseProjectionMatrix = new Matrix4()

    public vertices: FrustumVertices = {
        near: [
            new Vector3(),
            new Vector3(),
            new Vector3(),
            new Vector3(),
        ],
        far: [
            new Vector3(),
            new Vector3(),
            new Vector3(),
            new Vector3(),
        ],
    }

    public constructor(data: FrustumParams = {}) {

        if (data.projectionMatrix !== undefined) {

            this.setFromProjectionMatrix(data.projectionMatrix, data.maxFar || 10000)

        }

    }

    public setFromProjectionMatrix(projectionMatrix: Matrix4, maxFar: number): FrustumVertices {

        const isOrthographic = projectionMatrix.elements[ 2 * 4 + 3 ] === 0

        this._inverseProjectionMatrix.copy(projectionMatrix).invert()

        // 3 --- 0  vertices.near/far order
        // |     |
        // 2 --- 1
        // clip space spans from [-1, 1]

        this.vertices.near[ 0 ].set(1, 1, -1)
        this.vertices.near[ 1 ].set(1, -1, -1)
        this.vertices.near[ 2 ].set(-1, -1, -1)
        this.vertices.near[ 3 ].set(-1, 1, -1)
        this.vertices.near.forEach((v) => {

            v.applyMatrix4(this._inverseProjectionMatrix)

        })

        this.vertices.far[ 0 ].set(1, 1, 1)
        this.vertices.far[ 1 ].set(1, -1, 1)
        this.vertices.far[ 2 ].set(-1, -1, 1)
        this.vertices.far[ 3 ].set(-1, 1, 1)
        this.vertices.far.forEach((v) => {

            v.applyMatrix4(this._inverseProjectionMatrix)

            const absZ = Math.abs(v.z)
            if (isOrthographic) {

                v.z *= Math.min(maxFar / absZ, 1.0)

            } else {

                v.multiplyScalar(Math.min(maxFar / absZ, 1.0))

            }

        })

        return this.vertices

    }

    public split(breaks: number[], target: CSMFrustum[]) {

        while (breaks.length > target.length) {

            target.push(new CSMFrustum())

        }

        target.length = breaks.length

        for (let i = 0; i < breaks.length; i++) {

            const cascade = target[ i ]

            if (i === 0) {

                for (let j = 0; j < 4; j++) {

                    cascade.vertices.near[ j ].copy(this.vertices.near[ j ])

                }

            } else {

                for (let j = 0; j < 4; j++) {

                    cascade.vertices.near[ j ].lerpVectors(this.vertices.near[ j ], this.vertices.far[ j ], breaks[ i - 1 ])

                }

            }

            if (i === breaks.length - 1) {

                for (let j = 0; j < 4; j++) {

                    cascade.vertices.far[ j ].copy(this.vertices.far[ j ])

                }

            } else {

                for (let j = 0; j < 4; j++) {

                    cascade.vertices.far[ j ].lerpVectors(this.vertices.near[ j ], this.vertices.far[ j ], breaks[ i ])

                }

            }

        }

    }

    public toSpace(cameraMatrix: Matrix4, target: CSMFrustum) {

        for (let i = 0; i < 4; i++) {

            target.vertices.near[ i ]
                .copy(this.vertices.near[ i ])
                .applyMatrix4(cameraMatrix)

            target.vertices.far[ i ]
                .copy(this.vertices.far[ i ])
                .applyMatrix4(cameraMatrix)

        }

    }

}
