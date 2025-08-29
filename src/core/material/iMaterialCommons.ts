import {
    ColorManagement,
    Event,
    Material,
    MaterialParameters,
    Scene,
    Texture,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'three'
import {copyProps} from 'ts-browser-helpers'
import {copyMaterialUserData} from '../../utils/serialization'
import {MaterialExtender, MaterialExtension} from '../../materials'
import {IScene} from '../IScene'
import {AnimateTimeMaterial, IMaterial, IMaterialEventMap, IMaterialSetDirtyOptions} from '../IMaterial'
import {UnlitMaterial} from './UnlitMaterial'
import {threeMaterialInterpolateProps, threeMaterialPropList} from './threeMaterialPropList'
import {lerpParams} from '../../utils/lerp'
import {ITexture} from '../ITexture'
import {checkTexMapReference} from '../../three'

export const iMaterialCommons = {
    threeMaterialPropList,
    threeMaterialInterpolateProps,
    setDirty: function(this: IMaterial, options?: IMaterialSetDirtyOptions): void {
        if (options?.needsUpdate !== false) this.needsUpdate = true
        iMaterialCommons.refreshTextureRefs.call(this)
        this.dispatchEvent({bubbleToObject: true, bubbleToParent: true, ...options, type: 'materialUpdate'}) // this sets sceneUpdate in root scene
        if (options?.last !== false && options?.refreshUi !== false) this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    },
    /** @ignore */
    setValues: (superSetValues: Material['setValues']): IMaterial['setValues'] =>
        function(this: IMaterial, parameters: Material | (MaterialParameters & {type?: string}), _allowInvalidType?: boolean, clearCurrentUserData?: boolean, time?: AnimateTimeMaterial): IMaterial {

            if (clearCurrentUserData === undefined) clearCurrentUserData = (<Material>parameters).isMaterial
            if (clearCurrentUserData) this.userData = {}

            // legacy check for old color management(non-sRGB) in material.setValues todo: move this to Material.fromJSON
            const legacyColors = (parameters as any)?.metadata && (parameters as any)?.metadata.version <= 4.5
            const lastColorManagementEnabled = ColorManagement.enabled
            if (legacyColors) ColorManagement.enabled = false

            const propList = this.constructor.MaterialProperties
            const params: any = !propList ? {...parameters} : copyProps(parameters, {} as any, Array.from(Object.keys(propList)))

            // remove undefined values
            for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key]

            const userData = params.userData
            delete params.userData

            const interpolateProps = new Set([...this.constructor.InterpolateProperties || UnlitMaterial.InterpolateProperties, ...this.constructor.MapProperties || UnlitMaterial.MapProperties])
            if (time) {
                lerpParams(params, this as any, interpolateProps, time)
            }

            // todo: can migrate to @serialize for properties which have UI etc and use super.setValues for the rest like threeMaterialPropList
            superSetValues.call(this, params)

            if (userData) copyMaterialUserData(this.userData, userData)

            // bump map scale fix todo: move this to Material.fromJSON
            // https://github.com/repalash/three.js/commit/7b13bb515866f6a002928bd28d0a793cafeaeb1a
            const legacyBumpScale = (parameters as any)?.metadata && (parameters as any)?.metadata.version <= 4.6
            if ((legacyBumpScale || this.userData.legacyBumpScale) && (this as any)?.bumpScale !== undefined && this?.bumpMap && this.defines) {
                console.warn('MaterialManager: Old format material loaded, bump map might be incorrect.', parameters, (parameters as any).bumpScale)
                this.defines.BUMP_MAP_SCALE_LEGACY = '1'
                this.userData.legacyBumpScale = true
                this.needsUpdate = true
            }

            if (legacyColors) ColorManagement.enabled = lastColorManagementEnabled

            this.setDirty && this.setDirty()
            return this
        },
    /** @ignore */
    dispose: (superDispose: Material['dispose']): IMaterial['dispose'] =>
        function(this: IMaterial, force = true): void {
            if (!force && this.userData.disposeOnIdle === false) return
            superDispose.call(this)
        },
    /** @ignore */
    clone: (superClone: Material['clone']): IMaterial['clone'] =>
        function(this: IMaterial, track = false): IMaterial {
            if (track) {
                if (!this.userData.cloneId) {
                    this.userData.cloneId = '0'
                }
                if (!this.userData.cloneCount) {
                    this.userData.cloneCount = 0
                }
                this.userData.cloneCount += 1
            }

            const material: IMaterial = this.generator?.({})?.setValues(this, false) ?? superClone.call(this)

            if (track) {

                material.userData.cloneId = material.userData.cloneId + '_' + this.userData.cloneCount
                material.userData.cloneCount = 0
                material.name = (material.name || 'mat') + '_' + material.userData.cloneId
            }

            return material
        },
    /** @ignore */
    dispatchEvent: (superDispatchEvent: Material['dispatchEvent']): IMaterial['dispatchEvent'] =>
        function(this: IMaterial, event): void {
            superDispatchEvent.call(this, event)
            const type = event.type
            if ((event as IMaterialEventMap['materialUpdate']).bubbleToObject && (
                type === 'beforeDeserialize' || type === 'materialUpdate' || type === 'textureUpdate' || type === 'select' // todo - add more events
            )) {
                this.appliedMeshes.forEach(m => m.dispatchEvent({...event, material: this, type}))
            }
        },

    customProgramCacheKey: function(this: IMaterial): string {
        return MaterialExtender.CacheKeyForExtensions(this, this.materialExtensions) + this.userData.inverseAlphaMap
    },
    registerMaterialExtensions: function(this: IMaterial, customMaterialExtensions: MaterialExtension[]): void {
        MaterialExtender.RegisterExtensions(this, customMaterialExtensions)
    },
    unregisterMaterialExtensions: function(this: IMaterial, customMaterialExtensions: MaterialExtension[]): void {
        MaterialExtender.UnregisterExtensions(this, customMaterialExtensions)
    },

    // shader is not Shader but WebglUniforms.getParameters return value type so includes defines
    onBeforeCompile: function(this: IMaterial, shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
        if (this.materialExtensions) MaterialExtender.ApplyMaterialExtensions(this, shader, this.materialExtensions, renderer)

        this.dispatchEvent({type: 'beforeCompile', shader, renderer})

        shader.fragmentShader = shader.fragmentShader.replaceAll('#glMarker', '// ')
        shader.vertexShader = shader.vertexShader.replaceAll('#glMarker', '// ')
    },
    /** @ignore */
    onBeforeRender: function(this: IMaterial, renderer, scene: Scene & Partial<IScene>, camera, geometry, object) {
        if (this.envMapIntensity !== undefined && !this.userData.separateEnvMapIntensity && scene.envMapIntensity !== undefined) {
            this.userData.__envIntensity = this.envMapIntensity
            this.envMapIntensity = scene.envMapIntensity
        }
        if (this.defines && this.envMap !== undefined && scene.fixedEnvMapDirection !== undefined) {
            if (scene.fixedEnvMapDirection) {
                if (!this.defines.FIX_ENV_DIRECTION) {
                    this.defines.FIX_ENV_DIRECTION = '1'
                    this.needsUpdate = true
                }
            } else if (this.defines.FIX_ENV_DIRECTION !== undefined) {
                delete this.defines.FIX_ENV_DIRECTION
                this.needsUpdate = true
            }
        }
        this.dispatchEvent({type: 'beforeRender', renderer, scene, camera, geometry, object})
    } as IMaterial['onBeforeRender'],
    /** @ignore */
    onAfterRender: function(this: IMaterial, renderer, scene: Scene & Partial<IScene>, camera, geometry, object) {
        if (this.userData.__envIntensity !== undefined) {
            this.envMapIntensity = this.userData.__envIntensity
            delete this.userData.__envIntensity
        }
        this.dispatchEvent({type: 'afterRender', renderer, scene, camera, geometry, object})
    } as IMaterial['onAfterRender'],

    /** @ignore */
    onBeforeCompileOverride: (superOnBeforeCompile: Material['onBeforeCompile']): IMaterial['onBeforeCompile'] =>
        function(this: IMaterial, shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
            iMaterialCommons.onBeforeCompile.call(this, shader, renderer)
            superOnBeforeCompile.call(this, shader, renderer)
        },
    /** @ignore */
    onBeforeRenderOverride: (superOnBeforeRender: Material['onBeforeRender']): IMaterial['onBeforeRender'] =>
        function(this: IMaterial, ...args: Parameters<Material['onBeforeRender']>): void {
            superOnBeforeRender.call(this, ...args)
            iMaterialCommons.onBeforeRender.call(this, ...args)
        },
    /** @ignore */
    onAfterRenderOverride: (superOnAfterRender: Material['onAfterRender']): IMaterial['onAfterRender'] =>
        function(this: IMaterial, ...args: Parameters<Material['onAfterRender']>): void {
            superOnAfterRender.call(this, ...args)
            iMaterialCommons.onAfterRender.call(this, ...args)
        },
    /** @ignore */
    customProgramCacheKeyOverride: (superCustomPropertyCacheKey: Material['customProgramCacheKey']): IMaterial['customProgramCacheKey'] =>
        function(this: IMaterial): string {
            return superCustomPropertyCacheKey.call(this) + iMaterialCommons.customProgramCacheKey.call(this)
        },

    upgradeMaterial: upgradeMaterial,

    getMapsForMaterial: function(this: IMaterial) {
        const maps = new Set<ITexture>()
        for (const prop of this.constructor?.MapProperties || materialTextureProperties) {
            checkTexMapReference(prop, this, maps)
        }
        if (this.userData)
            for (const prop of materialTexturePropertiesUserData) {
                checkTexMapReference(prop, this.userData, maps, true)
            }

        return maps
    },
    refreshTextureRefs: function(this: IMaterial) {
        if (!this.__textureUpdate) this.__textureUpdate = textureUpdate.bind(this)
        const newMaps = iMaterialCommons.getMapsForMaterial.call(this)
        const oldMaps = this._mapRefs || new Set<ITexture>()
        let changed = false
        const added = new Set<ITexture>()
        const removed = new Set<ITexture>()
        for (const map of newMaps) {
            if (!map || !map.isTexture) continue
            map.addEventListener('update', this.__textureUpdate!)
            if (oldMaps.has(map)) continue
            changed = true
            added.add(map)
        }
        for (const map of oldMaps) {
            if (newMaps.has(map)) continue
            map.removeEventListener('update', this.__textureUpdate!)
            changed = true
            removed.add(map)
        }
        this._mapRefs = newMaps
        if (changed) {
            this.dispatchEvent({
                type: 'texturesChanged',
                textures: newMaps, oldTextures: oldMaps,
                addedTextures: added, removedTextures: removed,
                material: this,
                bubbleToObject: true,
                bubbleToParent: true,
            })
        }
    },

    // todo;
} as const

