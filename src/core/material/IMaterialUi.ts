import {IMaterial} from '../IMaterial'
import {UiObjectConfig} from 'uiconfig.js'
import {makeSamplerUi} from '../../ui/image-ui'
import {
    AdditiveBlending,
    AlwaysDepth,
    BackSide,
    Blending,
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
    Side,
    SubtractiveBlending,
    TangentSpaceNormalMap,
} from 'three'
import {downloadBlob, uploadFile} from 'ts-browser-helpers'
import {PhysicalMaterial} from './PhysicalMaterial'
import {getEmptyMeta} from '../../utils/serialization'

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
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev}),
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
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev}),
                },
                {
                    type: 'checkbox',
                    property: [material, 'depthWrite'],
                    onChange: (ev)=>material.setDirty({uiChangeEvent: ev}),
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'alphaTest'],
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
                    ] as [string, Blending][]).map(value => ({
                        label: value[0],
                        value: value[1],
                    })),
                },
                {
                    type: 'image',
                    property: [material, 'alphaMap'],
                },
                makeSamplerUi(material, 'alphaMap'),
                {
                    type: 'checkbox',
                    label: 'Render to Gbuffer',
                    // hidden: ()=>!material.transparent && material.transmission < 0.001,
                    getValue: ()=>material.userData.renderToGBuffer === true,
                    setValue: (v: boolean)=>{
                        material.userData.renderToGBuffer = v ? v : undefined
                        material.setDirty()
                    },
                },
                material.isPhysicalMaterial ? {
                    type: 'checkbox',
                    label: 'Inverse AlphaMap',
                    hidden: ()=>!material.transparent,
                    getValue: ()=>material.userData.inverseAlphaMap === true,
                    setValue: (v: boolean)=>{
                        material.userData.inverseAlphaMap = v ? v : undefined
                        material.setDirty()
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
    misc: (material: IMaterial): UiObjectConfig[] => [
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
            value: ()=>{
                uploadFile(false, false, material.constructor.TypeSlug).then(async(files)=>files?.[0]?.text()).then((text)=>{
                    if (!text) return
                    const json = JSON.parse(text)
                    if (json.uuid) delete json.uuid // just copy the material properties
                    material.fromJSON(json, getEmptyMeta())
                })
            },
        },
        ()=>material.materialExtensions?.map(v=>v.getUiConfig?.(material, material.uiConfig?.uiRefresh)).filter(v=>v),
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
    bumpNormal: (material: PhysicalMaterial): UiObjectConfig => (
        {
            type: 'folder',
            label: 'Bump/Normal',
            children: [
                {
                    type: 'slider',
                    bounds: [0, 0.2],
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
    emission: (material: PhysicalMaterial): UiObjectConfig => (
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
                    bounds: [0, 10],
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
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'reflectivity'],
                },
                {
                    type: 'slider',
                    bounds: [0, 1],
                    property: [material, 'transmission'],
                    limitedUi: true,
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
