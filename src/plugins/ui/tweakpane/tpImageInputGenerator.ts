import {ThreeViewer} from '../../../viewer'
import type {FolderApi} from 'tweakpane'
import {UiObjectConfig} from 'uiconfig.js'
import {imageBitmapToBase64, makeTextSvg} from 'ts-browser-helpers'
import {generateUUID} from '../../../three'
import {ITexture, upgradeTexture} from '../../../core'
import {LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, Texture} from 'three'
import {CustomContextMenu} from '../../../utils'
import {TweakpaneUiPlugin} from './TweakpaneUiPlugin'

const staticData = {
    placeholderVal: 'placeholder',
    renderTarImage: makeTextSvg('Render Target'),
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    imageMap: {} as any,
    tempMap: {} as any,
}

function proxyGetValue(cc: any) {
    if (cc?.get) cc = cc.get()
    let ret: any = undefined
    if (!cc) return staticData.placeholderVal
    if (cc.isRenderTargetTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.renderTarImage
    }
    if (cc.isDataTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.dataTexImage
    }
    if (cc.isCompressedTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.compressedTexImage
    }
    // todo: video is not playing
    // if (cc.isVideoTexture && !cc.image.tp_src) {
    //     cc.image.tp_src = dataTexImage
    // }
    if (cc.isTexture) {
        // console.warn('here')
        if (cc.image && (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement || cc.image instanceof HTMLVideoElement) && !cc.image.tp_src) {
            cc.image.tp_src = imageBitmapToBase64(cc.image, 160)
        }
        if (cc.image) {
            ret = cc.image.tp_src_uuid
            ret = ret ? staticData.imageMap[ret] : undefined
            if (!ret) ret = cc.image.tp_src || cc.image.src
        }
    } else if (typeof cc === 'string') {
        ret = cc
    } else if (cc.domainMin) { // for lut CUBE files.
        ret = cc.texture
        if (cc.texture.image && !cc.texture.image.tp_src) {
            cc.texture.image.tp_src = staticData.lutCubeTexImage
        }
        if (cc.texture.image) {
            ret = cc.texture.image.tp_src_uuid
            ret = ret ? staticData.imageMap[ret] : undefined
            if (!ret) ret = cc.texture.image.tp_src || cc.texture.image.src
        }
    } else if (cc) {
        console.error('unknown value', cc)
    }
    if (!ret) ret = staticData.placeholderVal
    if (cc.image && !cc.image.tp_src_uuid) {
        const uuid = generateUUID()
        cc.image.tp_src_uuid = uuid
        staticData.tempMap[ret] = uuid
    }
    // console.log(ret, cc, tar, key)
    if (typeof ret === 'string')
        ret = staticData.imageMap[ret] ?? ret // Note: this will be a bottleneck if the length of src is too long.
    return ret
}

