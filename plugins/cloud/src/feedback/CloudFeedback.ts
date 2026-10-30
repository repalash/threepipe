import type {ThreeViewer} from 'threepipe'
import {LogBuffer} from './LogBuffer'
import {collectEnvironment} from './environment'
import {Problem, ProblemGate, problemOf, ProblemKind} from './problems'
import {redactDeep} from './redact'
import {checkPayload, REPORT_TYPES, ReportCause, ReportFile, ReportJson, ReportPayload, ReportType, redactReport, sendReport} from './report'
import {renderTurnstile, TurnstileWidget} from './turnstile'
import {ensureStyles, h, resolveTheme, showToast, sizeLabel, Theme} from './ui'

/** What an app adds to a report (the modelling editor: mode, selection, undo history, the command transcript). */
export interface FeedbackContextProvider {
    /** The checkbox's text in the dialog: what this sends. */
    label: string
    /** Small JSON for `report.context[name]`. The worker takes 16 KB of context in all. */
    collect?(): unknown | Promise<unknown>
    /** A file sent with the report, e.g. a transcript. The files go up to 10 MB together. */
    file?(): ReportFile | null | Promise<ReportFile | null>
    /** Checked when the dialog opens. Default true. */
    checked?: boolean
}

export interface FeedbackOpenOptions {
    type?: ReportType
    /** Text to start with. */
    text?: string
    /** What the report is about: a problem from a toast or `reportError`, or a cause of the app's own. */
    cause?: ReportCause | Problem
    /** The dialog's title. Default by type: 'Report a problem', 'Ask a question', 'Send feedback'. */
    title?: string
}

/** What the dialog collected when it opened; the send and the preview use the same. */
interface Snapshot {
    image: string | null
    log: string[]
    environment: Record<string, unknown>
    contexts: {name: string, label: string, value: unknown, file: ReportFile | null, checked: boolean}[]
}

const TITLES: Record<ReportType, string> = {bug: 'Report a problem', question: 'Ask a question', idea: 'Send feedback'}
const PLACEHOLDERS: Record<ReportType, string> = {
    bug: 'What happened, and what did you expect? The steps to get there help most.',
    question: 'What would you like to know?',
    idea: 'What would make this better?',
}
const SCREENSHOT_MAX_SIDE = 1600

/**
 * `cloud.feedback`: Report a Problem / Send Feedback for any threepipe app.
 *
 * - `open()` shows the dialog: the type (bug, question, idea), the text, an optional email, and checkboxes
 *   for what goes with it (screenshot, log, environment, each app context, the scene as .glb — off by
 *   default, its size shown), the Turnstile check, Send; then the report's public id to copy.
 * - The page's warnings and errors are kept in a redacted ring buffer (`log`); uncaught errors, unhandled
 *   rejections and WebGL context loss are recorded as problems, and the person is told once per problem
 *   with a toast whose Report opens the dialog about it. `reportError` does the same for an app's failed
 *   operation. Nothing is sent without the person pressing Send.
 */
export class CloudFeedback {
    /** Where the reports come from: a short lower-case word ('modelling-editor', 'examples', …). */
    surface = 'app'
    /** The Turnstile site key of the worker's widget. Cloudflare's test key `1x00000000000000000000AA` always passes. */
    turnstileSiteKey?: string
    /** Where to load Turnstile from (tests route it to a stub). */
    turnstileScriptUrl?: string
    /** The dialog's and the toasts' colours. */
    theme: Theme = 'auto'
    /** Show this plugin's own toasts for problems. An app with its own toasts turns this off and listens to `problem`. */
    toasts = true
    /** Versions sent with a report, besides threepipe's: `{app: '1.2.0', …}`. */
    versions: Record<string, string> = {}
    /** The warnings and errors of the page, redacted. */
    readonly log = new LogBuffer()
    /** The last problems, newest last. */
    readonly problems: Problem[] = []
    /** Which problems become a toast: each once, five per session. */
    readonly gate = new ProblemGate(5)

    private _contexts = new Map<string, FeedbackContextProvider>()
    private _viewer?: ThreeViewer
    private _dialog: HTMLElement | null = null
    private _listeners: (() => void)[] = []

    constructor(private _endpoint: () => string | undefined, private _emit: (e: {type: 'problem', problem: Problem, notify: boolean} | {type: 'reportSent', id: string, report: ReportJson}) => void) {}

    // region setup

