import {
    AViewerPluginSync,
    ThreeViewer,
    getUrlQueryParam,
    createScriptFromURL,
    IObject3D,
    ExportFileOptions, uiButton, uiToggle, PickingPlugin, uiFolderContainer,
} from 'threepipe'

interface AssimpJsInterface{
    [key: string]: any
}

/**
 * AssimpJsPlugin
 *
 * Helper plugin to load the assimp.js library from a CDN and provide a method to convert files using Assimp.js.
 *
 * Assimpjs - https://github.com/kovacsv/assimpjs
 * Fork with a custom build to support fbx export - https://github.com/repalash/assimpjs
 */
@uiFolderContainer('Assimp')
export class AssimpJsPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'SamplePlugin'
    enabled = true
    dependencies = []

    initOnAdd: boolean

    // public static LIBRARY_PATH = `https://cdn.jsdelivr.net/npm/assimpjs@${getUrlQueryParam('assimpjs', '0.0.10')}/`
    // adds fbx export support
    public static LIBRARY_PATH = `https://cdn.jsdelivr.net/gh/repalash/assimpjs@${getUrlQueryParam('assimpjs', 'main')}/`

    constructor(initOnAdd = true) {
        super()
        this.initOnAdd = initOnAdd
    }

    protected _scriptElement?: HTMLScriptElement
    private _initing: Promise<void>|undefined

    async init() {
        if (!this._initing) this._initing = this._init()
        await this._initing
        return this.ajs
    }
    private async _init() {
        if (!(window as any).assimpjs) {
            this._scriptElement = await createScriptFromURL(AssimpJsPlugin.LIBRARY_PATH + 'dist/assimpjs.js')
        }
        const ctor = (window as any).assimpjs
        const ajs = ctor ? await ctor({
            locateFile: (file: string) => AssimpJsPlugin.LIBRARY_PATH + 'dist/' + file,
            // print: (text: string) => console.log(text),
            // printErr: (text: string) => console.error(text),
            // onRuntimeInitialized: () => {
            //     console.log('Assimp.js initialized')
            //     this.viewer?.emit('assimpjs-initialized', ajs)
            // },
            // noExitRuntime: true,
        }) : null
        if (!ajs) {
            this._initing = undefined
            this._scriptElement?.remove()
            throw new Error('Failed to load Assimp.js library')
        }
        this.ajs = ajs

    }
    ajs?: AssimpJsInterface

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        if (this.initOnAdd) this.init()
    }

    // todo add ui config to export the scene, selected object as fbx or glb2 etc. or interface with the AssetExporter.

    convertFiles(files: Record<string, ArrayBuffer>, format: 'fbx'|'gltf2'|'glb2'|'assjson' = 'glb2') {
        const ajs = this.ajs
        if (!ajs) {
            console.error('Assimp.js is not initialized, wait for the promise like - `await assimpPlugin.init()`')
            return
        }
        const fileList = new ajs.FileList()
        for (const [name, content] of Object.entries(files)) {
            fileList.AddFile(name, new Uint8Array(content))
        }

        // convert file list to assimp json
        const result = ajs.ConvertFileList(fileList, format)

        // check if the conversion succeeded
        if (!result.IsSuccess() || result.FileCount() == 0) {
            // resultDiv.innerHTML = result.GetErrorCode()
            console.error(result.GetErrorCode())
            console.error(result)
            return
        }

        // get the result file, and convert to blob
        const resultFile = result.GetFile(0)
        const blob = new Blob([resultFile.GetContent()], {type: 'application/octet-stream'})
        return blob
    }

    async exportModel(format: 'fbx'|'gltf2'|'glb2'|'assjson' = 'glb2', object?: IObject3D, options: ExportFileOptions = {embedUrlImages: true}) {
        if (!this._viewer) {
            console.error('AssimpJsPlugin - No viewer attached, please add the plugin to a viewer instance.')
            return
        }
        const initing = this.init()
        const selected = this.exportSelected ? this._viewer.getPlugin(PickingPlugin)?.getSelectedObject<IObject3D>() : undefined
        object = object || (selected?.isObject3D ? selected : this._viewer.scene.modelRoot)

        // export to glb
        const blob = await this._viewer.export(object, options)
        if (!blob || blob.ext !== 'glb') {
            console.error('AssimpJsPlugin - Unable to export model, no blob returned.')
            return
        }
        await initing // wait for assimp.js to be initialized
        const blob2 = this.convertFiles({['file.glb']: await blob.arrayBuffer()}, format)
        if (!blob2) {
            console.error('AssimpJsPlugin - Unable to convert model to format:', format)
            return
        }
        // convert to ArrayBuffer
        return new File([blob2], 'model.' + format.replace(/2$/, ''), {type: 'application/octet-stream'})
    }

    @uiToggle('Export Selected')
        exportSelected = true

    @uiButton('Download FBX')
    async exportAsFbx(object?: IObject3D) {
        if (!object?.isObject3D) object = undefined
        const blob = await this.exportModel('fbx', object)
        if (blob) {
            await this._viewer?.exportBlob(blob, blob.name)
        }
    }
    @uiButton('Download Assimp JSON')
    async exportAsGlb(object?: IObject3D) {
        if (!object?.isObject3D) object = undefined
        const blob = await this.exportModel('assjson', object)
        if (blob) {
            await this._viewer?.exportBlob(blob, blob.name)
        }
    }
}
