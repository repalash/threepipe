import {AViewerPluginEventMap, type ThreeViewer} from '../../viewer/'
// noinspection ES6PreferShortImport
import {AViewerPluginSync} from '../../viewer/AViewerPlugin'
import {Dropzone} from '../../utils'
import {uiButton, uiConfig, uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {AddAssetOptions, ImportFilesOptions, ImportResult, ImportAddOptions, GLTFLoader2} from '../../assetmanager'
import {parseFileExtension, serialize} from 'ts-browser-helpers'

export interface DropzonePluginOptions {
    /**
     * The DOM element to attach the dropzone to.
     */
    domElement?: HTMLElement
    /**
     * Allowed file extensions. If undefined, all files are allowed.
     */
    allowedExtensions?: string[]
    /**
     * Automatically import assets when dropped.
     * @default true
     */
    autoImport?: boolean
    /**
     * Automatically add dropped and imported assets to the scene.
     * Works only if {@link autoImport} is true.
     * @default true
     */
    autoAdd?: boolean
    /**
     * Import options for the {@link AssetImporter.importFiles}, used when importing files.
     */
    importOptions?: ImportFilesOptions
    /**
     * Add options for the {@link RootScene.addObject}, used when adding assets to the scene.
     */
    addOptions?: AddAssetOptions
}

export interface DropzonePluginEventMap extends AViewerPluginEventMap{
    drop: {
        files: Map<string, File>
        imported?: Map<string, (ImportResult | undefined)[]>
        assets?: (ImportResult | undefined)[]
        nativeEvent: DragEvent
    }
}

/**
 * Dropzone Plugin
 *
 * Adds a dropzone to the viewer for importing assets.
 *
 * Automatically imports and adds assets to the scene, the behavior can be configured.
 * @category Plugins
 */
@uiFolderContainer('Dropzone')
export class DropzonePlugin extends AViewerPluginSync<DropzonePluginEventMap> {
    static readonly PluginType = 'Dropzone'
    declare uiConfig: UiObjectConfig
    @uiToggle() @serialize() enabled = true
    private _inputEl?: HTMLInputElement
    private _dropzone?: Dropzone
    private _allowedExtensions: string[]|undefined = undefined // undefined and empty array is different.

    /**
     * Automatically import assets when dropped.
     */
    @serialize() autoImport = true
    /**
     * Automatically add dropped and imported assets to the scene.
     * Works only if {@link autoImport} is true.
     */
    @uiToggle() @serialize() autoAdd = true

    /**
     * Import options for the {@link AssetImporter.importFiles}
     */
    @uiConfig() @serialize() importOptions: ImportFilesOptions = {
        autoImportZipContents: true,
        forceImporterReprocess: false,
        useMeshLines: GLTFLoader2.UseMeshLines,
        createUniqueNames: GLTFLoader2.CreateUniqueNames,
    }

    /**
     * Add options for the {@link RootScene.addObject}
     */
    @uiConfig() @serialize() addOptions: AddAssetOptions = {
        autoCenter: true,
        importConfig: true,
        autoScale: true,
        autoScaleRadius: 2,
        centerGeometries: false, // in the whole hierarchy
        centerGeometriesKeepPosition: true, // this centers while keeping world position
        license: '',
        clearSceneObjects: false,
        disposeSceneObjects: false,
        autoSetBackground: false,
        autoSetEnvironment: true,
    }

    /**
     * Allowed file extensions. If undefined, all files are allowed.
     */
    get allowedExtensions(): string[] | undefined {
        return this._allowedExtensions
    }

    set allowedExtensions(value: string[] | undefined) {
        this._allowedExtensions = value
        if (this._inputEl) this._inputEl.accept = value ? value.map(v=>'.' + v).join(', ') : ''
    }

    /**
     * Prompt for file selection using the browser file dialog.
     */
    @uiButton('Select Local files')
    public promptForFile(): void {
        if (this.isDisabled()) return
        this.allowedExtensions = this._allowedExtensions
        this._inputEl?.click()
    }

    /**
     * Prompt for file url.
     */
    @uiButton('Import from URL')
    public async promptForUrl(): Promise<void> {
        if (this.isDisabled() || !this._viewer) return
        const res = await this._viewer.dialog.prompt('Enter URL: Enter a public URL for a 3d file with extension', '', true)
        if (!res || !res.length) return
        await this.load(res, {}, true)
    }

    async load(res: string, options?: ImportAddOptions, dialog = false) {
        if (!this._viewer) {
            console.warn('DropzonePlugin: viewer not set')
            return
        }
        if (this.autoImport) {
            const manager = this._viewer.assetManager
            const ext = parseFileExtension(res)
            if (this._allowedExtensions && !this._allowedExtensions.includes(ext)) {
                dialog && await this._viewer.dialog.alert(`DropzonePlugin: file extension ${ext} not allowed`)
                return
            }
            const imported = await manager.importer.import(res, {
                ...this.importOptions,
                ...options ?? {},
            })
            const toAdd = [...imported ?? []].flat(2).filter(v => !!v) ?? []
            if (this.autoAdd) {
                return await manager.loadImported(toAdd, {
                    ...this.addOptions,
                    ...options ?? {},
                })
            }
            return toAdd
        } else {
            dialog && await this._viewer.dialog.alert('DropzonePlugin: autoImport is disabled, file was not imported')
        }
    }

    private _domElement?: HTMLElement
    constructor(options?: DropzonePluginOptions) {
        super()
        if (!options) return
        this._domElement = options.domElement
        this.allowedExtensions = options.allowedExtensions
        this.autoImport = options.autoImport ?? this.autoImport
        this.autoAdd = options.autoAdd ?? this.autoAdd
        this.importOptions = {...this.importOptions, ...options.importOptions}
        this.addOptions = {...this.addOptions, ...options.addOptions}
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._inputEl = document.createElement('input')!
        this._inputEl.type = 'file'
        if (!this._domElement) this._domElement = viewer.canvas
        this._dropzone = new Dropzone(this._domElement, this._inputEl, {
            drop: this._onFileDrop.bind(this),
        })
        this.allowedExtensions = this._allowedExtensions
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        this._dropzone?.destroy()
        this._dropzone = undefined
        this._inputEl = undefined
    }

    private async _onFileDrop({files, nativeEvent}: {files: Map<string, File>, nativeEvent: DragEvent}) {
        if (!files) return
        if (this.isDisabled()) return
        const viewer = this._viewer
        if (!viewer) return
        if (this._allowedExtensions !== undefined) {
            for (const file of files.keys()) {
                if (!this._allowedExtensions.includes(file.split('.').pop()?.toLowerCase() ?? '')) {
                    files.delete(file)
                }
            }
        }
        if (files.size < 1) return
        const manager = viewer.assetManager
        let imported: Map<string, (ImportResult | undefined)[]>|undefined
        let assets: (ImportResult | undefined)[]|undefined
        if (this.autoImport) {
            imported = await manager.importer.importFiles(files, {
                allowedExtensions: this.allowedExtensions, ...this.importOptions,
            })
            if (this.autoAdd) {
                const toAdd = [...imported?.values() ?? []].flat(2).filter(v=>!!v) ?? []
                assets = await manager.loadImported(toAdd, {...this.addOptions})
            }
        }
        this.dispatchEvent({type: 'drop', files, imported, assets, nativeEvent})
    }

}