    /** @internal Called by ThreepipeCloudPlugin when it is added. */
    attach(viewer: ThreeViewer): void {
        this._viewer = viewer
        this.log.install()
        const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => {
            window.addEventListener(t, f)
            this._listeners.push(() => window.removeEventListener(t, f))
        }
        on('error', e => this._record('error', e.error ?? e.message))
        on('unhandledrejection', e => this._record('unhandled-rejection', e.reason))
        const canvas = viewer.canvas
        const lost = () => this._record('context-lost', 'The WebGL context was lost')
        canvas.addEventListener('webglcontextlost', lost)
        this._listeners.push(() => canvas.removeEventListener('webglcontextlost', lost))
    }

    /** @internal */
    detach(): void {
        for (const off of this._listeners.splice(0)) off()
        this.log.uninstall()
        this.close()
        this._viewer = undefined
    }

    /** Adds what the app knows to every report: `report.context[name]` and, optionally, a file. Returns the remover. */
    addContext(name: string, provider: FeedbackContextProvider | (() => unknown)): () => void {
        const p: FeedbackContextProvider = typeof provider === 'function' ? {label: name, collect: provider} : provider
        this._contexts.set(name, p)
        return () => { if (this._contexts.get(name) === p) this._contexts.delete(name) }
    }

    /** Any JSON with its strings redacted as a report's log is, at any depth up to `maxDepth`: for an app's own file (a transcript). */
    redactJson(value: unknown, maxDepth = 32): unknown {
        return redactDeep(value, undefined, 0, maxDepth)
    }

    // endregion

    // region problems

    /**
     * Records an app's failed operation (or any caught error) as a problem: in the log, in `problems`, and
     * — once per problem — a toast with Report. Returns the problem, for `open({cause: problem})`.
     */
    reportError(error: unknown, o: {kind?: ProblemKind, operation?: string, ext?: string} = {}): Problem {
        const reason = o.operation && !(error instanceof Error) ? `${o.operation}: ${String(error)}` : error
        return this._record(o.kind ?? 'operation', reason, o.ext)
    }

    private _record(kind: ProblemKind, reason: unknown, ext?: string): Problem {
        const p = problemOf(kind, reason, {ext})
        // A window error or rejection is already in the console's output; anything else is logged here.
        this.log.push('error', `${kind}: ${p.message}${p.frame ? ` (${p.frame})` : ''}`)
        this.problems.push(p)
        if (this.problems.length > 20) this.problems.shift()
        const shown = this.gate.admit(p)
        this._emit({type: 'problem', problem: p, notify: shown})
        if (shown && this.toasts && typeof document !== 'undefined') {
            showToast(`Something went wrong: ${p.message}`, this.theme, () => this.open({type: 'bug', cause: p}))
        }
        return p
    }

    // endregion

    // region collect and send

    /** The screenshot of the canvas as a JPEG data URL, at most 1600 px on its long side. */
    async screenshot(): Promise<string | null> {
        const v = this._viewer
        if (!v) return null
        try {
            const url = await v.getScreenshotDataUrl({mimeType: 'image/jpeg', quality: 0.85})
            if (!url) return null
            const img = new Image()
            img.src = url
            await img.decode()
            const scale = Math.min(1, SCREENSHOT_MAX_SIDE / Math.max(img.width, img.height))
            if (scale === 1) return url
            const c = document.createElement('canvas')
            c.width = Math.round(img.width * scale)
            c.height = Math.round(img.height * scale)
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
            return c.toDataURL('image/jpeg', 0.85)
        } catch (e) {
            this.log.push('warn', `feedback: the screenshot failed: ${(e as Error)?.message ?? e}`)
            return null
        }
    }

    /** The scene as a .glb, for a report that needs the model. */
    async sceneFile(): Promise<ReportFile | null> {
        const blob = await this._viewer?.exportScene({exportExt: 'glb'})
        return blob ? {name: 'scene.glb', blob} : null
    }

    private async _snapshot(): Promise<Snapshot> {
        const contexts: Snapshot['contexts'] = []
        for (const [name, p] of this._contexts) {
            let value: unknown = undefined
            let file: ReportFile | null = null
            try {
                value = await p.collect?.()
                file = (await p.file?.()) ?? null
            } catch (e) {
                value = {error: String((e as Error)?.message ?? e).slice(0, 200)}
            }
            contexts.push({name, label: p.label, value, file, checked: p.checked !== false})
        }
        return {image: await this.screenshot(), log: this.log.lines, environment: collectEnvironment(this._viewer), contexts}
    }

