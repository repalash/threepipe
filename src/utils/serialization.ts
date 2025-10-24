import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    deepAccessObject,
    getTypedArray,
    safeSetProperty,
    Serialization,
    Serializer,
} from 'ts-browser-helpers'
import {
    AnimationClip,
    ArcCurve,
    CanvasTexture,
    CatmullRomCurve3,
    Color,
    CubeTexture,
    CubicBezierCurve,
    CubicBezierCurve3,
    Curve,
    CurvePath,
    DataTexture,
    EllipseCurve,
    Euler,
    LineCurve,
    LineCurve3,
    Material,
    MaterialLoader,
    Matrix2,
    Matrix3,
    Matrix4,
    ObjectLoader,
    Path,
    QuadraticBezierCurve,
    QuadraticBezierCurve3,
    Quaternion,
    Shape,
    Source,
    Spherical,
    SplineCurve,
    Texture,
    Vector2,
    Vector3,
    Vector4,
} from 'three'
import type {AssetImporter, AssetManager, BlobExt, IAssetImporter, ImportResultExtras} from '../assetmanager'
import type {ThreeViewer} from '../viewer'
import type {IMaterial, IObject3D, ITexture} from '../core'
import type {IRenderTarget, RenderManager} from '../rendering'
import {isNonRelativeUrl} from './browser-helpers'
import {textureToCanvas} from '../three'

const copier = (c: any) => (v: any, o: any) => o?.copy?.(v) ?? new c().copy(v)

export class ThreeSerialization {

    static Primitives = [
        [Vector2, 'isVector2', ['x', 'y'], 1],
        [Vector3, 'isVector3', ['x', 'y', 'z'], 1],
        [Vector4, 'isVector4', ['x', 'y', 'z', 'w'], 1],
        [Quaternion, 'isQuaternion', ['x', 'y', 'z', 'w'], 1],
        [Euler, 'isEuler', ['x', 'y', 'z', 'order'], 1],
        [Color, 'isColor', ['r', 'g', 'b'], 1],
        [Matrix2, 'isMatrix2', ['elements'], 1],
        [Matrix3, 'isMatrix3', ['elements'], 1],
        [Matrix4, 'isMatrix4', ['elements'], 1],
        [Spherical, 'isSpherical', ['radius', 'phi', 'theta'], 1],
        // todo Plane etc (has Vector2)
    ] as const

    static PrimitiveSerializer(cls: any, isType: string, props: string[]|Readonly<string[]>, priority = 1): Serializer {
        return {
            priority: priority,
            isType: (obj: any) => obj?.[isType] /* || obj?.metadata?.type === cls.name*/,
            serialize: (obj: any) => {
                // if (!obj?.[isType]) throw new Error(`Expected a ${cls.name}`)
                const ret = {[isType]: true}
                for (const k of props) ret[k] = obj[k]
                return ret
            },
            deserialize: copier(cls),
            // @ts-expect-error type in next version
            type: isType.startsWith('is') ? isType.slice(2) : cls.name,
        }
    }

    static Texture: Serializer = {
        priority: 2,
        isType: (obj: any) => obj.isTexture || obj.metadata?.type === 'Texture',
        serialize: (obj: any, meta?: SerializationMetaType) => {
            if (!obj?.isTexture) throw new Error('Expected a texture')
            if (obj.isRenderTargetTexture) return undefined // todo: support render targets
            // if (obj.isRenderTargetTexture && !obj.userData?.serializableRenderTarget) return undefined
            if (meta?.textures[obj.uuid]) return {uuid: obj.uuid, resource: 'textures'}
            const imgData = obj.source.data
            const hasRootPath = !obj.isRenderTargetTexture && obj.userData.rootPath && typeof obj.userData.rootPath === 'string' &&
                isNonRelativeUrl(obj.userData.rootPath)
            let res = {} as any
            const ud = obj.userData
            try { // need try catch here because of hasRootPath
                if (hasRootPath) {
                    if (obj.source.data) {
                        if (!obj.userData.embedUrlImagePreviews) // todo make sure its only Texture, check for svg etc
                            obj.source.data = null // handled in GLTFWriter2.processImage
                        else {
                            obj.source.data = textureToCanvas(obj, 16, obj.flipY) // todo: check flipY
                        }
                    }
                }
                obj.userData = {} // toJSON will call JSON.stringify, which will serialize userData
                const meta2 = {images: {} as any} // in-case meta is undefined
                res = obj.toJSON(meta || meta2)
                if (!meta && res.image) res.image = hasRootPath && !obj.userData.embedUrlImagePreviews ? undefined : meta2.images[res.image]
                res.userData = Serialization.Serialize(copyTextureUserData({}, ud), meta, false)
            } catch (e) {
                console.error('ThreeSerialization: Unable to serialize texture')
                console.error(e)
            }
            obj.userData = ud // should be outside try catch
            if (hasRootPath) {
                if (meta && !obj.userData.embedUrlImagePreviews) delete meta.images[obj.source.uuid] // because its empty. uuid still stored in the texture.image
                obj.source.data = imgData
            }

            if (meta?.textures && res && !res.resource) {
                if (!meta.textures[res.uuid])
                    meta.textures[res.uuid] = res
                res = {uuid: res.uuid, resource: 'textures'}
            }
            return res
        },
        deserialize: (dat: any, obj: any, meta?: SerializationMetaType) => {
            if (dat.isTexture) return dat
            if (dat.resource === 'textures' && meta?.textures?.[dat.uuid]) return meta.textures[dat.uuid]

            console.warn('Cannot deserialize texture into object like primitive, since textures need to be loaded asynchronously. Trying with ObjectLoader. Load events might not work properly.', dat, obj)
            const loader = meta?._context.objectLoader ?? new ObjectLoader(meta?._context.assetImporter?.loadingManager)
            const data = {...dat}
            if (typeof data.image === 'string') {
                if (!meta?.images) {
                    console.error('ThreeSerialization: Cannot deserialize texture with image url without meta.images', data)
                } else {
                    data.image = meta.images[data.image]
                }
            }
            if (!data.image || typeof data.image === 'string' || !data.image.isSource && !data.image.url) {
                console.error('ThreeSerialization: Cannot deserialize texture', data)
                return obj
            }
            let imageOnLoad: undefined | (()=>void)
            if (meta && !data.image.isSource) {
                if (!meta._context.imagePromises) meta._context.imagePromises = []
                meta._context.imagePromises.push(new Promise<void>((resolve) => {
                    imageOnLoad = resolve
                }))
            }
            const sources = data.image.isSource ? {[data.image.uuid]: data.image as Source} : loader.parseImages([data.image], imageOnLoad)
            data.image = Object.keys(sources)[0]
            if (meta?.images) meta.images[data.image] = sources[data.image]
            if (data.userData) data.userData = ThreeSerialization.Deserialize(data.userData, {}, meta)
            const textures = loader.parseTextures([data], sources)
            const uuid = Object.keys(textures)[0]
            if (!uuid || !textures[uuid]) {
                console.error('ThreeSerialization: Cannot deserialize texture', data)
                return obj
            }
            if (meta?.textures) meta.textures[uuid] = textures[uuid]
            return textures[uuid]
        },
    }

