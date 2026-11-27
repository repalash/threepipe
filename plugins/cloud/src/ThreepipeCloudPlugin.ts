import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from 'threepipe'
import {CloudAuth} from './auth/CloudAuth'
import {CloudDrive} from './drive/CloudDrive'
import {CloudFeedback} from './feedback/CloudFeedback'
import type {Problem} from './feedback/problems'
import {reportsUrl} from './feedback/report'
import type {ReportJson} from './feedback/report'
import type {Theme} from './feedback/ui'
import {CloudShare} from './share/CloudShare'

export interface ThreepipeCloudPluginOptions {
    /** threepipe cloud (services/cloud). Default 'https://cloud.threepipe.org'. */
    endpoint?: string
    /**
     * The project the reports go to (create one at <endpoint>/reports). Unset: the dialog offers Download only.
     */
    project?: string
    /** Where reports come from: a short lower-case word ('modelling-editor', 'examples', …). */
    surface?: string
    /**
     * The Turnstile site key of threepipe cloud's widget, for people who are not signed in. It only works on the
     * hostnames of that widget (threepipe.org, files.threepipe.org); elsewhere, people sign in to report.
     * Cloudflare's test key '1x00000000000000000000AA' always passes.
     */
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
    /** The person came back from threepipe cloud: signed in, or denied. */
    signIn: {result: 'signed-in' | 'denied'}
}

/**
 * threepipe cloud for any threepipe app:
 * - `cloud.feedback`: Report a Problem / Send Feedback to the app's project: the dialog, what goes with a report
 *   (screenshot, redacted log, environment, app context), and error toasts with Report.
 * - `cloud.auth`: Sign in with threepipe; the app gets its own folder in the person's drive.
 * - `cloud.drive`: save, list, share files in that folder.
 * - `cloud.share`: upload files and get a link anyone can open.
 *
 * ```ts
 * const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({project: 'my-editor', turnstileSiteKey: '…'}))
 * cloud.feedback.addContext('app', () => ({mode: app.mode}))
 * button.onclick = () => cloud.feedback.open({type: 'bug'})
 * saveButton.onclick = async() => cloud.auth.signedIn ? cloud.drive.save('scene.glb', await viewer.exportScene()) : cloud.auth.signIn()
 * ```
 */
export class ThreepipeCloudPlugin extends AViewerPluginSync<ThreepipeCloudPluginEventMap> {
    public static readonly PluginType = 'ThreepipeCloudPlugin'
    enabled = true
    // Nothing of this plugin belongs in a scene file.
    toJSON: any = undefined

    /** threepipe cloud. */
    endpoint: string
    /** The project the reports go to. */
    project?: string
    readonly auth: CloudAuth
    readonly drive: CloudDrive
    readonly feedback: CloudFeedback
    readonly share: CloudShare

    constructor(options: ThreepipeCloudPluginOptions = {}) {
        super()
        this.endpoint = options.endpoint || 'https://cloud.threepipe.org'
        this.project = options.project
        this.auth = new CloudAuth(() => this.endpoint)
        this.drive = new CloudDrive(() => this.endpoint, this.auth)
        this.feedback = new CloudFeedback(() => this.project ? {url: reportsUrl(this.endpoint, this.project), key: this.auth.key} : undefined, e => this.dispatchEvent(e as never))
        if (options.surface) this.feedback.surface = options.surface
        this.feedback.turnstileSiteKey = options.turnstileSiteKey
        if (options.versions) this.feedback.versions = {...options.versions}
        if (options.theme) this.feedback.theme = options.theme
        if (options.toasts !== undefined) this.feedback.toasts = options.toasts
        this.share = new CloudShare(this.drive)
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this.feedback.attach(viewer)
        const result = this.auth.handleRedirect()
        if (result) this.dispatchEvent({type: 'signIn', result})
    }

    onRemove(viewer: ThreeViewer): void {
        this.feedback.detach()
        super.onRemove(viewer)
    }
}