    /** The payload of a report: the draft, and what the checkboxes include, redacted. */
    buildPayload(draft: {type: ReportType, text: string, email?: string, cause?: ReportCause}, snap: Snapshot, include: {screenshot: boolean, log: boolean, environment: boolean, contexts: Record<string, boolean>, scene: ReportFile | null}): ReportPayload {
        const context: Record<string, unknown> = {}
        const files: ReportFile[] = []
        for (const c of snap.contexts) {
            if (!include.contexts[c.name]) continue
            if (c.value !== undefined) context[c.name] = c.value
            if (c.file) files.push(c.file)
        }
        if (include.scene) files.push(include.scene)
        const viewerVersion = (this._viewer?.constructor as {VERSION?: string} | undefined)?.VERSION
        const report: ReportJson = {
            type: draft.type,
            surface: this.surface,
            route: typeof location !== 'undefined' ? location.pathname : undefined,
            text: draft.text.trim(),
            email: draft.email?.trim() || undefined,
            cause: draft.cause ? {kind: draft.cause.kind, message: draft.cause.message, ext: draft.cause.ext, frame: draft.cause.frame} : undefined,
            versions: {...(viewerVersion ? {threepipe: viewerVersion} : {}), ...this.versions},
            environment: include.environment ? snap.environment : undefined,
            context: Object.keys(context).length ? context : undefined,
            log: include.log ? snap.log : undefined,
            image: include.screenshot && snap.image ? snap.image : undefined,
        }
        return {report: redactReport(report), files}
    }

    // endregion

    // region the dialog

    /** Closes the dialog, if one is open. */
    close(): void {
        this._dialog?.remove()
        this._dialog = null
    }

    get isOpen(): boolean {
        return !!this._dialog?.isConnected
    }

    /** Opens the dialog. Resolves with the report's id once sent, or null when it is closed without sending. */
    open(o: FeedbackOpenOptions = {}): Promise<string | null> {
        this.close()
        ensureStyles()
        return new Promise(resolve => this._buildDialog(o, resolve))
    }

    private _buildDialog(o: FeedbackOpenOptions, resolve: (id: string | null) => void): void {
        let type: ReportType = o.type ?? (o.cause ? 'bug' : 'idea')
        const cause: ReportCause | undefined = o.cause ? {kind: o.cause.kind, message: o.cause.message, ext: o.cause.ext, frame: o.cause.frame} : undefined
        const idempotencyKey = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '')
        let snap: Snapshot | null = null
        let scene: ReportFile | null = null
        let turnstile: TurnstileWidget | null = null
        let sending = false
        let done = false

        const finish = (id: string | null) => {
            turnstile?.remove()
            this.close()
            resolve(id)
        }

        // --- the form -------------------------------------------------------------------------
        const title = h('h2', {id: 'tpc-title'}, o.title ?? TITLES[type])
        const typeButtons = REPORT_TYPES.map(t => h('button', {type: 'button', 'data-tpc-type': t, 'aria-pressed': String(t === type)}, t === 'bug' ? 'Bug' : t === 'question' ? 'Question' : 'Idea'))
        const text = h('textarea', {id: 'tpc-text', 'data-tpc-text': true, maxlength: '10000', placeholder: PLACEHOLDERS[type]})
        text.value = o.text ?? ''
        const email = h('input', {id: 'tpc-email', type: 'email', 'data-tpc-email': true, autocomplete: 'email', placeholder: 'you@example.com'})
        const causeLine = cause?.message ? h('p', {class: 'tpc-note', 'data-tpc-cause': true}, `About: ${cause.message}`) : null

