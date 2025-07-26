import {IMaterial} from '../IMaterial'
import {UiObjectConfig} from 'uiconfig.js'
import {makeSamplerUi} from '../../ui/image-ui'
import {
    AdditiveBlending,
    AlwaysDepth,
    BackSide,
    Blending, CustomBlending,
    DepthModes,
    DoubleSide,
    EqualDepth,
    FrontSide,
    GreaterDepth,
    GreaterEqualDepth,
    LessDepth,
    LessEqualDepth,
    MultiplyBlending,
    NeverDepth,
    NoBlending,
    NormalBlending,
    NormalMapTypes,
    NotEqualDepth,
    ObjectSpaceNormalMap,
    OneFactor,
    OneMinusDstAlphaFactor,
    OneMinusDstColorFactor,
    OneMinusSrcAlphaFactor,
    OneMinusSrcColorFactor,
    Side,
    SrcAlphaFactor,
    SrcAlphaSaturateFactor,
    SrcColorFactor,
    SubtractiveBlending,
    TangentSpaceNormalMap,
    ZeroFactor,
    BlendingEquation,
    BlendingSrcFactor,
    MinEquation,
    ConstantAlphaFactor, ConstantColorFactor, OneMinusConstantAlphaFactor, OneMinusConstantColorFactor,
    ReverseSubtractEquation,
    SubtractEquation, AddEquation, MaxEquation, DstAlphaFactor, DstColorFactor,
} from 'three'
import {downloadBlob, uploadFile} from 'ts-browser-helpers'
import {PhysicalMaterial} from './PhysicalMaterial'
import {getEmptyMeta} from '../../utils'
import {LegacyPhongMaterial} from './LegacyPhongMaterial'
import {generateUUID} from '../../three/utils'

declare module '../IMaterial' {
    interface IMaterial {
        __matExtUiConfigs?: Record<string, UiObjectConfig|undefined>
    }
}

