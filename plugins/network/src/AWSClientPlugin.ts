import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    FileTransferPlugin,
    pathJoin,
    serialize,
    ThreeViewer,
    timeout,
    uiButton,
    uiFolderContainer,
    uiInput,
    UiObjectConfig,
    uiToggle,
} from 'threepipe'
import {AwsClient, AwsV4Signer} from 'aws4fetch'

export interface AWSClientPluginEventMap extends AViewerPluginEventMap {
    fileUpload: {
        name: string
        blob: Blob
        response: Response
        path: string
    }
}

/**
 * AWSClientPlugin
 * Provides `fetch` function that performs a fetch request with AWS v4 signing.
 * This is useful for connecting to AWS services like S3 directly from the client.
 * It also interfaces with the {@link FileTransferPlugin} to directly upload file when exported with the viewer or the plugin.
 * Note: Make sure to use keys with limited privileges and correct CORS settings.
 * All the keys will be stored in plain text if `serializeSettings` is set to `true` (default = `false`).
 *
 * {@todo Make an example for AWSClient Plugin}
 */
@uiFolderContainer('AWS/S3 Client')
export class AWSClientPlugin extends AViewerPluginSync<AWSClientPluginEventMap> {
    static readonly PluginType = 'AWSClientPlugin1'
    declare uiConfig: UiObjectConfig

    enabled = true
    private _connected = false

    // do not serialize in exported file.
    readonly serializeWithViewer = false

    private _client: AwsClient | undefined

    dependencies = [FileTransferPlugin]

    constructor() {
        super()
    }

    @serialize()
    @uiInput('Access Key ID', (t: AWSClientPlugin)=>({
        disabled: ()=>!t.enabled || t._connected,
    }))
        accessKeyId = ''

    @serialize()
    @uiInput('Access Key Secret', (t: AWSClientPlugin)=>({
        disabled: ()=>!t.enabled || t._connected,
    }))
        accessKeySecret = ''

    @serialize()
    @uiInput('Endpoint URL', (t: AWSClientPlugin)=>({
        disabled: ()=>!t.enabled || t._connected,
    }))
        endpointURL = ''

    @serialize()
    @uiInput('Path Prefix', (t: AWSClientPlugin)=>({
        disabled: ()=>!t.enabled,
    }))
        pathPrefix = 'webgi'

    @serialize()
    @uiToggle('Remember', (t: AWSClientPlugin)=>({
        disabled: ()=>!t.enabled || t._connected,
    }))
        serializeSettings = false

    @uiButton(undefined, (t: AWSClientPlugin)=>({
        label: ()=>t._connected ? 'Disconnect' : 'Connect',
    }))
        toggleConnection = ()=>{
            if (this._connected) {
                this.disconnect()
            } else {
                this.connect()
            }
        }

    /**
     * Set to true to use a proxy for all requests.
     * This can be used to move the access credentials to the server side or set custom headers.
     * This is required for some services like cloudflare R2 that do not support CORS.
     * usage: `AWSClientPlugin.USE_PROXY = true`, optionally set `AWSClientPlugin.PROXY_URL` to a custom proxy.
     */
    static USE_PROXY = false
    static PROXY_URL = 'https://r2-s3-api.repalash.com/{path}'

    connect() {

        if (this._connected) this.disconnect()
        this._client = new AwsClient({
            accessKeyId: this.accessKeyId,
            secretAccessKey: this.accessKeySecret,
        })
        this._connected = true

        this.refreshUi()

    }

    refreshUi() {
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    disconnect() {

        this._client = undefined
        this._connected = false
        this.refreshUi()

    }

    get connected(): boolean {
        return this._connected
    }
    get client(): AwsClient | undefined {
        return this._client
    }

    toJSON(meta?: any): any {
        if (!this.serializeSettings) return {type: (this as any).constructor.PluginType}
        return super.toJSON(meta)
    }

    private _savedExportFile?: FileTransferPlugin['defaultActions']['exportFile']
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        const tr = viewer.getPlugin(FileTransferPlugin)!
        this._savedExportFile = tr.actions.exportFile || tr.defaultActions.exportFile
        if (!this._savedExportFile) throw new Error('FileTransferPlugin must have exportFile action')
        tr.actions.exportFile = this.exportFile
    }
    onRemove(viewer: ThreeViewer) {
        const tr = viewer.getPlugin(FileTransferPlugin)!
        tr.actions.exportFile = this._savedExportFile!
        this._savedExportFile = undefined
        super.onRemove(viewer)
    }

    exportFile: FileTransferPlugin['defaultActions']['exportFile'] = async(blob, name, onProgress)=>{
        const viewer = this._viewer
        if (!viewer) return
        const tr = viewer.getPlugin(FileTransferPlugin)
        if (!tr) return
        const defaultExport = this._savedExportFile ?? tr.defaultActions.exportFile
        if (!this._connected) {
            await defaultExport(blob, name)
            return
        }
        const path = pathJoin([this.endpointURL, this.pathPrefix, name])
        const response = await this.fetch(path, {
            method: 'PUT',
            body: blob,
        }, onProgress)
        if (!response.ok) {
            viewer.console.error('Error uploading file', response)
            await defaultExport(blob, name)
            return
        }
        this.dispatchEvent({type: 'fileUpload', name, blob, response, path})
        viewer.console.log('File uploaded', response)
    }