        const check = (key: string, label: string, checked: boolean, note?: Node | string) => {
            const input = h('input', {type: 'checkbox', 'data-tpc-attach': key, checked})
            const row = h('label', {}, input, h('span', {}, label, note ? h('br') : null, note ? h('small', {'data-tpc-note': key}, note) : null))
            return {input, row}
        }
        const shotImg = h('img', {class: 'tpc-shot', alt: 'The screenshot that goes with the report', hidden: true, 'data-tpc-shot': true})
        const shot = check('screenshot', 'Screenshot of the 3D view', true)
        const logC = check('log', 'Recent warnings and errors (redacted)', true, '…')
        const envC = check('environment', 'Browser, graphics card and threepipe versions', true)
        const sceneC = check('scene', 'The current scene as a .glb', false, 'Off by default: the model goes with the report.')
        const contextRows = h('div')
        const attach = h('fieldset', {class: 'tpc-attach'}, h('legend', {}, 'Send with it'), shot.row, shotImg, logC.row, envC.row, contextRows, sceneC.row)
        const previewPre = h('pre', {'data-tpc-preview-json': true})
        const preview = h('details', {class: 'tpc-preview', 'data-tpc-preview': true}, h('summary', {}, 'What will be sent'), previewPre)
        const turnstileBox = h('div', {class: 'tpc-turnstile', 'data-tpc-turnstile': true})
        const error = h('p', {class: 'tpc-error', role: 'alert', 'data-tpc-error': true, hidden: true})
        const cancel = h('button', {type: 'button', 'data-tpc-cancel': true}, 'Cancel')
        const download = h('button', {type: 'button', 'data-tpc-download': true, title: 'Save the report as a .json file instead, e.g. to attach it to a GitHub issue'}, 'Download')
        const send = h('button', {type: 'button', class: 'tpc-primary', 'data-tpc-send': true}, 'Send')
        const privacy = h('p', {class: 'tpc-note'}, 'Links, tokens, file paths and other people\'s emails are removed from the log before it leaves this page. Nothing is sent until you press Send.')

        const form = h('div', {},
            title, h('p', {class: 'tpc-sub'}, 'Goes to the threepipe team. You get an id to refer to it.'),
            h('div', {class: 'tpc-types', role: 'group', 'aria-label': 'Type'}, ...typeButtons),
            causeLine,
            h('div', {class: 'tpc-field'}, h('label', {for: 'tpc-text'}, 'Message'), text),
            h('div', {class: 'tpc-field'}, h('label', {for: 'tpc-email'}, 'Email (optional, if you want an answer)'), email),
            attach, preview, privacy, turnstileBox, error,
            h('div', {class: 'tpc-actions'}, download, h('span', {class: 'tpc-grow'}), cancel, send))
        const dialog = h('div', {class: 'tpc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tpc-title', 'data-tpc-dialog': true}, form)
        const root = h('div', {class: 'tpc-root tpc-backdrop'}, dialog)
        root.classList.toggle('tpc-dark', resolveTheme(this.theme) === 'dark')
        this._dialog = root
        document.body.appendChild(root)
        text.focus()

