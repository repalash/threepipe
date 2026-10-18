import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from 'threepipe'
import {CloudFeedback} from './feedback/CloudFeedback'
import type {Problem} from './feedback/problems'
import type {ReportJson} from './feedback/report'
import type {Theme} from './feedback/ui'
import {CloudShare} from './share/CloudShare'

export interface ThreepipeCloudPluginOptions {
    /** The threepipe-cloud worker (services/cloud), e.g. 'https://cloud.threepipe.org'. Unset: the dialog offers Download only. */
    endpoint?: string
    /** Where reports come from: a short lower-case word ('modelling-editor', 'examples', …). */
    surface?: string
    /** The Turnstile site key of the worker's widget. Cloudflare's test key '1x00000000000000000000AA' always passes. */
    turnstileSiteKey?: string
    /** Versions sent with a report besides threepipe's, e.g. `{app: '1.2.0'}`. */
    versions?: Record<string, string>
    /** The dialog's and the toasts' colours. Default 'auto' (the system's). */
    theme?: Theme
    /** Show the plugin's own toasts for problems. Default true. */
    toasts?: boolean
}

export interface ThreepipeCloudPluginEventMap extends AViewerPluginEventMap {
    /** A problem was recorded: an uncaught error, a rejection, a lost WebGL context or `feedback.reportError`. */
    problem: {problem: Problem, /** True when the person should be told (the first time, within the session's limit). */ notify: boolean}
    /** A report was sent; `id` is its public id. */
    reportSent: {id: string, report: ReportJson}
}

/**
 * threepipe's cloud features, against one threepipe-cloud worker (`endpoint`):
 * - `cloud.feedback`: Report a Problem / Send Feedback — the dialog, what goes with a report (screenshot,
 *   redacted log, environment, app context), and error toasts with Report.
 * - `cloud.share`: upload files and get a URL (needs a share token).
 *
 * ```ts
 * const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({endpoint: 'https://cloud.threepipe.org', turnstileSiteKey: '…'}))
 * cloud.feedback.addContext('app', () => ({mode: app.mode}))
 * button.onclick = () => cloud.feedback.open({type: 'bug'})
 * ```
 */
export class ThreepipeCloudPlugin extends AViewerPluginSync<ThreepipeCloudPluginEventMap> {
    public static readonly PluginType = 'ThreepipeCloudPlugin'
    enabled = true
    // Nothing of this plugin belongs in a scene file.
    toJSON: any = undefined

    /** The threepipe-cloud worker. */
    endpoint?: string
    readonly feedback: CloudFeedback
    readonly share: CloudShare

    constructor(options: ThreepipeCloudPluginOptions = {}) {
        super()
        this.endpoint = options.endpoint
        this.feedback = new CloudFeedback(() => this.endpoint, e => this.dispatchEvent(e as never))
        if (options.surface) this.feedback.surface = options.surface
        this.feedback.turnstileSiteKey = options.turnstileSiteKey
        if (options.versions) this.feedback.versions = {...options.versions}
        if (options.theme) this.feedback.theme = options.theme
        if (options.toasts !== undefined) this.feedback.toasts = options.toasts
        this.share = new CloudShare(() => this.endpoint)
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this.feedback.attach(viewer)
    }

    onRemove(viewer: ThreeViewer): void {
        this.feedback.detach()
        super.onRemove(viewer)
    }
}
