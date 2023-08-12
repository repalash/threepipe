import {
    CustomContextMenu,
    EXRExporter2,
    FloatType,
    generateUUID,
    getOrCall,
    HalfFloatType,
    imageBitmapToBase64,
    IRenderTarget,
    ITexture,
    LinearSRGBColorSpace,
    makeTextSvg,
    RepeatWrapping,
    SRGBColorSpace,
    Texture,
    textureToDataUrl,
    ThreeViewer,
    upgradeTexture,
    WebGLRenderTarget,
} from 'threepipe'
import type {UiObjectConfig} from 'uiconfig.js'
import {TweakpaneUiPlugin} from './TweakpaneUiPlugin'

const staticData = {
    placeholderVal: 'placeholder',
    renderTarImage: makeTextSvg('Render Target'),
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    textureMap: {} as any,
    imageMap: {} as any,
    tempMap: {} as any,
}

function proxyGetValue(cc: any, viewer: ThreeViewer) {
    if (cc?.get) cc = cc.get()
    let ret: any = undefined
    if (!cc) return staticData.placeholderVal
    if (cc.isCompressedTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.compressedTexImage
    }
    // todo: video is not playing
    // if (cc.isVideoTexture && !cc.image.tp_src) {
    //     cc.image.tp_src = dataTexImage
    // }
    if (cc.isTexture) {
        // console.warn('here')
        if (cc.image && !cc.image.tp_src) {
            if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement || cc.image instanceof HTMLVideoElement) {
                cc.image.tp_src = imageBitmapToBase64(cc.image, 160)
            } else if (cc.isRenderTargetTexture) {
                if (cc.__target) cc.image.tp_src = viewer.renderManager.renderTargetToDataUrl(cc.__target) // todo; update preview when renderTarget updates?
            } else {
                cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90) // this supports DataTexture also
            }

            if (!cc.image.tp_src) {
                if (cc.isRenderTargetTexture) cc.image.tp_src = staticData.renderTarImage
                else if (cc.isDataTexture) cc.image.tp_src = staticData.dataTexImage
            }
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
    if (v1 && v1.isTexture) {
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
        if (!staticData.textureMap[v1.image?.id]) staticData.textureMap[v1.image?.id] = v1
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
    if (cc === v || cc && (
        cc.image === v
        || cc.image?.src === v.src
        || cc.image?.tp_src === v.tp_src && v.tp_src != null
        || cc.image?.tp_src === v.src && v.src != null
        || cc.image?.src === v.tp_src && v.tp_src != null
    )) return

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
    } else if (v.isTexture) {
        setterTex(v, config, renderer)
    } else { // HTMLImageElement, ImageBitmap, HTMLVideoElement
        let tex: ITexture = staticData.textureMap[v.id] || staticData.textureMap[v.src] || staticData.textureMap[v.tp_src]
        if (tex) {
            setterTex(tex, config, renderer)
            return
        }
        tex = new Texture(v)
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

function downloadImage(config: UiObjectConfig, _: TweakpaneUiPlugin, viewer: ThreeViewer) {
    CustomContextMenu.Remove()
    const tex = config.__proxy.value_
    if (!tex) return
    let vcv = tex.image ?? config.uiRef.controller_.valueController.value.rawValue
    if (tex.__rootBlob && !tex.__rootBlob.objectUrl) tex.__rootBlob.objectUrl = URL.createObjectURL(tex.__rootBlob)
    let src = tex.__rootBlob ? tex.__rootBlob.objectUrl : tex.userData.rootPath || vcv?.src
    let revokeSrc = false

    // HTML image/video/bitmap
    if (vcv && (vcv instanceof ImageBitmap || vcv instanceof HTMLImageElement || vcv instanceof HTMLVideoElement) && !src)
        vcv = imageBitmapToBase64(vcv)

    let name = tex.__rootBlob ? tex.__rootBlob.name || 'image.' + (tex.__rootBlob.ext || 'png') : null

    // Render target texture
    if (!src && tex.isRenderTargetTexture) {
        const target1 = tex.__target as IRenderTarget
        if (target1.isWebGLRenderTarget) {
            const val = viewer.renderManager.exportRenderTarget(target1 as WebGLRenderTarget)
            if (!val) {
                console.error('cannot export render target', vcv, tex, target1, config)
                return
            }
            name = 'renderTarget.' + (val.ext || 'png')
            src = URL.createObjectURL(val)
            revokeSrc = true
        } else {
            console.error('Render target not supported', vcv, tex, target1, config)
            return
        }
    }
    // data texture
    if (!src && tex.isDataTexture) {
        if (tex.type !== HalfFloatType && tex.type !== FloatType) {
            console.error('Only Float and HalfFloat Data texture export is supported', vcv, tex, config)
            return
        }
        const buffer = new EXRExporter2().parse(undefined as any, tex)
        const val: Blob|undefined = new Blob([buffer], {type: 'image/x-exr'})
        if (!val) {
            console.error('cannot export data texture', vcv, tex, config)
            return
        }
        name = 'dataTexture.exr'
        src = URL.createObjectURL(val)
    }


    if (!src) {
        console.error('cannot export image', vcv, tex, config)
        return
    }

    const link = document.createElement('a')
    document.body.appendChild(link)
    link.style.display = 'none'
    link.href = src
    link.download = name || (src.startsWith('data:') ? 'image.png' : src.split('/').pop() ?? 'image.png')
    link.target = '_blank'
    link.click()
    if (revokeSrc) setTimeout(()=>{
        document.body.removeChild(link)
        URL.revokeObjectURL(src)
    }, 1000)
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

export const tpImageInputGenerator = (viewer: ThreeViewer) => (parent: any /* FolderApi */, config: UiObjectConfig, renderer: TweakpaneUiPlugin, params?: any) => {
    // if (config.value !== undefined) throw 'Not supported yet'

    if (!config.__proxy) {
        config.__proxy = {
            listedOnChange: false,
        }

        Object.defineProperty(config.__proxy, 'value', {
            get: () => {
                config.__proxy.value_ = renderer.methods.getValue(config)
                const ret = proxyGetValue(config.__proxy.value_, viewer)
                if (!staticData.textureMap[ret.id ?? ret]) staticData.textureMap[ret.id ?? ret] = config.__proxy.value_
                return ret
            },
            set: (v: any) => {
                if (getOrCall(config.readOnly)) return
                config.__proxy.value_ = renderer.methods.getValue(config) // current value
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
            ['download image']: () => downloadImage(config, renderer, viewer),
        }
        const readOnly = getOrCall(config.readOnly)
        if (!isPlaceholder && !readOnly) Object.assign(items, {
            ['remove image']: () => removeImage(config, renderer),
        })
        if (!readOnly) Object.assign(items, {
            ['set/replace image']: () => inp.click(),
            ['from url']: async() => imageFromUrl(renderer, config, viewer),
        })
        const menu = CustomContextMenu.Create({
            ...items,
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