        // --- behaviour --------------------------------------------------------------------------
        const contextChecks = new Map<string, HTMLInputElement>()
        const include = () => ({
            screenshot: shot.input.checked, log: logC.input.checked, environment: envC.input.checked,
            contexts: Object.fromEntries([...contextChecks].map(([k, c]) => [k, c.checked])),
            scene: sceneC.input.checked ? scene : null,
        })
        const payload = () => snap ? this.buildPayload({type, text: text.value, email: email.value, cause}, snap, include()) : null
        const showError = (msg: string | null) => { error.hidden = !msg; error.textContent = msg ?? '' }
        const refresh = () => {
            const p = payload()
            const problem = p ? checkPayload(p) : null
            const needsCheck = !!this.turnstileSiteKey && !turnstile?.token
            send.disabled = sending || !snap || !!problem || !this._endpoint() || needsCheck || (!text.value.trim() && !cause)
            send.title = !this._endpoint() ? 'Reports are not set up on this page: Download saves the report instead'
                : !snap ? 'Collecting…' : problem ?? (needsCheck ? 'Waiting for the check below' : '')
            if (preview.open && p) {
                const {image, ...rest} = p.report
                previewPre.textContent = JSON.stringify({...rest, image: image ? `(${sizeLabel(Math.floor(image.length * 3 / 4))} JPEG)` : undefined,
                    files: p.files.map(f => `${f.name} (${sizeLabel(f.blob.size)})`)}, null, 2)
            }
        }
        for (const b of typeButtons) b.addEventListener('click', () => {
            type = b.getAttribute('data-tpc-type') as ReportType
            for (const x of typeButtons) x.setAttribute('aria-pressed', String(x === b))
            if (!o.title) title.textContent = TITLES[type]
            text.placeholder = PLACEHOLDERS[type]
            refresh()
        })
        for (const el of [text, email]) el.addEventListener('input', refresh)
        for (const c of [shot.input, logC.input, envC.input]) c.addEventListener('change', refresh)
        preview.addEventListener('toggle', refresh)
        sceneC.input.addEventListener('change', async() => {
            const note = sceneC.row.querySelector('small')!
            if (!sceneC.input.checked || scene) { note.textContent = scene ? sizeLabel(scene.blob.size) : 'Off by default: the model goes with the report.'; refresh(); return }
            note.textContent = 'Exporting…'
            sceneC.input.disabled = true
            try {
                scene = await this.sceneFile()
                note.textContent = scene ? sizeLabel(scene.blob.size) : 'Nothing to export.'
                if (!scene) sceneC.input.checked = false
            } catch (e) {
                note.textContent = `The export failed: ${(e as Error)?.message ?? e}`
                sceneC.input.checked = false
            }
            sceneC.input.disabled = false
            refresh()
        })
        cancel.addEventListener('click', () => finish(null))
        root.addEventListener('mousedown', e => { if (e.target === root && !sending) finish(null) })
        root.addEventListener('keydown', e => {
            e.stopPropagation() // the app's shortcuts stay out of the text fields
            if (e.key === 'Escape' && !sending) finish(null)
        })
        download.addEventListener('click', () => {
            const p = payload(); if (!p) return
            const a = h('a', {download: `threepipe-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`})
            a.href = URL.createObjectURL(new Blob([JSON.stringify({...p.report, files: p.files.map(f => ({name: f.name, size: f.blob.size}))}, null, 2)], {type: 'application/json'}))
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 30000)
        })
        send.addEventListener('click', async() => {
            const p = payload(), endpoint = this._endpoint()
            if (!p || !endpoint || sending || done) return
            sending = true
            send.textContent = 'Sending…'
            showError(null)
            refresh()
            try {
                const r = await sendReport(endpoint, p, {idempotencyKey, turnstileToken: turnstile?.token ?? undefined})
                done = true
                this._emit({type: 'reportSent', id: r.id, report: p.report})
                showSent(r.id)
            } catch (e) {
                showError((e as Error)?.message ?? String(e))
                // A Turnstile pass works once; a refused send needs a new one.
                turnstile?.reset()
            } finally {
                sending = false
                send.textContent = 'Send'
                if (!done) refresh()
            }
        })
        const showSent = (id: string) => {
            const copy = h('button', {type: 'button', 'data-tpc-copy': true}, 'Copy id')
            const close = h('button', {type: 'button', class: 'tpc-primary', 'data-tpc-close': true}, 'Close')
            copy.addEventListener('click', () => { void navigator.clipboard?.writeText(id).then(() => { copy.textContent = 'Copied' }) })
            close.addEventListener('click', () => finish(id))
            turnstile?.remove()
            turnstile = null
            form.replaceWith(h('div', {class: 'tpc-done', 'data-tpc-sent': true},
                h('h2', {}, 'Thank you, it is sent'),
                h('p', {class: 'tpc-sub'}, 'Mention this id if you write to us about it:'),
                h('div', {class: 'tpc-id', 'data-tpc-id': true}, id),
                h('div', {class: 'tpc-actions'}, copy, close)))
            close.focus()
        }

        refresh()
        // --- what goes with it, collected now: the view as it is when the person asked ---------------
        void this._snapshot().then(s => {
            if (!root.isConnected) return
            snap = s
            if (s.image) { shotImg.src = s.image; shotImg.hidden = false } else { shot.input.checked = false; shot.input.disabled = true }
            logC.row.querySelector('small')!.textContent = `${s.log.length} line${s.log.length === 1 ? '' : 's'}`
            for (const c of s.contexts) {
                const files = c.file ? `${c.file.name}, ${sizeLabel(c.file.blob.size)}` : undefined
                const row = check(`context:${c.name}`, c.label, c.checked, files)
                row.input.addEventListener('change', refresh)
                contextChecks.set(c.name, row.input)
                contextRows.appendChild(row.row)
            }
            refresh()
        })
        if (this.turnstileSiteKey) {
            renderTurnstile(turnstileBox, this.turnstileSiteKey, {theme: resolveTheme(this.theme), scriptUrl: this.turnstileScriptUrl, onChange: refresh})
                .then(w => { if (root.isConnected) turnstile = w; else w.remove(); refresh() })
                .catch(e => showError(`The check could not load: ${(e as Error)?.message ?? e}. Download saves the report instead.`))
        }
    }

    // endregion
}
