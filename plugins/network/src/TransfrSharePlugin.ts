import {AssetExporterPlugin, AViewerPluginSync, IObject3D, uiButton, uiFolderContainer, uiInput} from 'threepipe'

/**
 * Transfr Share Plugin
 * A sample plugin that provides helpers to export and upload scene to a server and get a shareable link.
 * It uses the options from the {@link AssetExporterPlugin} to export the scene or object, and can be configured using it's ui.
 *
 * Uses the free service [transfr.one](https://transfr.one/) by default which deletes the files after a certain time,
 * but the url can be changed to a custom backend or a self-hosted version of transfr.
 *
 * Note: since the uploaded files are publicly accessible by anyone by default, it is recommended to encrypt the file using the exporter options or use a secure backend.
 */
@uiFolderContainer('Share Link')
export class TransfrSharePlugin extends AViewerPluginSync {
    public static readonly PluginType = 'TransfrSharePlugin'

    toJSON: any = null
    enabled = true

    dependencies = [AssetExporterPlugin]

    @uiInput('Server URL')
        serverUrl = 'https://transfr.one/scene.glb'
    @uiInput()
        queryParam = 'm'
    @uiInput()
        pageUrl = window.location.href
    // @uiInput()
    rawSuffix = '?raw'
    processStateKey = 'transfr.one/scene.glb'

    baseUrls: Record<string, string> = {
        'editor': '',
        'viewer': '',
    }

    async exportObject(model?: IObject3D) {
        const exporter = this._viewer?.getPlugin(AssetExporterPlugin)
        if (!this._viewer) throw new Error('TransfrSharePlugin: AssetExporter not found')
        return model ?
            this._viewer.export(model, exporter?.exportOptions ?? {format: 'glb'}) :
            this._viewer.exportScene(exporter?.exportOptions ?? {})
    }

    /**
     * Export and get the link  of the 3d model or scene
     * @param model
     */
    async getLink(model?: IObject3D) {
        const obj = await this.exportObject(model)
        if (!obj) {
            throw new Error('Failed to export object or scene')
        }
        const path = this.processStateKey
        this._viewer!.assetManager.setProcessState(path, {
            state: 'Uploading',
            // progress: data.progress ? data.progress * 100 : undefined,
        })
        const res = await fetch(this.serverUrl, {
            method: 'PUT',
            body: obj,
        })
        if (res.status !== 200) {
            throw new Error('Failed to upload file')
        }
        const data = (await res.text())?.trim()
        this._viewer!.assetManager.setProcessState(path, undefined)
        // console.log(data)
        try {
            new URL(data)
        } catch (e) {
            throw new Error('Invalid URL ' + data)
        }
        return data + this.rawSuffix
    }
    private _exporting = false

    /**
     * Upload the scene and copy the link to clipboard along with the base url and query param if provided
     * @param base
     * @param param
     */
    async shareLink(base?: string|URL, param?: string) {
        if (this._exporting) return null
        this._exporting = true
        let link = await this.getLink().catch(e=>{
            this._viewer?.console.error(e)
            this._viewer?.dialog.alert('Error: Failed to share scene: \n' + e.message)
            return null
        })

        if (link) {
            if (base) {
                const url = typeof base === 'string' ?
                    new URL(this.baseUrls[base] ?? base) : base
                url.searchParams.set(param || this.queryParam || 'm', link)
                link = url.href
            }
            let copied = false
            try {
                if (window && window.navigator && navigator.clipboard) {
                    await navigator.clipboard.writeText(link)
                    copied = true
                }
            } catch (e) {
                console.error('Failed to copy link', e)
            }
            this._viewer?.dialog.alert('Link' + (copied ? ' Copied' : '') + ': ' + link + '\n\nNote: File will be deleted in 5-7 days')
        }
        this._exporting = false
        return link
    }

    @uiButton('Share editor link', (t: TransfrSharePlugin)=>({hidden: ()=>!t.baseUrls.editor}))
    async shareEditorLink() {
        return this.shareLink(this.baseUrls.editor, this.queryParam)
    }
    @uiButton('Share viewer link', (t: TransfrSharePlugin)=>({hidden: ()=>!t.baseUrls.viewer}))
    async shareViewerLink() {
        return this.shareLink(this.baseUrls.viewer, this.queryParam)
    }
    @uiButton('Share page link', (t: TransfrSharePlugin)=>({hidden: ()=>!t.pageUrl}))
    async sharePageLink() {
        return this.shareLink(this.pageUrl, this.queryParam)
    }
    @uiButton('Share glb link')
    async shareGlb() {
        return this.shareLink()
    }
}