const setterTex = (v1: any, config: UiObjectConfig, renderer: TweakpaneUiPlugin)=>{
    if (v1?.isTexture) {
        if (!v1.isDataTexture) {
            const key = renderer.methods.getBinding(config)[1] + ''
            const isLinear = ['normalMap', 'aoMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'displacementMap', 'bumpMap', 'alphaMap'].includes(key)
            v1.colorSpace = isLinear ? LinearSRGBColorSpace : SRGBColorSpace
            v1.wrapS = RepeatWrapping
            v1.wrapT = RepeatWrapping
            v1.flipY = config.__proxy.value_?.flipY ?? true // todo: figure out flipY
        } else {
            v1.needsUpdate = true
        }
    }
    config.__proxy.value_ = v1
    renderer.methods.setValue(config, v1, {last: true}, false)
    config.uiRefresh?.(false, 'postFrame')
}

function proxySetValue(v: any, cc: any, config: UiObjectConfig, viewer: ThreeViewer, renderer: TweakpaneUiPlugin) {
    if (typeof v === 'string') {
        if (typeof cc === 'string') setterTex(v, config, renderer)
        return
    }
    v = v || staticData.placeholderVal
    if ((v as any).isPlaceholder || v === staticData.placeholderVal) {
        if (cc) setterTex(typeof cc === 'string' ? '' : null, config, renderer)
        return
    }
    let iMapKey = v.tp_src_uuid
    if (!iMapKey) {
        iMapKey = v.src ?? v.tp_src
        iMapKey = staticData.tempMap[iMapKey] ?? iMapKey
        delete staticData.tempMap[iMapKey]
        v.tp_src_uuid = iMapKey
    }
    if (iMapKey)
        staticData.imageMap[iMapKey] = v
    // todo: dispose textures if not used.
    if (typeof cc === 'string') {
        setterTex(iMapKey, config, renderer)
        return
    }
    if (cc?.image === v
        || cc?.image?.src === v.src
        || cc?.image?.tp_src === v.tp_src && v.tp_src != null
        || cc?.image?.tp_src === v.src && v.src != null
        || cc?.image?.src === v.tp_src && v.tp_src != null
    ) return

    if (v instanceof File) { // v.src must be from createObjectURL.
        viewer.assetManager.importer.importSingle<ITexture>({file: v, path: (v as any).src}).then(texture => {
            if (!texture) return
            if (texture.isDataTexture) texture.needsUpdate = true
            const ext = (v as any).src?.split('?')?.[0]?.split('.').pop()
            if ((texture as any).userData) {
                if (!(texture as any).userData.mimeType)
                    (texture as any).userData.mimeType = 'image/' + (['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png')
            }
            setterTex(texture, config, renderer)
        })
    } else { // HTMLImageElement, ImageBitmap, HTMLVideoElement
        const tex: ITexture = new Texture(v)
        upgradeTexture.call(tex)
        tex.assetType = 'texture'
        tex.needsUpdate = true
        // set userData.mimeType for GLTFExporter
        const ext = v.src?.split('?')?.[0]?.split('.').pop()
        if (!tex.userData.mimeType)
            tex.userData.mimeType = 'image/' + (['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png')
        setterTex(tex, config, renderer)
        // todo: make normal maps jpeg always? jpg is lossy
    }
}

function removeImage(config: UiObjectConfig, renderer: TweakpaneUiPlugin) {
    const vc = config.uiRef.controller_.valueController as any
    vc.value.setRawValue('')
    const isStr = typeof config.__proxy.value_ === 'string'
    setterTex(isStr ? '' : null, config, renderer)
}

function downloadImage(config: UiObjectConfig) {
    const cc = config.__proxy.value_
    let vcv = cc?.image ?? config.uiRef.controller_.valueController.value.rawValue
    if (vcv && (vcv instanceof ImageBitmap || vcv instanceof HTMLImageElement || vcv instanceof HTMLVideoElement) && !(vcv as any).src)
        vcv = imageBitmapToBase64(vcv)
    const link = document.createElement('a')
    document.body.appendChild(link)
    link.style.display = 'none'
    link.href = vcv?.src ?? vcv
    link.download = 'image.png'
    // link.target = '_blank'
    link.click()
    document.body.removeChild(link)
}

async function imageFromUrl(renderer: TweakpaneUiPlugin, config: UiObjectConfig, viewer: ThreeViewer) {
    // let url: string|null = navigator.clipboard ? await navigator.clipboard.readText() : ''
    let url: string | null = ''
    // if (!url || !url.startsWith('http') && !url.startsWith('data:image')) {
    //     url = ''
    // }
    url = await renderer.prompt('Load texture: Enter Image/Texture URL', url, true)
    if (!url || !url.startsWith('http') && !url.startsWith('data:image')) {
        if (url !== null) await renderer.alert('Loading Image: Invalid URL')
        return
    } else {
        url = url.trim()
    }
    const cc = config.__proxy.value_
    const isStr = typeof cc === 'string'
    if (isStr) {
        setterTex(url, config, renderer)
    } else { // texture
        viewer.assetManager.importer.importSingle<ITexture>(url).then(texture => {
            if (!texture) {
                console.warn('Failed to load texture', url)
                return
            }
            setterTex(texture, config, renderer)
        })
    }
}

export const tpImageInputGenerator = (viewer: ThreeViewer) => (parent: FolderApi, config: UiObjectConfig, renderer: TweakpaneUiPlugin, params?: any) => {
    // if (config.value !== undefined) throw 'Not supported yet'

    if (!config.__proxy) {
        config.__proxy = {
            listedOnChange: false,
        }

        Object.defineProperty(config.__proxy, 'value', {
            get: () => {
                config.__proxy.value_ = renderer.methods.getValue(config)
                return proxyGetValue(config.__proxy.value_)
            },
            set: (v: any) => {
                config.__proxy.value_ = renderer.methods.getValue(config)
                proxySetValue(v, config.__proxy.value_, config, viewer, renderer)
            },
        })
    }
    config.__proxy.value_ = renderer.methods.getValue(config)

    params = params ?? {}
    params.extensions = ['.jpg', '.png', '.svg', '.hdr',
        '.exr', /* '.mp4', '.ogg', '.mov',*/ '.jpeg',
        '.bmp', '.gif', '.webp', '.cube']
    if (typeof params.imageFit === 'undefined') params.imageFit = 'contain'
    if (typeof params.clickCallback === 'undefined') params.clickCallback = (ev: MouseEvent, inp: HTMLInputElement) => {
        const target = ev?.target as HTMLElement
        const rect = target?.getBoundingClientRect()
        if (!rect) {
            inp.click()
            return
        }
        const cv = config.uiRef.controller_.valueController.value.rawValue
        const isPlaceholder = cv === staticData.placeholderVal || cv?.isPlaceholder
        const items: any = isPlaceholder ? {} : {
            ['remove image']: () => removeImage(config, renderer),
            ['download image']: () => downloadImage(config),
        }
        const menu = CustomContextMenu.Create({
            ...items,
            ['set/replace image']: () => inp.click(),
            ['from url']: async() => imageFromUrl(renderer, config, viewer),
            'cancel': () => {return},
        }, 2, rect.height + 8, false, true)
        target.parentElement?.appendChild(menu)
        if (rect.y > document.body.clientHeight * 0.7) {
            menu.style.top = 'auto'
            menu.style.bottom = rect.height + 8 + 'px'
        }
    }
    params.view = 'input-image'
    return renderer.typeGenerators.input(parent, config, renderer, params)
}
