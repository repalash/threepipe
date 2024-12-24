import {aesGcmDecrypt, aesGcmEncrypt, getOrCall} from 'ts-browser-helpers'
import {makeGLBFile} from '../../utils'
import {GLTFExporter2Options} from '../export'
import {GLTFBinaryExtension} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {GLTFPreparser} from '../import'

/**
 * Sample encryption processor for {@link GLTFExporter2} that wraps the glb in a new glb with encrypted content and encryption metadata.
 * Uses AES-GCM ({@link aesGcmEncrypt}) for encryption since it is widely supported across browsers and js environments.
 * @param gltf
 * @param options
 */
export const glbEncryptionProcessor = async(gltf: ArrayBuffer|any, options: GLTFExporter2Options) => {
    if (!gltf || !(gltf instanceof ArrayBuffer) || !gltf.byteLength || !options.encrypt) return gltf
    if (!options.encryptKey && window && window.prompt) {
        options.encryptKey = window.prompt('GLTFEncryption: Enter encryption key/password') || ''
    }
    if (!options.encryptKey) {
        console.warn('GLTF Export: encryption key not provided, skipping encryption')
        return gltf
    }
    const buffer = await aesGcmEncrypt(new Uint8Array(gltf), options.encryptKey)
    return makeGLBFile(buffer, {
        asset: {
            version: '2.0',
            generator: 'ThreePipeGLBWrapper',
            encryption: {
                type: 'aesgcm',
                version: 1,
            },
        },
    })
}

export interface IGLBEncryptionPreparser extends GLTFPreparser{
    key: string | ((encryption: any, json: any, path: string)=>string|Promise<string>)
}

/**
 * Sample encryption preparser for {@link GLTFLoader2} that unwraps the glb container and decrypts the content. The encryption key can be provided in the file or set in this const is prompted from the user.
 */
export const glbEncryptionPreparser: IGLBEncryptionPreparser = {
    key: (encryption: any, _: any, path: string) => {
        return encryption.key || window && window.prompt && window.prompt('GLTFEncryption: Please enter the password/key for the model: ' + path) || ''
    },
    async process(data: string | ArrayBuffer, path: string) {
        if (typeof data === 'string') return data
        const prefixBytes = 100
        const prefix = new TextDecoder().decode(new Uint8Array(data, 0, prefixBytes))
        if (!prefix.includes('GLBWrapper')) return data
        const binaryExtension = new GLTFBinaryExtension(data)
        const json = JSON.parse(binaryExtension.content || '{}')
        let data2 = binaryExtension.body || data
        const encryption = json.asset?.encryption
        if (!encryption) return data2
        const type = encryption.type
        const version = encryption.version
        if (type === 'aesgcm' && version === 1) {
            const key = await getOrCall(this.key, encryption, json, path) || ''
            try {
                data2 = (await aesGcmDecrypt(new Uint8Array(data2), key)).buffer
            } catch (e) {
                throw new ErrorEvent('decryption error')
            }
        }
        return data2
    },
}
