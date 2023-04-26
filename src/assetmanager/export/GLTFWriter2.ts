import {GLTFExporter, GLTFExporterOptions} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {BufferGeometry, Material, MeshStandardMaterial, Object3D, PixelFormat, Texture} from 'three'
import {blobToDataURL} from 'ts-browser-helpers'
import type {GLTFExporter2Options} from './GLTFExporter2'

export class GLTFWriter2 extends GLTFExporter.Utils.GLTFWriter {

    options: GLTFExporterOptions & {
        externalImagesInExtras: boolean,
        exporterOptions: GLTFExporter2Options
    }
    serializeUserData(object: Object3D | Material | BufferGeometry, objectDef: any): void {

        const userData = object.userData
        const temp: any = {}
        if (userData.__disposed) {
            console.error('Serializing a disposed object', object)
        }
        Object.entries(userData).forEach(([key, value]: any) => {
            if (!value ||
                typeof value === 'function' ||
                value.isObject3D ||
                value.isTexture ||
                value.isMaterial ||
                value.assetType != null ||
                key.startsWith('_') || // private data

                key !== 'uuid' // always save uuid, even if its ignored
            ) {
                temp[key] = value
                delete userData[key]
            }
        })

        super.serializeUserData(object, objectDef)

        Object.entries(temp).forEach(([key, value]) => {
            userData[key] = value
            delete temp[key]
        })
    }

    processObjects(objects: Object3D[]) {
        if (objects.length === 1 && objects[0]?.userData.rootSceneModelRoot) {
            // objects[0].isScene = true
            this.processScene(objects[0])
            // delete objects[0].isScene
        } else
            super.processObjects(objects)
    }

    protected _defaultMaterial = new MeshStandardMaterial()

    /**
     * Checks for shader material and does the same thing...
     * @param material
     */
    processMaterial(material: Material): number|null {
        if (this.cache.materials.has(material)) return this.cache.materials.get(material)!

        let mat = material as any

        // set default material when material is null. shader material is processed further below for custom extensions like diamonds.
        if (!mat || mat.isShaderMaterial) mat = this._defaultMaterial

        const defIndex = super.processMaterial(mat)

        if (defIndex === null) {
            console.error('GLTFWriter2: Unexpected error: Failed to process material', material)
            return null
        }

        // when not a shader material
        if (!material || mat === material) return defIndex // todo: this line needds to be tested.

        // when shader material
        const defaultDef = JSON.stringify(this.json.materials[defIndex])
        const materialDef = JSON.parse(defaultDef) // for deep clone
        // console.log(defIndex, defaultDef, materialDef)

        this.serializeUserData(material, materialDef)

        this._invokeAll((ext)=>{
            ext.writeMaterial && ext.writeMaterial(material, materialDef)
        })

        // todo: test remove this
        // if (JSON.stringify(materialDef) === defaultDef) {
        //     return defIndex
        // }

        const index = this.json.materials.push(materialDef) - 1
        this.cache.materials.set(material, index)
        return index

    }

    /**
     * Same as processImage but for image blobs
     * @param blob
     * @param texture
     */
    processImageBlob(blob: Blob, texture: Texture) {
        if (!blob) return -1

        const cache = this.cache
        const options = this.options
        const pending = this.pending
        const json = this.json

        const image = texture.image

        if (!cache.images.has(image)) cache.images.set(image, {})

        const cachedImages = cache.images.get(image)
        const key = blob.type + ':flipY/' + texture.flipY.toString()

        if (cachedImages[ key ] !== undefined) return cachedImages[ key ]

        if (!json.images) json.images = []

        const imageDef: any = {mimeType: blob.type}

        if (options.binary === true) {

            pending.push(new Promise<void>((resolve)=>{

                this.processBufferViewImage(blob).then((bufferViewIndex: number)=>{

                    imageDef.bufferView = bufferViewIndex
                    resolve()

                })

            }))

        } else {

            pending.push(blobToDataURL(blob).then((dataURL: string)=>{
                imageDef.uri = dataURL
            }))

        }
        const index = json.images.push(imageDef) - 1
        cachedImages[ key ] = index
        return index


    }

    processSampler(map: Texture) {
        const samplerIndex = super.processSampler(map)

        // todo: uncomment when sampler extras supported by gltf-transform: https://github.com/donmccurdy/glTF-Transform/issues/645

        // const samplerDef = this.json.samplers[samplerIndex]
        // if (!samplerDef.extras) samplerDef.extras = {}
        // samplerDef.extras.uuid = map.uuid

        return samplerIndex

    }
    processTexture(map: Texture) {
        const cache = this.cache
        const json = this.json

        if (cache.textures.has(map)) return cache.textures.get(map)!

        const srcData = map.source.data
        const mimeType = map.userData.mimeType
        if (map.userData.rootPath &&
            !this.options.exporterOptions.embedUrlImages
            && (map.userData.rootPath.startsWith('http') || map.userData.rootPath.startsWith('data:'))
        ) {
            map.source.data = null // handled below in GLTFWriter2.processImage
            delete map.userData.mimeType // for extensions like ktx2
        }

        const processed = super.processTexture(map)

        const textureDef = json.textures[processed]
        if (!textureDef) {
            console.error('No texture def', processed, map)
            return processed
        }

        // if (!textureDef.extras) textureDef.extras = {}
        const imageDef = json.images ? json.images[textureDef.source] : null
        if (imageDef) {
            if (!imageDef.extras) imageDef.extras = {}
            if (map.source) imageDef.extras.uuid = map.source.uuid

            imageDef.extras.t_uuid = map.uuid // todo: remove when extras supported by gltf-transform: https://github.com/donmccurdy/glTF-Transform/issues/645
        }

        // map uuid saved in processSampler.

        if (map.userData.rootPath && !this.options.exporterOptions.embedUrlImages
            && (map.userData.rootPath.startsWith('http') || map.userData.rootPath.startsWith('data:'))
        ) {
            map.source.data = srcData
            map.userData.mimeType = mimeType
            if (!textureDef) {
                console.error('textureDef is null', processed, map)
                return processed
            }
            if (textureDef.source >= 0) {
                console.warn('textureDef.source is already set', processed, map)
            } else {
                textureDef.source = this.processImageUri(map.image, map.userData.rootPath, map.flipY, mimeType)
            }
        }
        if (textureDef.source < 0) {
            console.error('textureDef.source cannot be saved', textureDef, map)
        }

        return processed
    }

    // Add extra check for null images. This is set in processTexture when we have a rootPath
    processImage(image: any, format: PixelFormat, flipY: boolean, mimeType = 'image/png') {
        if (!image) return -1
        return super.processImage(image, format, flipY, mimeType)
    }

    /**
     * Used in GLTFWriter2.processTexture for rootPath. Note that this does not check for options.exporterOptions.embedUrlImages, it must be done separately.
     * @param image
     * @param uri
     * @param flipY
     * @param mimeType
     */
    processImageUri(image: any, uri: string, flipY: boolean, mimeType = 'image/png') {

        const cache = this.cache
        const json = this.json

        if (!cache.images.has(image)) cache.images.set(image, {})

        const cachedImages = cache.images.get(image)

        const key = mimeType + ':flipY/' + flipY.toString()

        if (cachedImages[ key ] !== undefined) return cachedImages[ key ]

        if (!json.images) json.images = []

        const imageDef: any = {
            mimeType, uri,
            extras: {flipY},
        }

        const index = json.images.push(imageDef) - 1
        cachedImages[ key ] = index
        return index

    }
}