    static SerializableMaterials = new Set<IMaterial['constructor']>()

    static Material: Serializer = {
        priority: 2,
        isType: (obj: any) => obj.isMaterial || obj.metadata?.type === 'Material',
        serialize: (obj: any, meta?: SerializationMetaType) => {
            if (!obj?.isMaterial) throw new Error('Expected a material')
            if (meta?.materials?.[obj.uuid]) return {uuid: obj.uuid, resource: 'materials'}

            // serialize textures separately
            const meta2 = meta ?? {textures: {}, images: {}}
            const objTextures: any = {}
            const tempTextures: any = {}

            const propList = Object.keys(obj.constructor.MaterialProperties || obj) // todo use MapProperties? or iMaterialCommons.getMapsForMaterial
            for (const k of propList) {
                if (k.startsWith('__')) continue // skip private/internal textures/properties
                const v = obj[k]
                if (v?.isTexture) {
                    const ser = Serialization.Serialize(v, meta2)
                    objTextures[k] = ser
                    tempTextures[k] = v
                    obj[k] = ser ? {isTexture: true, toJSON: ()=> ser} : null // because of how threejs Material.toJSON serializes textures
                }
            }

            // Serialize without userData because three.js tries to convert it to string. We are serializing it separately
            const userData = obj.userData
            obj.userData = {}
            let res = {} as any
            try {
                res = obj.toJSON(meta || meta2, true) // copying userData is handled in toJSON, see MeshStandardMaterial2
                serializeMaterialUserData(res, userData, meta)
                res.userData.uuid = userData.uuid
                // todo: override generator to mention that this is a custom serializer?
                if (obj.constructor.TYPE) res.type = obj.constructor.TYPE // override type if specified as static property in the class
                // Remove undefined values. Note that null values are kept.
                for (const key of Object.keys(res)) if (res[key] === undefined) delete res[key]
            } catch (e) {
                console.error('ThreeSerialization: Unable to serialize material')
                console.error(e)
            }
            obj.userData = userData
            // Restore textures
            for (const [k, v] of Object.entries(tempTextures)) {
                obj[k] = v
                delete tempTextures[k]
            }

            // Add material, textures, images to meta
            // serialize textures are already added to meta by the texture serializer
            if (res) {
                if (meta) {
                    for (const [k, v] of Object.entries(objTextures)) {
                        if (v) res[k] = v // can be undefined because of RenderTargetTexture...
                    }
                    if (meta.materials) {
                        if (!meta.materials[res.uuid])
                            meta.materials[res.uuid] = res
                        res = {uuid: res.uuid, resource: 'materials'}
                    }
                } else {
                    for (const [k, v] of Object.entries(objTextures)) {
                        if (v) res[k] = (v as any).uuid // to remain compatible with how three.js saves
                    }
                    res.textures = Object.values(meta2.textures)
                    res.images = Object.values(meta2.images)
                }
            }
            return res
        },
        deserialize: (dat: any, obj: any, meta?: SerializationMetaType) => {
            function finalCopy(material: Material) {
                if (material.isMaterial) {
                    if (obj?.isMaterial && obj.uuid === material.uuid) {
                        if (obj !== material && typeof obj.setValues === 'function') {
                            console.warn('ThreeSerialization: Material uuid already exists, copying values to old material')
                            obj.setValues(material)
                        }
                        return obj
                    } else {
                        return material
                    }
                }
                return undefined
            }

            let ret = finalCopy(dat)
            if (ret !== undefined) return ret
            if (dat.resource === 'materials' && meta?.materials?.[dat.uuid]) {
                ret = finalCopy(meta.materials[dat.uuid])
                if (ret !== undefined) return ret
                console.error('ThreeSerialization: cannot find material in meta', dat, ret)
            }

            const type = dat.type
            if (!type) {
                console.error('ThreeSerialization: Cannot deserialize material without type', dat)
                return obj
            }

            const data = {...dat} as Record<string, any>
            if (data.userData) data.userData = Serialization.Deserialize(data.userData, undefined, meta, false)
            //
            const textures: Record<string, Texture> = {}
            for (const [k, v] of Object.entries(data)) { // for textures
                if (typeof v === 'string' && meta?.textures?.[v]) {
                    data[k] = meta.textures[v]
                    textures[k] = meta.textures[v]
                }
                if (!v || !v.resource || typeof v.resource !== 'string') continue
                const resource = meta?.[v.resource as 'textures'|'extras']?.[v.uuid]
                data[k] = resource || null
                if (v.resource === 'textures' && resource?.isTexture) {
                    textures[k] = resource
                }
            }

            // we have 2 options, either obj is null or it is a material.
            // if the material is not the same type, we can't use it, should we throw an error or create a new material and assign it. maybe a warning and create a new material?
            // to create a material, we need to know the type, type->material initialization can be done in either material manager or MaterialLoader

            // data has deserialized textures and userData, assuming the rest can be deserialized by material.fromJSON

            if (!obj || !obj.isMaterial || obj.type !== type && obj.constructor?.TYPE !== type) {
                if (obj && Object.keys(obj).length) console.warn('ThreeSerialization: Material type mismatch during deserialize, creating a new material', obj, data, type, obj.constructor?.type)
                obj = null
            }

            // if obj is not null
            if (obj && (!data.uuid || obj.uuid === data.uuid)) {
                if (obj.fromJSON) obj.fromJSON(data, meta, true)
                else if (obj.setValues) obj.setValues(data)
                else console.error('ThreeSerialization: Cannot deserialize material, no fromJSON or setValues method', obj, data)
                return obj
            }

            // obj is null or type mismatch, so ignore obj and create a new material

            // find a material class with the type registered in SerializableMaterials
            const uuid = dat.isMaterial ? undefined : dat.uuid
            let template = null as IMaterial['constructor'] | null
            for (const m of ThreeSerialization.SerializableMaterials) {
                if (m.TYPE === type) {
                    template = m
                    break
                }
            }
            if (!template) {
                for (const m of ThreeSerialization.SerializableMaterials) {
                    if (m.TypeAlias?.includes(type)) {
                        template = m
                        break
                    }
                }
            }
            if (template) {
                const material = new template()
                if (material) {
                    if (uuid) {
                        safeSetProperty(material, 'uuid', uuid, true, true)
                    }
                    if (material.fromJSON) material.fromJSON(data, meta, true)
                    else if (material.setValues) material.setValues(data)
                    else console.error('ThreeSerialization: Cannot deserialize material, no fromJSON or setValues method', material, data)
                    return material
                }
            }

            // todo use loader from context to load instead of this
            console.warn('Legacy three.js material deserialization')

            // normal three.js material
            const loader = new MaterialLoader()
            for (const [k, v] of Object.entries(textures)) {
                data[k] = v.uuid
            }
            const texs = {...loader.textures}
            loader.setTextures(textures)
            const mat = loader.parse(data)
            if (data.uuid) {
                safeSetProperty(mat, 'uuid', data.uuid, true, true)
            }
            loader.setTextures(texs)

            ret = finalCopy(mat)
            if (ret !== undefined) return ret
            console.error('ThreeSerialization: cannot deserialize material', dat, ret, mat)

        },
    }

