import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {onChange, serialize} from 'ts-browser-helpers'
import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {shaderReplaceString} from '../../utils'
import {ShaderChunk} from 'three'
import {PhysicalMaterial} from '../../core'
import ParallaxMappingPluginReliefShader from './shaders/ParallaxMappingPlugin.relief.glsl'

/**
 * Parallax Mapping Plugin
 * Adds a material extension to PhysicalMaterial which parallax mapping to bump map in the material.
 * This is a port of Relief Parallax Mapping from [Rabbid76/graphics-snippets](https://github.com/Rabbid76/graphics-snippets/blob/master/html/technique/parallax_005_parallax_relief_mapping_derivative_tbn.html)
 * @category Plugins
 */
@uiFolderContainer('Parallax Bump Mapping (MatExt)')
export class ParallaxMappingPlugin extends AViewerPluginSync {
    public static PluginType = 'ReliefParallaxMapping'

    @onChange(ParallaxMappingPlugin.prototype._updateExtension)
    @serialize()
    @uiToggle('Enabled') enabled = true

    @uiSlider('Step count', [1, 32], 1)
    @onChange(ParallaxMappingPlugin.prototype._updateExtension)
    @serialize() stepCount = 12

    @uiSlider('Binary search steps', [1, 8], 1)
    @onChange(ParallaxMappingPlugin.prototype._updateExtension)
    @serialize() binaryStepCount = 3

    @onChange(ParallaxMappingPlugin.prototype._updateExtension)
    @uiToggle('Debug Normals') debugNormals = false
    @onChange(ParallaxMappingPlugin.prototype._updateExtension)
    @uiToggle('Debug Hit Height') debugHitHeight = false

    private _defines: any = {
        ['PARALLAX_NORMAL_MAP_QUALITY']: 0,
    }

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this._updateExtension = this._updateExtension.bind(this)
    }

    private _updateExtension() {
        this._bumpMapExtension?.setDirty?.()
        this._viewer?.setDirty()
    }
    private _bumpMapExtension: MaterialExtension = {
        shaderExtender: (shader, material, _renderer) => {
            if (!material.bumpMap || this.isDisabled()) return

            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '')
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '')

            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
                '#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <map_fragment>')

            for (const s of ['map_fragment', 'alphamap_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'emissivemap_fragment', 'transmission_fragment']) {
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, `#include <${s}>`,
                    (ShaderChunk as any)[s].replace(/\bv\w+Uv\b/g, 'parallaxUv.xy', {replaceAll: true})
                )
            }

            if (this.debugNormals || this.debugHitHeight)
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                    // .replace('texture2D( map, parallaxUv.xy )', 'texture2D( map, parallaxUv.xy )')
                    'texture2D( map, parallaxUv.xy )',
                    this.debugNormals ? 'vec4(normal, 1.); normal = nonPerturbedNormal' : 'vec4(parallaxUv.z,0., 0., 1.)')

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <normal_fragment_maps>',
                shaderReplaceString(
                    shaderReplaceString(
                        ShaderChunk.normal_fragment_maps,
                        '#elif defined( USE_NORMALMAP_TANGENTSPACE )', '#elif defined( USE_NORMALMAP_TANGENTSPACE ) && !defined( USE_BUMPMAP )'),
                    'normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );',
                    // 'diffuseColor.rgb = vec3(0, dHdxy_fwd());'
                    // 'diffuseColor.rgb = CalculateNormal(vUv).rgb;'
                    'vec3 parallaxUv = reliefParallaxPerturbNormal(faceDirection, normal);'
                )
            )
        },
        parsFragmentSnippet: ()=> {
            return this.isDisabled() ? '' : (ParallaxMappingPluginReliefShader + '\n')
                .replaceAll('PARALLAX_MAP_STEPS', this.stepCount.toString()) // replacing here to unroll for loop.
                .replaceAll('PARALLAX_MAP_B_STEPS', this.binaryStepCount.toString())
        },
        isCompatible: (material: PhysicalMaterial) => {
            return material.isPhysicalMaterial
        },
        computeCacheKey: material => {
            return '' + !this.isDisabled() + material.bumpMap?.uuid + this.debugNormals + this.debugHitHeight + this.stepCount.toString() + this.binaryStepCount.toString()
        },
        onObjectRender: (_object, material, _renderer) => {
            if (this.isDisabled()) return // todo: use extraDefines
            updateMaterialDefines({
                ...this._defines,
            }, material)
        },
    } as MaterialExtension

    onAdded(viewer: ThreeViewer) {
        viewer.materialManager.registerMaterialExtension(this._bumpMapExtension)
        return super.onAdded(viewer)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.materialManager.unregisterMaterialExtension(this._bumpMapExtension)
        return super.onRemove(viewer)
    }

}
