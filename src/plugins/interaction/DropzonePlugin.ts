import {AViewerPluginSync} from '../../viewer/AViewerPlugin'
import {type ThreeViewer} from '../../viewer/'
import {Dropzone} from '../../utils'
import {uiButton, uiConfig, uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import type {AddAssetOptions, ImportFilesOptions, ImportResult} from '../../assetmanager'
import {serialize} from 'ts-browser-helpers'

export interface DropzonePluginOptions {
    domElement?: HTMLElement
    allowedExtensions?: string[]
    autoImport?: boolean
    autoAdd?: boolean
    importOptions?: ImportFilesOptions
    addOptions?: AddAssetOptions
}
@uiFolderContainer('Dropzone')
export class DropzonePlugin extends AViewerPluginSync<'drop'> {
    static readonly PluginType = 'Dropzone'
    uiConfig!: UiObjectConfig
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
     Works only if {@link autoImport} is true.
     */
    @uiToggle() @serialize() autoAdd = true

    /**
     * Import options for the {@link AssetImporter.importFiles}
     */
    @uiConfig() @serialize() importOptions: ImportFilesOptions = {
        autoImportZipContents: true,
        forceImporterReprocess: false,
    }

    /**
     * Add options for the {@link RootScene.addObject}
     */
    @uiConfig() @serialize() addOptions: AddAssetOptions = {
        autoCenter: true,
        importConfig: true,
        autoScale: true,
        autoScaleRadius: 2,
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
    @uiButton('Select files')
    public promptForFile(): void {
        if (!this.enabled) return
        this.allowedExtensions = this._allowedExtensions
        this._inputEl?.click()
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
        if (!this.enabled) return
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