    static RenderTarget: Serializer = {
        priority: 2,
        isType: (obj: any) => obj.isWebGLRenderTarget || obj.metadata?.type === 'RenderTarget',
        serialize: (obj: IRenderTarget, meta?: SerializationMetaType) => {
            if (!obj?.isWebGLRenderTarget || !obj.uuid) throw new Error('Expected a IRenderTarget')
            if (meta?.extras[obj.uuid]) return {uuid: obj.uuid, resource: 'extras'}

            // This is for the class implementing IRenderTarget, check {@link RenderTargetManager} for class implementation
            const tex = Array.isArray(obj.texture) ? obj.texture[0] : obj.texture
            let res: any = {
                metadata: {type: 'RenderTarget'},
                uuid: obj.uuid,
                width: obj.width,
                height: obj.height,
                depth: obj.depth,
                sizeMultiplier: obj.sizeMultiplier,
                count: Array.isArray(obj.texture) ? obj.texture.length : undefined,
                isCubeRenderTarget: obj.isWebGLCubeRenderTarget || undefined,
                isTemporary: obj.isTemporary,
                textureName: Array.isArray(obj.texture) ? obj.texture.map(t => t.name) : obj.texture?.name,
                options: {
                    wrapS: tex?.wrapS,
                    wrapT: tex?.wrapT,
                    magFilter: tex?.magFilter,
                    minFilter: tex?.minFilter,
                    format: tex?.format,
                    type: tex?.type,
                    anisotropy: tex?.anisotropy,
                    depthBuffer: !!obj.depthBuffer,
                    stencilBuffer: !!obj.stencilBuffer,
                    generateMipmaps: tex?.generateMipmaps,
                    depthTexture: !!obj.depthTexture,
                    colorSpace: tex?.colorSpace,
                    samples: obj.samples,
                },
            }

            if (meta?.extras) {
                if (!meta.extras[res.uuid])
                    meta.extras[res.uuid] = res
                res = {uuid: res.uuid, resource: 'extras'}
            }
            return res
        },
        deserialize: (dat: any, obj: any, meta?: SerializationMetaType) => {
            if (obj?.uuid === dat.uuid) return obj
            if (dat.isWebGLRenderTarget) return dat

            const renderManager = meta?._context.renderManager
            if (!renderManager) {
                console.error('ThreeSerialization: Cannot deserialize render target without render manager', dat)
                return obj
            }
            if (dat.isWebGLCubeRenderTarget || dat.isTemporary) {
                // todo support cube, temporary render target here
                console.warn('ThreeSerialization: Cannot deserialize WebGLCubeRenderTarget or temporary render target yet', dat)
                return obj
            }

            const res = renderManager.createTarget({
                sizeMultiplier: dat.sizeMultiplier || undefined,
                size: dat.sizeMultiplier ? undefined : {width: dat.width, height: dat.height},
                textureCount: dat.count,
                ...dat.options,
            })
            if (dat.textureName) {
                if (Array.isArray(dat.textureName) && Array.isArray(res.texture)) {
                    for (let i = 0; i < dat.textureName.length; i++) {
                        res.texture[i].name = dat.textureName[i]
                    }
                } else if (!Array.isArray(res.texture)) {
                    res.texture.name = Array.isArray(dat.textureName) ? dat.textureName[0] : dat.textureName
                }
            }
            if (!res) return res
            res.uuid = dat.uuid
            if (meta?.extras) meta.extras[dat.uuid] = res
            return res
        },
    }