    fetchFunction = fetch
    async fetch(input: RequestInfo, init: RequestInit, _onProgress?: (d: {state?: string, progress?: number})=>void) {
        if (!this._client) throw new Error('Not connected')
        for (let i = 0; i <= this._client.retries; i++) {

            // todo: add onProgress (using futch in dom.ts?): https://github.com/github/fetch/issues/89

            const signed = await sign2(this._client, input, init)
            let url = signed.url.toString()

            if (AWSClientPlugin.USE_PROXY && url && !url.includes(AWSClientPlugin.PROXY_URL)) {
                // const options: RequestInit = {
                //     headers: signed.headers,
                //     method: signed.method,
                //     body: signed.body,
                //     // ts-expect-error this is a valid option
                //     // duplex: 'half', // todo; get from request?
                // }

                // https://github.com/sindresorhus/ky/blob/2af72bfa7a391662a8ee6b1671979069f7f20737/source/core/Ky.ts#L176
                // https://issues.chromium.org/issues/40237822
                // if (supportsRequestStreams) {
                //     // @ts-expect-error - Types are outdated.
                //     options.duplex = 'half'
                // }
                url = AWSClientPlugin.PROXY_URL.replace('{path}', url)
            }

            // try {
            //     signed = new Request(url, options)
            // } catch (e) {
            //     if (e instanceof TypeError) {
            //         // https://bugs.chromium.org/p/chromium/issues/detail?id=1360943
            //         signed = new Request(url, Object.assign({duplex: 'half'}, options))
            //     } else throw e
            // }

            const f = this.fetchFunction // required to first put it in a variable and then call.
            const fetched = f(url, signed)
            if (i === this._client.retries) {
                return fetched // No need to await if we're returning anyway
            }
            const res = await fetched
            if (res.status < 500 && res.status !== 429) {
                return res
            }
            await timeout(Math.random() * this._client.initRetryMs * Math.pow(2, i))
        }
        throw new Error('An unknown error occurred, ensure retries is not negative')
    }

}

export type AwsRequestInit = RequestInit & {
    aws?: {
        accessKeyId?: string | undefined;
        secretAccessKey?: string | undefined;
        sessionToken?: string | undefined;
        service?: string | undefined;
        region?: string | undefined;
        cache?: Map<string, ArrayBuffer> | undefined;
        datetime?: string | undefined;
        signQuery?: boolean | undefined;
        appendSessionToken?: boolean | undefined;
        allHeaders?: boolean | undefined;
        singleEncode?: boolean | undefined;
    } | undefined;
}

export async function sign2(client: AwsClient, input: RequestInfo, init?: AwsRequestInit) {
    if (input instanceof Request) {
        const {method, url, headers, body} = input
        init = Object.assign({method, url, headers}, init)
        if (init.body == null && headers.has('Content-Type')) {
            init.body = body != null && headers.has('X-Amz-Content-Sha256') ? body : await input.clone().arrayBuffer()
        }
        input = url
        console.warn('There could be a bug in chrome with cloning Request objects, see https://bugs.chromium.org/p/chromium/issues/detail?id=1360943')
    }
    const signer = new AwsV4Signer(Object.assign({url: input}, init, client, init && init.aws))
    const signed = Object.assign({}, init, await signer.sign())
    delete signed.aws
    return signed
    // try {
    //     return new Request(signed.url.toString(), signed)
    // } catch (e) {
    //     if (e instanceof TypeError) {
    //         // https://bugs.chromium.org/p/chromium/issues/detail?id=1360943
    //         return new Request(signed.url.toString(), Object.assign({duplex: 'half'}, signed))
    //     }
    //     throw e
    // }
}

// https://github.com/sindresorhus/ky/blob/main/source/core/constants.ts
// https://issues.chromium.org/issues/40237822
// todo: right now we are using try catch like in aws4fetch
// export const supportsRequestStreams = (() => {
//     let duplexAccessed = false
//     let hasContentType = false
//     const supportsReadableStream = typeof globalThis.ReadableStream === 'function'
//     const supportsRequest = typeof globalThis.Request === 'function'
//
//     if (supportsReadableStream && supportsRequest) {
//         hasContentType = new globalThis.Request('https://empty.invalid', {
//             body: new globalThis.ReadableStream(),
//             method: 'POST',
//             // @ts-expect-error - Types are outdated.
//             get duplex() {
//                 duplexAccessed = true
//                 return 'half'
//             },
//         }).headers.has('Content-Type')
//     }
//
//     return duplexAccessed && !hasContentType
// })()