export const iMaterialUI = {
    base: (material: IMaterial): UiObjectConfig[] => [
        {
            type: 'input',
            property: [material, 'name'],
        },
        // {
        //     type: 'monitor',
        //     property: [material, 'uuid'],
        // },
        {
            type: 'checkbox',
            property: [material, 'wireframe'],
        },
        {
            type: 'checkbox',
            property: [material, 'vertexColors'],
        },
        {
            type: 'color',
            property: [material, 'color'],
        },
        material.flatShading !== undefined ? {
            type: 'checkbox',
            property: [material, 'flatShading'],
        } : {},
        {
            type: 'image',
            property: [material, 'map'],
        },
        makeSamplerUi(material, 'map'),
    ],
    blending: (material: IMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Blending',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'opacity'],
                },
                {
                    type: 'checkbox',
                    property: [material, 'transparent'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'transparent'}),
                },
                {
                    type: 'dropdown',
                    property: [material, 'depthFunc'],
                    children: ([
                        ['Never', NeverDepth],
                        ['Always', AlwaysDepth],
                        ['Less', LessDepth],
                        ['LessEqual', LessEqualDepth],
                        ['Equal', EqualDepth],
                        ['GreaterEqual', GreaterEqualDepth],
                        ['Greater', GreaterDepth],
                        ['NotEqual', NotEqualDepth],
                    ] as [string, DepthModes][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'checkbox',
                    property: [material, 'depthTest'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'depthTest'}),
                },
                {
                    type: 'checkbox',
                    property: [material, 'depthWrite'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'depthWrite'}),
                },
                {
                    type: 'checkbox',
                    property: [material, 'colorWrite'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'colorWrite'}),
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    stepSize: 0.001,
                    property: [material, 'alphaTest'],
                },
                {
                    type: 'checkbox',
                    property: [material, 'alphaHash'],
                },
                {
                    type: 'checkbox',
                    property: [material, 'dithering'],
                },
                {
                    type: 'dropdown',
                    label: 'Blending',
                    property: [material, 'blending'],
                    children: ([
                        ['None', NoBlending],
                        ['Normal', NormalBlending],
                        ['Additive', AdditiveBlending],
                        ['Subtractive', SubtractiveBlending],
                        ['Multiply', MultiplyBlending],
                        ['Custom', CustomBlending],
                    ] as [string, Blending][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'dropdown',
                    hidden: ()=>material.blending !== CustomBlending,
                    property: [material, 'blendingEquation'],
                    children: ([
                        ['Add', AddEquation],
                        ['Subtract', SubtractEquation],
                        ['Reverse Subtract', ReverseSubtractEquation],
                        ['Min', MinEquation],
                        ['Max', MaxEquation],
                    ] as [string, BlendingEquation][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'dropdown',
                    property: [material, 'blendSrc'],
                    hidden: ()=>material.blending !== CustomBlending,
                    children: ([
                        ['Zero', ZeroFactor],
                        ['One', OneFactor],
                        ['Src Color', SrcColorFactor],
                        ['One Minus Src Color', OneMinusSrcColorFactor],
                        ['Src Alpha', SrcAlphaFactor],
                        ['One Minus Src Alpha', OneMinusSrcAlphaFactor],
                        ['Dst Alpha', DstAlphaFactor],
                        ['One Minus Dst Alpha', OneMinusDstAlphaFactor],
                        ['Dst Color', DstColorFactor],
                        ['One Minus Dst Color', OneMinusDstColorFactor],
                        ['Src Alpha Saturate', SrcAlphaSaturateFactor],
                        ['Constant Color', ConstantColorFactor],
                        ['One Minus Constant Color', OneMinusConstantColorFactor],
                        ['Constant Alpha', ConstantAlphaFactor],
                        ['One Minus Constant Alpha', OneMinusConstantAlphaFactor],
                    ] as [string, BlendingSrcFactor][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'dropdown',
                    property: [material, 'blendDst'],
                    hidden: ()=>material.blending !== CustomBlending,
                    children: ([
                        ['Zero', ZeroFactor],
                        ['One', OneFactor],
                        ['Src Color', SrcColorFactor],
                        ['One Minus Src Color', OneMinusSrcColorFactor],
                        ['Src Alpha', SrcAlphaFactor],
                        ['One Minus Src Alpha', OneMinusSrcAlphaFactor],
                        ['Dst Alpha', DstAlphaFactor],
                        ['One Minus Dst Alpha', OneMinusDstAlphaFactor],
                        ['Dst Color', DstColorFactor],
                        ['One Minus Dst Color', OneMinusDstColorFactor],
                        // ['Src Alpha Saturate', SrcAlphaSaturateFactor],
                        ['Constant Color', ConstantColorFactor],
                        ['One Minus Constant Color', OneMinusConstantColorFactor],
                        ['Constant Alpha', ConstantAlphaFactor],
                        ['One Minus Constant Alpha', OneMinusConstantAlphaFactor],
                    ] as [string, BlendingSrcFactor][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    hidden: ()=>material.blending !== CustomBlending,
                    property: [material, 'blendSrcAlpha'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    hidden: ()=>material.blending !== CustomBlending,
                    property: [material, 'blendDstAlpha'],
                },
                {
                    type: 'color',
                    hidden: ()=>material.blending !== CustomBlending ||
                        material.blendSrc !== ConstantColorFactor &&
                        material.blendSrc !== OneMinusConstantColorFactor &&
                        material.blendDst !== ConstantColorFactor &&
                        material.blendDst !== OneMinusConstantColorFactor,
                    property: [material, 'blendColor'],
                },
                {
                    type: 'slider',
                    hidden: ()=>material.blending !== CustomBlending ||
                        material.blendSrc !== ConstantAlphaFactor &&
                        material.blendSrc !== OneMinusConstantAlphaFactor &&
                        material.blendDst !== ConstantAlphaFactor &&
                        material.blendDst !== OneMinusConstantAlphaFactor,
                    bounds: [0, 1],
                    property: [material, 'blendAlpha'],
                },
                material.alphaMap !== undefined ? {
                    type: 'image',
                    property: [material, 'alphaMap'],
                } : {},
                material.alphaMap !== undefined ? makeSamplerUi(material, 'alphaMap') : {},
                {
                    type: 'checkbox',
                    label: 'Render to Gbuffer',
                    // hidden: ()=>!material.transparent && material.transmission < 0.001,
                    getValue: ()=>material.userData.renderToGBuffer === true,
                    setValue: (v: boolean)=>{
                        if (!v && material.userData.renderToGBuffer === false) return
                        material.userData.renderToGBuffer = v
                        material.setDirty({change: 'userData', key: 'renderToGBuffer'})
                    },
                },
                {
                    type: 'checkbox',
                    label: 'Render to Depth',
                    hidden: ()=>material.userData.renderToDepth === undefined,
                    getValue: ()=>material.userData.renderToDepth === true,
                    setValue: (v: boolean)=>{
                        if (!v && material.userData.renderToDepth === false) return
                        material.userData.renderToDepth = v
                        material.setDirty({change: 'userData', key: 'renderToDepth'})
                    },
                },
                material.isPhysicalMaterial ? {
                    type: 'checkbox',
                    label: 'Inverse AlphaMap',
                    hidden: ()=>!material.transparent,
                    getValue: ()=>material.userData.inverseAlphaMap === true,
                    setValue: (v: boolean)=>{
                        material.userData.inverseAlphaMap = v ? v : undefined
                        material.setDirty({change: 'userData', key: 'inverseAlphaMap'})
                    },
                } : {},
            ],
        }
    ),
    polygonOffset: (material: IMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Polygon Offset',
            children: [
                {
                    type: 'checkbox',
                    label: 'Polygon Offset',
                    property: [material, 'polygonOffset'],
                },
                {
                    type: 'slider',
                    label: 'Polygon Offset Factor',
                    bounds: [-10, 10],
                    property: [material, 'polygonOffsetFactor'],
                },
                {
                    type: 'slider',
                    label: 'Polygon Offset Units',
                    bounds: [-10, 10],
                    property: [material, 'polygonOffsetUnits'],
                },
            ],
        }
    ),
    aoLightMap: (material: IMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'AO/Lightmap',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 2],
                    property: [material, 'aoMapIntensity'],
                },
                {
                    type: 'image',
                    property: [material, 'aoMap'],
                },
                makeSamplerUi(material, 'aoMap'),
                {
                    type: 'slider',
                    bounds: [0, 2],
                    property: [material, 'lightMapIntensity'],
                },
                {
                    type: 'image',
                    property: [material, 'lightMap'],
                },
                makeSamplerUi(material, 'lightMap'),
            ],
        }
    ),
    environment: (material: IMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Environment',
            children: [
                {
                    type: 'checkbox',
                    label: 'Override Environment',
                    // property: [material.userData, 'separateEnvMapIntensity'],
                    getValue: ()=>material.userData.separateEnvMapIntensity === true,
                    setValue: (v: boolean)=>{
                        material.userData.separateEnvMapIntensity = v
                        if (!v) delete material.userData.separateEnvMapIntensity
                    },
                    // onChange: material.setDirty,
                },
                {
                    type: 'slider',
                    bounds: [0, 20],
                    hidden: ()=>!material.userData.separateEnvMapIntensity,
                    label: 'Environment Intensity',
                    property: [material, 'envMapIntensity'],
                },
                {
                    type: 'dropdown',
                    hidden: ()=>!material.userData.separateEnvMapIntensity && !material.userData.envMapSlotKey,
                    label: 'Environment Map',
                    children: ['', 'environment1', 'environment2'].map((i)=>({label: i || 'default', value: i})),
                    getValue: ()=>material.userData.envMapSlotKey || '',
                    setValue: (v: string)=>{
                        material.userData.envMapSlotKey = v
                        if (!v) delete material.userData.envMapSlotKey
                        material.setDirty({change: 'userData', key: 'envMapSlotKey'})
                    },
                },
            ],
        }
    ),
    misc: (material: IMaterial): UiObjectConfig[] => [
        ()=>material.materialExtensions?.map(v=>{
            v.uuid = v.uuid || generateUUID()
            // caching the uiconfig here. todo: reset the uiconfig when cache key changes? or we could just return a dynamic/function uiconfig from getUiConfig
            material.__matExtUiConfigs = material.__matExtUiConfigs || {}
            if (!material.__matExtUiConfigs[v.uuid]) material.__matExtUiConfigs[v.uuid] = v.getUiConfig?.(material, material.uiConfig?.uiRefresh)
            return material.__matExtUiConfigs[v.uuid]
        }).filter(v=>v),
        {
            type: 'dropdown',
            label: 'Side',
            property: [material, 'side'],
            children: ([
                ['Front', FrontSide],
                ['Back', BackSide],
                ['Double', DoubleSide],
            ] as [string, Side][]).map(value => ({
                label: value[0],
                value: value[1],
            })),
        },
        {
            type: 'input',
            label: 'Mesh count',
            getValue: ()=>material.appliedMeshes.size || 0,
            disabled: true,
        },
        {
            type: 'button',
            label: `Download ${material.constructor.TypeSlug}`,
            value: ()=>{
                const blob = new Blob([JSON.stringify(material.toJSON(), null, 2)], {type: 'application/json'})
                downloadBlob(blob, `material.${material.constructor.TypeSlug}`)
            },
        },
        {
            type: 'button',
            label: `Select ${material.constructor.TypeSlug}`,
            value: async()=>uploadFile(false, false, material.constructor.TypeSlug).then(async(files)=>files?.[0]?.text()).then((text)=>{
                if (!text) return
                const json = JSON.parse(text)
                if (json.uuid) delete json.uuid // just copy the material properties
                const currentJson = material.toJSON()
                material.fromJSON(json, getEmptyMeta())
                return {
                    undo: ()=>material.fromJSON(currentJson, getEmptyMeta()),
                    redo: ()=>material.fromJSON(json, getEmptyMeta()),
                }
            }),
        },
    ],
    roughMetal: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Rough/Metal',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'roughness'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'metalness'],
                },
                {
                    type: 'image',
                    property: [material, 'roughnessMap'],
                },
                makeSamplerUi(material, 'roughnessMap'),
                {
                    type: 'image',
                    property: [material, 'metalnessMap'],
                },
                makeSamplerUi(material, 'metalnessMap'),
            ],
        }
    ),
    bumpNormal: (material: PhysicalMaterial|LegacyPhongMaterial): UiObjectConfig => (
        {
            type: 'folder',
            // uuid: 'bump_normal',
            label: 'Bump/Normal',
            children: [
                {
                    type: 'slider',
                    bounds: [-500, 500],
                    stepSize: 0.001,
                    property: [material, 'bumpScale'],
                    hidden: ()=>!material.bumpMap,
                },
                {
                    type: 'image',
                    property: [material, 'bumpMap'],
                },
                makeSamplerUi(material, 'bumpMap'),
                {
                    type: 'image',
                    property: [material, 'normalMap'],
                },
                {
                    type: 'vec2',
                    property: [material, 'normalScale'],
                    hidden: ()=>!material.normalMap,
                },
                {
                    type: 'dropdown',
                    hidden: ()=>!material.normalMap,
                    property: [material, 'normalMapType'],
                    children: ([
                        ['TangentSpace', TangentSpaceNormalMap],
                        ['ObjectSpace', ObjectSpaceNormalMap],
                    ] as [string, NormalMapTypes][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                makeSamplerUi(material, 'normalMap'),
                {
                    type: 'input',
                    property: [material, 'displacementScale'],
                    hidden: ()=>!material.displacementMap,
                },
                {
                    type: 'image',
                    property: [material, 'displacementMap'],
                },
                makeSamplerUi(material, 'displacementMap'),
            ],
        }
    ),
    emission: (material: PhysicalMaterial|LegacyPhongMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Emission',
            children: [
                {
                    type: 'color',
                    property: [material, 'emissive'],
                },
                {
                    type: 'slider',
                    bounds: [0, 100],
                    property: [material, 'emissiveIntensity'],
                },
                {
                    type: 'image',
                    property: [material, 'emissiveMap'],
                },
                makeSamplerUi(material, 'emissiveMap'),
            ],
        }
    ),
    transmission: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Refraction',
            children: [
                // {
                //     type: 'slider',
                //     bounds: [0, 1],
                //     property: [material, 'reflectivity'],
                // },
                {
                    type: 'slider',
                    bounds: [0, 4],
                    property: [material, 'ior'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'transmission'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    stepSize: 0.001,
                    property: [material, 'thickness'],
                },
                {
                    type: 'image',
                    property: [material, 'transmissionMap'],
                },
                makeSamplerUi(material, 'transmissionMap'),
                {
                    type: 'image',
                    property: [material, 'thicknessMap'],
                },
                makeSamplerUi(material, 'thicknessMap'),
                {
                    type: 'number',
                    property: [material, 'attenuationDistance'],
                },
                {
                    type: 'color',
                    property: [material, 'attenuationColor'],
                },
            ],
        }
    ),
    clearcoat: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Clearcoat',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'clearcoat'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    hidden: ()=>material.clearcoat < 0.001,
                    property: [material, 'clearcoatRoughness'],
                },
                {
                    type: 'image',
                    property: [material, 'clearcoatMap'],
                },
                makeSamplerUi(material, 'clearcoatMap'),
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'clearcoatRoughness'],
                },
                {
                    type: 'image',
                    property: [material, 'clearcoatRoughnessMap'],
                },
                makeSamplerUi(material, 'clearcoatRoughnessMap'),
                {
                    type: 'image',
                    property: [material, 'clearcoatNormalMap'],
                },
                {
                    type: 'vec2',
                    property: [material, 'clearcoatNormalScale'],
                    hidden: ()=>!material.clearcoatNormalMap,
                },
                makeSamplerUi(material, 'clearcoatNormalMap'),
            ],
        }
    ),
    iridescence: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Iridescence',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 3],
                    label: 'Intensity',
                    property: [material, 'iridescence'],
                },
                {
                    type: 'slider',
                    bounds: [0, 3],
                    label: 'IOR',
                    property: [material, 'iridescenceIOR'],
                },
                {
                    type: 'slider',
                    bounds: [0, 500],
                    label: 'Thickness0',
                    property: [material.iridescenceThicknessRange, '0'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'iridescenceThicknessRange', key: '0'}),
                },
                {
                    type: 'slider',
                    bounds: [0, 500],
                    label: 'Thickness1',
                    property: [material.iridescenceThicknessRange, '1'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev, change: 'iridescenceThicknessRange', key: '1'}),
                },
                {
                    type: 'image',
                    property: [material, 'iridescenceMap'],
                },
                makeSamplerUi(material, 'iridescenceMap'),
                {
                    type: 'image',
                    property: [material, 'iridescenceThicknessMap'],
                },
                makeSamplerUi(material, 'iridescenceThicknessMap'),
            ],
        }
    ),
    sheen: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Sheen',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'sheen'],
                },
                {
                    type: 'color',
                    hidden: ()=>material.sheen < 0.001,
                    property: [material, 'sheenColor'],
                },
                {
                    type: 'image',
                    property: [material, 'sheenColorMap'],
                },
                makeSamplerUi(material, 'sheenColorMap'),
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'sheenRoughness'],
                },
                {
                    type: 'image',
                    property: [material, 'sheenRoughnessMap'],
                },
                makeSamplerUi(material, 'sheenRoughnessMap'),
            ],
        }
    ),
}