    private static _init = false

    static Init() {
        if (this._init) return
        this._init = true
        // @ts-expect-error not sure why it's not set in three.js
        Spherical.prototype.isSpherical = true
        Serialization.RegisterSerializer(...ThreeSerialization.Primitives.map(p=>ThreeSerialization.PrimitiveSerializer(p[0], p[1], p[2], p[3])))
        Serialization.RegisterSerializer(ThreeSerialization.Texture)
        Serialization.RegisterSerializer(ThreeSerialization.Material)
        Serialization.RegisterSerializer(ThreeSerialization.RenderTarget)

        // these classes have toJSON/fromJSON and .type
        Serialization.SerializableClasses.set('Shape', Shape) // todo this could be large, it should be a resource in meta for duplicates
        Serialization.SerializableClasses.set('Curve', Curve)
        Serialization.SerializableClasses.set('CurvePath', CurvePath)
        Serialization.SerializableClasses.set('Path', Path)
        Serialization.SerializableClasses.set('ArcCurve', ArcCurve)
        Serialization.SerializableClasses.set('CatmullRomCurve3', CatmullRomCurve3)
        Serialization.SerializableClasses.set('CubicBezierCurve', CubicBezierCurve)
        Serialization.SerializableClasses.set('CubicBezierCurve3', CubicBezierCurve3)
        Serialization.SerializableClasses.set('EllipseCurve', EllipseCurve)
        Serialization.SerializableClasses.set('LineCurve', LineCurve)
        Serialization.SerializableClasses.set('LineCurve3', LineCurve3)
        Serialization.SerializableClasses.set('QuadraticBezierCurve', QuadraticBezierCurve)
        Serialization.SerializableClasses.set('QuadraticBezierCurve3', QuadraticBezierCurve3)
        Serialization.SerializableClasses.set('SplineCurve', SplineCurve)
        Serialization.SerializableClasses.set('AnimationClip', AnimationClip)
        // Serialization.SerializableClasses.set('Skeleton', Skeleton) // doesnt have .type. todo add to three.js
    }

    static MakeSerializable(constructor: ObjectConstructor, type: string, props?: (string|[string, string])[]) {
        (constructor.prototype as any).serializableClassId = type
        Serialization.SerializableClasses.set(type, constructor)
        if (props) Serialization.TypeMap.set(constructor, props.map(p=>typeof p === 'string' ? [p, p] : p))
    }

    /**
     * Serialize an object
     * {@link Serialization.Serialize}
     */
    static Serialize(obj: any, meta?: SerializationMetaType, isThis = false) {
        if (!this._init) this.Init()
        return Serialization.Serialize(obj, meta, isThis)
    }

    /**
     * Deserialize an object
     * {@link Serialization.Deserialize}
     */
    static Deserialize(data: any, obj: any, meta?: SerializationMetaType, isThis = false) {
        if (!this._init) this.Init()
        return Serialization.Deserialize(data, obj, meta, isThis)
    }

}

