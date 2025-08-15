import {
    CustomContextMenu,
    DataTexture,
    EXRExporter2,
    FloatType,
    generateUUID,
    getOrCall,
    HalfFloatType,
    imageBitmapToBase64,
    ImportResultExtras,
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
    SVGTextureLoader,
    uploadFile,
} from 'threepipe'
import type {UiObjectConfig} from 'uiconfig.js'
import {TweakpaneUiPlugin} from './TweakpaneUiPlugin'

export const makeTextSvg2 = (text: string): string => {
    return `data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 30 30' xmlns='http://www.w3.org/2000/svg'%3E%3Ctext style='font: 8px "Roboto Mono", "Source Code Pro", Menlo, Courier, monospace; fill: white;' x='9' y='18'%3E${text}%3C/text%3E%3C/svg%3E%0A`
}

const staticData = {
    placeholderVal: 'placeholder',
    // renderTarImage: makeColorSvg('ffffff'),
    renderTarImage: makeTextSvg('Render Target'),
    renderTarImage2: makeTextSvg2('...'),
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    // videoTexImage: makeTextSvg('Video Texture'),
    textureMap: {} as any,
    imageMap: {} as any,
    tempMap: {} as any,
}

const allowedImageExtensions = ['.jpg', '.png', '.svg', '.hdr', '.ktx2',
    '.exr', '.mp4', '.ogg', '.mov', '.webm', '.jpeg',
    '.bmp', '.gif', '.webp', '.cube', '.ktx2', '.avif', '.ico', '.tiff'] // todo update blueprint editor with this list

function proxyGetValue(cc: any, viewer: ThreeViewer, config: UiObjectConfig) {
    if (cc?.get) cc = cc.get()
    let ret = staticData.placeholderVal
    if (!cc) return ret
    if (cc.isCompressedTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.compressedTexImage
    }
    // todo: video is not playing, handled below
    // if (cc.isVideoTexture && !cc.image.tp_src) {
    //     cc.image.tp_src = staticData.videoTexImage
    // }
    if (cc.isTexture) {
        // console.warn('here')
        // todo: use textureToCanvas for data texture
        if (cc.image && !cc.image.tp_src && !cc.tp_src) {
            if (cc.isRenderTargetTexture) {
                if (cc._target) {
                    // doing in the timeout so it doesnt hang when opening a folder which does deep refresh
                    // if (!config._lastRtRefresh || Date.now() - config._lastRtRefresh > 5000) { // 5000 should be significantly more than 500 + 100 below
                    setTimeout(() => {
                        if (!cc._target) return
                        // here we are not doing cc.image.tp_src because cc.image can be shared across multiple textures in MRT
                        const dataUrl = viewer.renderManager.renderTargetToDataUrl(cc._target, undefined, undefined, Array.isArray(cc._target.texture) ? cc._target.texture.indexOf(cc) : undefined)
                        cc.tp_src = dataUrl
                        setTimeout(()=>cc.tp_src && delete cc.tp_src, 1000) // clear after 1 second so it refreshes on next render
                        config.uiRefresh?.(false, 'postFrame')
                    }, 200)
                    cc.tp_src = staticData.renderTarImage2
                    // }
                    // config._lastRtRefresh = Date.now()
                }
            } else if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement /* || cc.image instanceof HTMLVideoElement*/) { // todo: try video with bitmap after ts-browser-helpers update
                cc.image.tp_src = imageBitmapToBase64(cc.image, 160)
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            } else {
                cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90) // this supports DataTexture also
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            }

            if (!cc.image.tp_src && !cc.tp_src) {
                if (cc.isRenderTargetTexture) cc.image.tp_src = staticData.renderTarImage
                else if (cc.isDataTexture) cc.image.tp_src = staticData.dataTexImage
            }
        }
        if (cc.image) {
            const uid = cc.image.tp_src_uuid as string
            ret = uid ? staticData.imageMap[uid] : undefined
            if (!ret) ret = cc.image.tp_src || cc.image.src
        }
        if (cc.tp_src) ret = cc.tp_src
    } else if (typeof cc === 'string') {
        ret = cc
    } else if (cc.domainMin) { // for lut CUBE files.
        // ret = cc.texture
        const image = cc.texture.image
        if (image) {
            // todo this will always show placeholder, we need to snapshot data texture
            if (!image.tp_src) {
                image.tp_src = staticData.lutCubeTexImage
            }
            const uid = image.tp_src_uuid as string
            ret = uid ? staticData.imageMap[uid] : undefined
            if (!ret) ret = image.tp_src || image.src
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
        if (v1.image) {
            if (!v1.image.id?.length) v1.image.id = generateUUID()
            if (!staticData.textureMap[v1.image.id]) staticData.textureMap[v1.image.id] = v1
        }
    }
    config.__proxy.value_ = v1
    renderer.methods.setValue(config, v1, {last: true}, false, true)
    config.uiRefresh?.(false, 'postFrame')
}

