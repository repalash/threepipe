import {IMaterial} from '../core'
import {
    ClampToEdgeWrapping,
    ColorSpace,
    LinearFilter,
    LinearMipmapLinearFilter,
    LinearMipmapNearestFilter,
    LinearSRGBColorSpace,
    MagnificationTextureFilter,
    MinificationTextureFilter,
    MirroredRepeatWrapping,
    NearestFilter,
    NearestMipmapLinearFilter,
    NearestMipmapNearestFilter,
    RepeatWrapping,
    SRGBColorSpace,
    Wrapping,
} from 'three'
import {UiObjectConfig} from 'uiconfig.js'

export function makeSamplerUi<T extends IMaterial>(mat: T, map: keyof T, label?: string, hidden?: ()=>boolean, setDirty?: ()=>any) {
    setDirty = setDirty ?? (()=>mat.setDirty && mat.setDirty())
    // const im = map === 'map'
    return {
        type: 'folder',
        label: label ?? <string>map + ' Sampler',
        hidden: ()=>!mat[map] || hidden && hidden(),
        onChange: setDirty,
        children: [
            ()=>({
                type: 'vec2',
                label: 'Repeat',
                stepSize: 0.001,
                property: [mat[map], 'repeat'],
            }),
            ()=>({
                type: 'vec2',
                label: 'Offset',
                stepSize: 0.001,
                property: [mat[map], 'offset'],
            }),
            ()=>({
                type: 'vec2',
                label: 'Center',
                stepSize: 0.001,
                property: [mat[map], 'center'],
            }),
            ()=>({
                type: 'input',
                label: 'Rotation',
                stepSize: 0.001,
                bounds: [-Math.PI, Math.PI],
                property: [mat[map], 'rotation'],
            }),
            ()=>({
                type: 'dropdown',
                label: 'Color space',
                property: [mat[map], 'colorSpace'],
                children: ([
                    ['Linear', LinearSRGBColorSpace],
                    ['sRGB', SRGBColorSpace],
                    // ['RGBM', RGBM16ColorSpace],
                ] as [string, ColorSpace][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
                onChange: [()=>{
                    const tex = mat[map] as any
                    if (!tex) return
                    tex.needsUpdate = true
                    // todo: set the texture on other materials with the same texture
                    // mat[map] = tex.clone() // it doesn't work with just setting needsUpdate = true
                    // ;(mat[map] as any).uuid = tex.uuid
                    // tex!.dispose()
                }],
            }),
            ()=>({
                type: 'dropdown',
                label: 'UV Channel',
                property: [mat[map], 'channel'],
                children: [0, 1, 2, 3].map(value => ({label: value.toString(), value})),
                onChange: ()=>{
                    const tex = mat[map] as any
                    if (tex) tex.needsUpdate = true
                },
            }),
            ()=>({
                type: 'checkbox',
                label: 'Flip Y',
                getValue: ()=>(mat[map] as any)?.flipY ?? false,
                setValue: (value: boolean)=>{
                    const tex = mat[map] as any
                    if (!tex)
                        return
                    if (tex.flipY === value) return

                    // console.log(tex, value, mat)

                    // https://github.com/mrdoob/three.js/issues/16144
                    // flipY not used in ImageBitmap during upload texture, it needs to be created again.
                    // todo: check premultiplied alpha also.
                    if (tex.image && ImageBitmap && tex.image instanceof ImageBitmap) {
                        const t1 = tex
                        const oldBitmap = tex.source.data as ImageBitmap

                        createImageBitmap(oldBitmap, {
                            imageOrientation: 'flipY',
                        }).then((imageBitmap)=>{

                            if (oldBitmap.close) oldBitmap.close()
                            t1.flipY = value
                            t1.source.data = imageBitmap
                            t1.source.needsUpdate = true
                            t1.needsUpdate = true
                            setDirty()
                        })
                    } else {
                        tex.flipY = value
                        tex.needsUpdate = true
                        setDirty()
                    }

                },
            }),
            ()=>({
                type: 'dropdown',
                label: 'Wrap S',
                property: [mat[map], 'wrapS'],
                children: ([
                    ['ClampToEdge', ClampToEdgeWrapping],
                    ['MirroredRepeat', MirroredRepeatWrapping],
                    ['Repeat', RepeatWrapping],
                ] as [string, Wrapping][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
                onChange: [()=>{if (mat[map])(mat[map] as any)!.needsUpdate = true}],
            }),
            ()=>({
                type: 'dropdown',
                label: 'Wrap T',
                property: [mat[map], 'wrapT'],
                children: ([
                    ['ClampToEdge', ClampToEdgeWrapping],
                    ['MirroredRepeat', MirroredRepeatWrapping],
                    ['Repeat', RepeatWrapping],
                ] as [string, Wrapping][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
                onChange: [()=>{if (mat[map])(mat[map] as any)!.needsUpdate = true}],
            }),
            ()=>({
                type: 'input',
                label: 'Anisotropy',
                bounds: [1, 6],
                stepSize: 1,
                property: [mat[map], 'anisotropy'],
                onChange: [()=>{if (mat[map])(mat[map] as any)!.needsUpdate = true; mat.needsUpdate = true}],
            }),
            ()=>({
                type: 'dropdown',
                label: 'Min Filter',
                property: [mat[map], 'minFilter'],
                children: ([
                    ['Linear', LinearFilter],
                    ['Nearest', NearestFilter],
                    ['NearestMipmapNearest', NearestMipmapNearestFilter],
                    ['NearestMipmapLinear', NearestMipmapLinearFilter],
                    ['LinearMipmapNearest', LinearMipmapNearestFilter],
                    ['LinearMipmapLinear', LinearMipmapLinearFilter],
                ] as [string, MinificationTextureFilter][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
                onChange: [()=>{if (mat[map])(mat[map] as any)!.needsUpdate = true}],
            }),
            ()=>({
                type: 'dropdown',
                label: 'Mag Filter',
                property: [mat[map], 'magFilter'],
                children: ([
                    ['Linear', LinearFilter],
                    ['Nearest', NearestFilter],
                ] as [string, MagnificationTextureFilter][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
                onChange: [()=>{if (mat[map])(mat[map] as any)!.needsUpdate = true}],
            }),

        ],
    } as UiObjectConfig
}