/**
 * Deep copy/clone from source to dest, assuming both are userData objects for three.js objects/materials/textures etc.
 * This will clone any property that can be cloned (apart from Object3D, Texture, Material) and deep copy the objects and arrays.
 * @note Keep synced with copyMaterialUserData in three.js -> Material.js todo: merge these functions? by putting this inside three.js?
 * @param dest
 * @param source
 * @param ignoredKeysInRoot - keys to ignore in the root object
 */
export function copyUserData(dest: any, source: any, ignoredKeysInRoot: (string|symbol)[] = []): any {
    if (!source) return dest
    for (const key of Object.keys(source)) {
        if (ignoredKeysInRoot.includes(key)) continue
        if (key.startsWith('__')) continue // double underscore
        const src = source[key]
        if (typeof dest[key] === 'function' || typeof src === 'function') continue
        const skipClone = !src || src.isTexture || src.isObject3D || src.isMaterial || src.isBufferGeometry || src.userDataSkipClone
        if (!skipClone && typeof src.clone === 'function')
            dest[key] = src.clone()
        // else if (!skipClone && (typeof src === 'object' || Array.isArray(src)))
        else if (!skipClone && (src.constructor === Object || Array.isArray(src)))
            dest[key] = copyUserData(Array.isArray(src) ? [] : {}, src, [])
        else
            dest[key] = src
    }
    return dest
}

/**
 * Deep copy/clone from source to dest, assuming both are userData objects in Textures.
 * Same as {@link copyUserData} but ignores uuid in the root object.
 * @param dest
 * @param source
 * @param ignoredKeysInRoot
 */
export function copyTextureUserData(dest: any, source: any, ignoredKeysInRoot = ['uuid']): any {
    return copyUserData(dest, source, ignoredKeysInRoot)
}


/**
 * Deep copy/clone from source to dest, assuming both are userData objects in Materials.
 * Same as {@link copyUserData} but ignores uuid in the root object.
 * @note Keep synced with copyMaterialUserData in three.js -> Material.js
 * @param dest
 * @param source
 * @param ignoredKeysInRoot
 */
export function copyMaterialUserData(dest: any, source: any, ignoredKeysInRoot = ['uuid']): any {
    return copyUserData(dest, source, ignoredKeysInRoot)
}


/**
 * Deep copy/clone from source to dest, assuming both are userData objects in Object3D.
 * Same as {@link copyUserData} but ignores uuid in the root object.
 * @param dest
 * @param source
 * @param ignoredKeysInRoot
 */
export function copyObject3DUserData(dest: any, source: any, ignoredKeysInRoot = ['uuid']): any {
    return copyUserData(dest, source, ignoredKeysInRoot)
}

/**
 * Serialize userData and sets to data.userData. This is required because three.js Material.toJSON does not serialize userData.
 * @param data
 * @param userData
 * @param meta
 */
function serializeMaterialUserData(data: any, userData: any, meta?: SerializationMetaType) {
    data.userData = {}

    copyMaterialUserData(data.userData, userData)

    // Serialize the userData
    const meta2 = meta || { // Make meta object for the Serializer from the data. This requires changing from Array to Object for textures and images
        textures: Object.fromEntries(data.textures?.map((t: any) => [t.uuid, t]) || []),
        images: Object.fromEntries(data.images?.map((t: any) => [t.uuid, t]) || []),
    }
    data.userData = Serialization.Serialize(data.userData, meta2) // here meta is required for textures otherwise images will be lost. Material.toJSON sets the result as meta if not provided.
    if (!meta) {
        // Add textures and images to the result if meta is not provided. This is to remain compatible with how three.js saves materials. See (MaterialLoader and JSONMaterialLoader)
        if (Object.keys(meta2.textures).length > 0) data.textures = Object.values(meta2.textures)
        if (Object.keys(meta2.images).length > 0) data.images = Object.values(meta2.images)
    }
}

/**
 * Converts array buffers to base64 strings in meta.
 * This is useful when storing .json files, as storing as number arrays takes a lot of space.
 * Used in viewer.toJSON()
 * @param meta
 */
export function convertArrayBufferToStringsInMeta(meta: SerializationMetaType) {
    Object.values(meta).forEach((res: any) => { // similar to processViewer in gltf export.
        if (res) Object.values(res).forEach((item: any) => {
            if (!item.url) return
            // console.log(item.url)
            if (!(item.url.data instanceof ArrayBuffer) && !Array.isArray(item.url.data)) return
            if (item.url.type === 'Uint16Array') {
                if (!(item.url.data instanceof Uint16Array)) { // because it can be a typed array
                    item.url.data = new Uint16Array(item.url.data)
                }
                item.url.data = 'data:application/octet-stream;base64,' + arrayBufferToBase64(item.url.data.buffer)
            } else if (item.url.type === 'Uint8Array') {
                if (!(item.url.data instanceof Uint8Array)) { // because it can be a typed array
                    item.url.data = new Uint8Array(item.url.data)
                }
                // todo: just use jpeg or PNG encoding for this ?
                item.url.data = 'data:application/octet-stream;base64,' + arrayBufferToBase64(item.url.data.buffer)
            } else if (item.url.data instanceof ArrayBuffer) {
                item.url.data = 'data:application/octet-stream;base64,' + arrayBufferToBase64(item.url.data.buffer)
            } else {
                console.warn('Unsupported buffer type', item.url.type)
            }
        })
    })
}