const textureUpdate = function(this: IMaterial, e: Event<'update', Texture>) {
    if (!this || this.assetType !== 'material') return
    this.dispatchEvent({texture: e.target, bubbleToParent: true, bubbleToObject: true, ...e, type: 'textureUpdate'})
}

export const materialTextureProperties: Set<string> = new Set<string>([])
// todo add from plugins like custom bump map etc.
export const materialTexturePropertiesUserData: Set<string> = new Set<string>([])

/**
 * Convert a standard three.js {@link Material} to {@link IMaterial}
 */
export function upgradeMaterial(this: IMaterial): IMaterial {
    if (!this.isMaterial) {
        console.error('Material is not a material', this)
        return this
    }
    if (!this.setDirty) this.setDirty = iMaterialCommons.setDirty
    if (!this.appliedMeshes) this.appliedMeshes = new Set()
    if (!this.userData) this.userData = {}
    this.userData.uuid = this.uuid // for serialization

    if (!(this as any).__upgradeSetup) {
        this.dispatchEvent = iMaterialCommons.dispatchEvent(this.dispatchEvent)
        ;(this as any).__upgradeSetup = true
    }
    // legacy
    // if (!this.userData.setDirty) this.userData.setDirty = (e: any) => {
    //     console.warn('userData.setDirty is deprecated. Use setDirty instead.')
    //     this.setDirty(e)
    // }

    if (this.assetType === 'material') return this // already upgraded
    this.assetType = 'material'
    this.setValues = iMaterialCommons.setValues(this.setValues)
    this.dispose = iMaterialCommons.dispose(this.dispose)
    this.clone = iMaterialCommons.clone(this.clone)

    // material extensions
    if (!this.extraUniformsToUpload) this.extraUniformsToUpload = {}
    if (!this.materialExtensions) this.materialExtensions = []
    if (!this.registerMaterialExtensions) this.registerMaterialExtensions = iMaterialCommons.registerMaterialExtensions
    if (!this.unregisterMaterialExtensions) this.unregisterMaterialExtensions = iMaterialCommons.unregisterMaterialExtensions
    // in troika text material, onBeforeCompile is a get/set property that chains it, causing infinite loop if we just override it. todo - couldnt find a better way right now than hard check, descriptors are the same
    const skipOverride = !(this as any).isDerivedMaterial
    this.onBeforeCompile = !skipOverride ? iMaterialCommons.onBeforeCompile : iMaterialCommons.onBeforeCompileOverride(this.onBeforeCompile)
    this.onBeforeRender = iMaterialCommons.onBeforeRenderOverride(this.onBeforeRender)
    this.onAfterRender = iMaterialCommons.onAfterRenderOverride(this.onAfterRender)
    this.customProgramCacheKey = iMaterialCommons.customProgramCacheKeyOverride(this.customProgramCacheKey)

    // todo: add uiconfig, serialization, other stuff from UnlitMaterial?
    // dispose uiconfig etc. on dispose

    this.setDirty({change: 'upgradeMaterial'})
    return this
}