function setterFile(viewer: ThreeViewer, file: File, path: string | undefined, config: UiObjectConfig, renderer: TweakpaneUiPlugin) {
    path = path || file.webkitRelativePath || file.name
    viewer.assetManager.importer.importSingle<ITexture>({file, path: path}).then(texture => {
        if (!texture) {
            console.warn('Failed to load texture', file)
            return
        }
        const ext = path?.split('?')?.[0]?.split('.').pop() ?? ''
        if ((texture as any).userData) { // todo why is this required?
            if (!(texture as any).userData.mimeType)
                (texture as any).userData.mimeType = 'image/' + (['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png')
        }
        setterTex(texture, config, renderer)
    })
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
        setterFile(viewer, v, (v as any).src, config, renderer)
    } else if (v.isTexture) {
        setterTex(v, config, renderer)
    } else { // HTMLImageElement, ImageBitmap, HTMLVideoElement
        let tex: ITexture = staticData.textureMap[v.id] || staticData.textureMap[v.src] || staticData.textureMap[v.tp_src]
        if (tex) {
            setterTex(tex, config, renderer)
            return
        }

        if (SVGTextureLoader.USE_CANVAS_TEXTURE && (v.src?.endsWith('.svg') || v.src?.startsWith('data:image/svg'))) {
            // due to windows bug which cannot load svg files in webgl without a width and height
            const canvas = document.createElement('canvas')
            SVGTextureLoader.CopyImageToCanvas(canvas, v)
            v = canvas
        }

        tex = new Texture(v)
        upgradeTexture.call(tex)
        tex.assetType = 'texture'
        tex.needsUpdate = true
        // set userData.mimeType for GLTFExporter
        const ext = v.src?.split('?')?.[0]?.split('.').pop() ?? ''
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
    const tex: ITexture&Partial<ImportResultExtras> = config.__proxy.value_
    if (!tex) return
    const vcv = tex.image ?? config.uiRef.controller_.valueController.value.rawValue
    if (tex.__rootBlob && !tex.__rootBlob.objectUrl) tex.__rootBlob.objectUrl = URL.createObjectURL(tex.__rootBlob)
    let src = tex.__rootBlob ? tex.__rootBlob.objectUrl : tex.userData.rootPath || vcv?.src
    if (src && src.startsWith('blob:')) src = ''

    let revokeSrc = false

    // HTML image/video/bitmap
    if (vcv && (vcv instanceof ImageBitmap || vcv instanceof HTMLImageElement || vcv instanceof HTMLVideoElement) && !src)
        src = imageBitmapToBase64(vcv)

    let name = tex.__rootBlob ? tex.__rootBlob.name || 'image.' + (tex.__rootBlob.ext || 'png') : null

    // Render target texture
    if (!src && tex.isRenderTargetTexture) {
        const target1 = tex._target
        if (target1?.isWebGLRenderTarget) {
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
            // todo: use textureToCanvas for data texture
            console.error('Only Float and HalfFloat Data texture export is supported', vcv, tex, config)
            return
        }
        // todo: use viewer.export directly (check threepipe Readme)
        const buffer = new EXRExporter2().parse(undefined as any, tex as DataTexture&ITexture)
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
    const last = config.__proxy.value_
    const isStr = typeof last === 'string'
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

async function imageFromFile(renderer: TweakpaneUiPlugin, config: UiObjectConfig, viewer: ThreeViewer, inp: HTMLInputElement, params: any) {
    const last = config.__proxy.value_
    const isStr = typeof last === 'string'
    if (isStr) {
        inp.click()
        return
    }
    const files = await uploadFile(false, false, params.extensions?.join(',') ?? 'image/*')
    if (!files.length) return
    const file = files[0]

    setterFile(viewer, file, undefined, config, renderer)
}

export const tpImageInputGenerator: (viewer: ThreeViewer) => (parent: any, config: UiObjectConfig, renderer: TweakpaneUiPlugin, params?: any) => any = (viewer: ThreeViewer) => (parent: any /* FolderApi */, config: UiObjectConfig, renderer: TweakpaneUiPlugin, params?: any) => {
    // if (config.value !== undefined) throw 'Not supported yet'

    if (!config.__proxy) {
        config.__proxy = {
            listedOnChange: false,
        }

        Object.defineProperty(config.__proxy, 'value', {
            get: () => {
                try {
                    config.__proxy.value_ = renderer.methods.getRawValue(config) // sending undefined to disable comparison for undo etc
                    const ret = proxyGetValue(config.__proxy.value_, viewer, config) as any
                    if (typeof ret !== 'string' && !ret.id?.length) ret.id = generateUUID()
                    const id = typeof ret === 'string' ? ret : ret.id ?? ret
                    if (!staticData.textureMap[id]) staticData.textureMap[id] = config.__proxy.value_
                    return ret
                } catch (e) {
                    console.error('uiconfig-tweakpane - ImageInput Unknown error', e)
                    return staticData.placeholderVal
                }
            },
            set: (v: any) => {
                if (getOrCall(config.readOnly)) return
                config.__proxy.value_ = renderer.methods.getRawValue(config) // current value
                proxySetValue(v, config.__proxy.value_, config, viewer, renderer)
            },
        })
    }
    config.__proxy.value_ = renderer.methods.getRawValue(config)

    params = params ?? {}
    params.extensions = allowedImageExtensions
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
            ['set/replace image']: async() => imageFromFile(renderer, config, viewer, inp, params),
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
        config.uiRefresh?.(false, 'postFrame')
    }
    params.view = 'input-image'
    return renderer.typeGenerators.input(parent, config, renderer, params)
}