/**
 * Converts strings(base64 or utf-8) to array buffers in meta. This is the reverse of {@link convertArrayBufferToStringsInMeta}
 * Used in viewer.fromJSON()
 */
export function convertStringsToArrayBuffersInMeta(meta: SerializationMetaType) {
    Object.values(meta).forEach((res: any) => { // similar to processViewer in gltf export.
        if (res) Object.values(res).forEach((item: any) => {
            if (!item || !item.url) return
            if (typeof item.url.data !== 'string') return

            // base64 data uri or any mime type
            // console.log(item.url.data?.match?.(/^data:.*;base64,(.*)$/))
            const dataUriMatch = item.url.data.match(/^data:.*;base64,(.*)$/)
            if (dataUriMatch?.[1]) {
                item.url.data = base64ToArrayBuffer(dataUriMatch?.[1])
            } else { // utf-8 string, not used at the moment
                if (item.url.type !== 'Uint8Array') {
                    console.error('ThreeSerialization: Unsupported buffer type string for ', item.url.type, 'use base64')
                }
                item.url.data = new TextEncoder().encode(item.url.data).buffer // todo: this doesnt work in ie/edge maybe, but this feature is not used.
            }

        })
    })
}

export function getEmptyMeta(res?: Partial<SerializationResourcesType>): SerializationMetaType {
    return { // see Object3D.js toJSON for more details
        geometries: {...res?.geometries},
        materials: {...res?.materials},
        textures: {...res?.textures},
        images: {...res?.images},
        shapes: {...res?.shapes},
        skeletons: {...res?.skeletons},
        animations: {...res?.animations},
        extras: {...res?.extras},
        typed: {...res?.typed},
        _context: {},
    }
}

export interface SerializationResourcesType {
    geometries: Record<string, any>,
    materials: Record<string, any>,
    textures: Record<string, any>,
    images: Record<string, any>,
    shapes: Record<string, any>,
    skeletons: Record<string, any>,
    animations: Record<string, any>,
    extras: Record<string, any>,
    typed: Record<string, any>,
    object?: any, // todo what is this used for?

    [key: string]: any,

}
export interface SerializationMetaType extends SerializationResourcesType {
    _context: {
        assetImporter?: AssetImporter,
        objectLoader?: ObjectLoader,
        assetManager?: AssetManager,
        renderManager?: RenderManager,

        imagePromises?: Promise<any>[],
        viewer?: ThreeViewer,

        [key: string]: any,
    }

    __isLoadedResources?: boolean

}
export class MetaImporter {

    /**
     * @param json
     * @param extraResources - preloaded resources in the format of viewer config resources.
     */
    static async ImportMeta(json: SerializationMetaType, extraResources?: Partial<SerializationResourcesType>) {
        // console.log(json)
        if (json.__isLoadedResources) return json

        const resources: SerializationMetaType = metaFromResources()
        resources.__isLoadedResources = true
        resources._context = json._context

        convertStringsToArrayBuffersInMeta(json)

        // console.log(viewerConfig)
        const assetImporter = json._context.assetImporter
        if (!assetImporter) throw new Error('assetImporter not found in meta context, which is required for import meta.')

        const objLoader = json._context.objectLoader || new ObjectLoader(assetImporter.loadingManager)

        // see ObjectLoader.parseAsync
        resources.animations = json.animations ? objLoader.parseAnimations(Object.values(json.animations)) : {}
        if (extraResources && extraResources.animations) resources.animations = {...resources.animations, ...extraResources.animations}

        resources.shapes = json.shapes ? objLoader.parseShapes(Object.values(json.shapes)) : {}
        if (extraResources && extraResources.shapes) resources.shapes = {...resources.shapes, ...extraResources.shapes}

        resources.geometries = json.geometries ? objLoader.parseGeometries(Object.values(json.geometries), resources.shapes) : {}
        if (extraResources && extraResources.geometries) resources.geometries = {...resources.geometries, ...extraResources.geometries}

        resources.images = json.images ? await objLoader.parseImagesAsync(Object.values(json.images)) : {} // local images only like data url and data textures
        if (extraResources && extraResources.images) resources.images = {...resources.images, ...extraResources.images}

        // const onLoad = () => { // todo: do it after all the images not after one
        //     Object.values(resources.textures).forEach((t: any) => {
        //         if (t.isTexture && t.image?.complete) t.needsUpdate = true
        //     })
        // }

        if (Array.isArray(json.textures)) {
            console.error('ThreeSerialization: TODO: check file format')
            json.textures = json.textures.reduce((acc, cur) => {
                if (!cur) return acc
                acc[cur.uuid] = cur
                return acc
            })
        }

        await MetaImporter.LoadRootPathTextures({textures: json.textures, images: resources.images}, assetImporter)

        // console.log(json.textures)
        const textures = []
        for (const texture of Object.values(json.textures)) {
            const tex = {...texture}
            if (tex.userData) tex.userData = ThreeSerialization.Deserialize(tex.userData, {}, resources)
            textures.push(tex)
        }
        resources.textures = json.textures ? objLoader.parseTextures(textures, resources.images) : {}

        for (const key1 of Object.keys(resources.textures)) {
            let tex: Texture|undefined = resources.textures[key1]
            if (!tex) continue
            // __texCtor is set in MetaImporter.LoadRootPathTextures
            if (tex.source.__texCtor) {
                const newTex: Texture = new tex.source.__texCtor(tex.source.data)
                if (!newTex || typeof newTex.copy !== 'function') continue
                newTex.copy(tex)
                delete tex.source.__texCtor
                resources.textures[key1] = newTex
                tex = newTex
            }
            if (tex.source.data instanceof HTMLCanvasElement && !(tex as CanvasTexture).isCanvasTexture) {
                const newTex = new CanvasTexture(tex.source.data).copy(tex)
                resources.textures[key1] = newTex
                tex = newTex
            }
        }

        // replace the source of the textures(which has preview) with the loaded images, see {@link LoadRootPathTextures} for `rootPathPromise`
        // todo: should this be moved after processRaw?
        const textures2 = {...resources.textures}
        for (const inpTexture of Object.values(json.textures)) {
            inpTexture.rootPathPromise?.then((v: Source|null) => {
                if (!v) return
                const texture = textures2[inpTexture.uuid]
                texture.dispose()
                texture.source = v
                texture.source.needsUpdate = true
                texture.needsUpdate = true
            })
        }

        for (const entry of Object.entries(resources.textures)) {
            entry[1] = await assetImporter.processRawSingle(entry[1], {})
            if (entry[1]) resources.textures[entry[0]] = entry[1]
            else delete resources.textures[entry[0]]
        }
        if (extraResources && extraResources.textures) resources.textures = {...resources.textures, ...extraResources.textures}


        const jsonMats: any[] = json.materials ? Object.values(json.materials) : []
        resources.materials = {}
        for (const material of jsonMats) {
            if (!material?.uuid) continue
            // Object.entries(material).forEach(([k, data]: [string, any]) => {
            //     if (data && data.resource && data.uuid && data.resource === 'textures') { // for textures put in by serialize.ts
            //         material[k] = data.uuid
            //     }
            // })
            resources.materials[material.uuid] = ThreeSerialization.Deserialize(material, undefined, resources)
        }
        if (extraResources && extraResources.materials) resources.materials = {...resources.materials, ...extraResources.materials}

        if (json.object) {
            resources.object = objLoader.parseObject(json.object, resources.geometries, resources.materials, resources.textures, resources.animations)
            if (json.skeletons) {
                resources.skeletons = objLoader.parseSkeletons(Object.values(json.skeletons), resources.object as any)
                objLoader.bindSkeletons(resources.object as any, resources.skeletons)
            }
        }

        if (json.extras) {
            resources.extras = json.extras
            for (const e of (Object.values(json.extras) as any as any[])) { // todo parallel import
                if (!e.uuid) continue
                if (!e.url) {
                    resources.extras[e.uuid] = ThreeSerialization.Deserialize(e, undefined, resources)
                    continue
                }
                // see LUTCubeTextureWrapper, KTX2LoadPlugin for sample use
                if (typeof e.url === 'string') {
                    const r = await assetImporter.importSingle(e.url, e.userData?.rootPathOptions || {}) // todo rootPathOptions is not being set when exporting extras right now
                    if (r) resources.extras[e.uuid] = r
                } else if (e.url.data) {
                    const file = new File([getTypedArray(e.url.type, e.url.data)], e.url.path)
                    const r = await assetImporter.importSingle({path: file.name, file}, e.userData?.rootPathOptions || {}, undefined, false) // false is passed to mark it as external
                    // todo: userdata? name? other properties?
                    if (r) resources.extras[e.uuid] = r
                } else {
                    console.warn('invalid URL type while loading extra resource')
                }
            }
            // console.log(resources.extras)
        }
        if (extraResources && extraResources.extras) resources.extras = {...resources.extras, ...extraResources.extras}

        resources.typed = {}
        if (json.typed) {
            for (const [key, item] of Object.entries(json.typed)) {
                if (typeof item.rootPath === 'string' && item.external) { // todo parallel import
                    const r = await assetImporter.importSingle(item.rootPath, item.rootPathOptions || {})
                    if (r) resources.typed[key] = r
                } else {
                    resources.typed[key] = ThreeSerialization.Deserialize(item, undefined, resources)
                }
            }
        }
        if (extraResources && extraResources.typed) resources.typed = {...resources.typed, ...extraResources.typed}

        // console.log(resources, json)
        return resources
    }


    // todo see _loadObjectDependencies2
    static async LoadRootPathTextures({textures, images}: Pick<SerializationMetaType, 'textures'|'images'>, importer: IAssetImporter, usePreviewImages = true) {
        const pms = []

        for (const inpTexture of Array.isArray(textures) ? textures : Object.values(textures ?? {} as any) as any as any[]) {
            const path = inpTexture?.userData?.rootPath
            const hasImage = usePreviewImages && inpTexture.image && images[inpTexture.image] // its possible to have both image and rootPath, then the image will be preview image.
            if (!path) continue
            const promise = importer.importSingle<ITexture>(path, inpTexture.userData.rootPathOptions || {}).then((texture) => {
                const source = texture?.source as any
                if (!texture || !texture.isTexture || !source) {
                    console.error('AssetImporter: Imported rootPath is not a Texture', path, texture)
                    return
                }
                // console.log(typeof image)
                const source2 = new Source(source.data)
                if (inpTexture.image) source2.uuid = inpTexture.image
                inpTexture.image = source2.uuid

                // only these are supported by ObjectLoader.parseTextures, see parseTextures2
                if (texture.constructor !== Texture && texture.constructor !== DataTexture && texture.constructor !== CubeTexture) {
                    source2.__texCtor = texture.constructor as typeof Texture
                }

                if (!hasImage) images[source2.uuid] = source2

                texture.dispose()
                return source2
            }).catch((e) => {
                console.error('ThreeSerialization: Error loading texture from rootPath', inpTexture.userData.rootPath)
                console.error(e)
                delete inpTexture.userData.rootPath
                return null
            })
            if (hasImage) inpTexture.rootPathPromise = promise
            else pms.push(promise)
        }

        await Promise.allSettled(pms)
    }

}

export function metaToResources(meta?: SerializationMetaType): Partial<SerializationResourcesType> {
    if (!meta) return {}
    const res: Partial<SerializationResourcesType> = {...meta}
    if (res._context) delete res._context
    return res
}

export function metaFromResources(resources?: Partial<SerializationResourcesType>, viewer?: ThreeViewer): SerializationMetaType {
    return {
        ...resources,
        ...getEmptyMeta(resources),
        _context: {
            assetManager: viewer?.assetManager,
            assetImporter: viewer?.assetManager.importer,
            renderManager: viewer?.renderManager,
            viewer: viewer,
        }, // clear context even if its present in resources
    }
}

export function jsonToBlob(json: any): BlobExt {
    const b = new Blob([JSON.stringify(json)], {type: 'application/json'}) as BlobExt
    b.ext = 'json'
    return b
}

/**
 * Used in {@link LUTCubeTextureWrapper} and {@link KTX2LoadPlugin} and imported in {@link ThreeViewer.loadConfigResources}
 * @param texture
 * @param meta
 * @param name
 * @param mime
 */
export function serializeTextureInExtras(texture: ITexture & ImportResultExtras, meta: any, name?: string, mime?: string) {
    if (meta?.extras[texture.uuid]) return {uuid: texture.uuid, resource: 'extras'}

    let url: any = ''
    if (texture.source?._sourceImgBuffer || texture.__sourceBuffer) {
        // serialize blob to data in image.
        // Note: do not change to Uint16Array because it's encoded to rgbe in `processViewer`
        const data = new Uint8Array(texture.source?._sourceImgBuffer || texture.__sourceBuffer as ArrayBuffer)
        const mimeType = mime || texture.userData.mimeType || ''
        url = {
            data: Array.from(data), // texture need to be a normal array, not a typed array.
            type: data.constructor.name,
            path: texture.userData.__sourceBlob?.name || texture.userData.rootPath || 'file.' + mimeType.split('/')[1],
        }
        if (mimeType) url.mimeType = mimeType
    } else if (texture.userData.rootPath) {
        url = texture.userData.rootPath
    } else {
        console.error('ThreeSerialization: Unable to serialize LUT texture, not loaded through asset manager.')
    }

    const tex = {
        uuid: texture.uuid,
        url,
        userData: copyTextureUserData({}, texture.userData),
        type: texture.type,
        name: name || texture.name,
    }
    if (meta?.extras) {
        meta.extras[texture.uuid] = tex
        return {uuid: texture.uuid, resource: 'extras'}
    }
    return tex
}

declare module 'three'{
    export interface Source{
        ['__texCtor']?: typeof Texture
    }
}


export function getPartialProps(obj: IObject3D|IMaterial, props1?: string[]) {
    // copy properties from res1 to obj except those in sProperties
    const props: Record<string, any> = {}
    const sProps = Array.isArray(props1) ? props1 : []
    for (const sProp of sProps) {
        const deep = sProp.startsWith('userData.')
        let res2
        if (deep) {
            res2 = deepAccessObject(sProp.slice('userData.'.length), obj.userData, false)
        } else {
            res2 = (obj as any)[sProp]
        }
        if (res2 !== undefined) {
            props[sProp] = res2
        }
    }
    return props
}

export function setPartialProps(props: Record<string, any>, obj: IMaterial|IObject3D) {
    for (const sProp of Object.keys(props)) {
        const value = props[sProp]
        const deep = sProp.startsWith('userData.')
        if (!deep) {
            (obj as any)[sProp] = value
        } else {
            const tar = obj.userData
            const parts = sProp.split('.')
            const tarkey = parts.slice(1, -1)
            const tar2 = parts.length && tarkey.length ? deepAccessObject(tarkey, tar, false) : undefined
            if (tar2 !== undefined) {
                const key = parts[parts.length - 1]
                tar2[key] = value
            } else {
                // todo for userData deep property it will fail since parent object wouldnt exist in empty object. we need to create the empty target recursively if it doesnt exists
                console.warn('ThreeSerialization: setSProps: invalid sProperty', sProp, 'in', obj)
            }
        }
    }
}

