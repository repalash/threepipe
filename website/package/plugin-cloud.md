---
prev:
    text: '@threepipe/modelling-mcp'
    link: './modelling-mcp'

aside: false
---

# @threepipe/plugin-cloud

threepipe's cloud features for any threepipe app, against one **threepipe-cloud** worker
(`services/cloud` in the repository, a Cloudflare Worker with one D1 database and one R2 bucket):

- `cloud.feedback` — **Report a Problem / Send Feedback**: a small dialog (bug, question or idea, the text, an
  optional email), what goes with the report (a screenshot, the page's warnings and errors, the browser and
  graphics card, the app's own context and files, the scene as `.glb` if asked), and a toast with **Report**
  when something goes wrong in the page.
- `cloud.share` — upload files and get a URL back (for the team and their tools; it needs a share token).

[Example](https://threepipe.org/examples/#modelling-editor-feedback/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/cloud/src/index.ts) &mdash;
[Worker](https://github.com/repalash/threepipe/blob/master/services/cloud/README.md)

```bash
npm i @threepipe/plugin-cloud
```

```ts
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({
    endpoint: 'https://cloud.example.com',   // the threepipe-cloud worker
    turnstileSiteKey: '0x4AAAA…',             // the worker's Turnstile widget
    surface: 'my-app',                        // where reports come from
    versions: {app: '1.2.0'},
}))

// A "Report a problem" button of your own
button.onclick = () => cloud.feedback.open({type: 'bug'})

// What your app knows, in every report (JSON, and optionally a file)
cloud.feedback.addContext('app', {
    label: 'App state (the open document and the active tool)',
    collect: () => ({tool: app.tool, objects: app.count}),
    file: () => ({name: 'state.json', blob: new Blob([JSON.stringify(app.state)])}),
})

// A failed operation: in the log, and a toast with Report (once per problem)
try { await app.bevel() } catch (e) { cloud.feedback.reportError(e, {operation: 'Bevel'}) }

// Share files (with one of the worker's share tokens; never put one in source)
cloud.share.token = await askForToken()
const {url} = await cloud.share.upload(new File([html], 'index.html'), {slug: 'my-demo'})
```

## The dialog

`cloud.feedback.open({type?, text?, cause?, title?})` resolves with the report's public id (`R-7K3F9Q`) once it
is sent, or `null` when it is closed. It is plain DOM, styled with CSS custom properties on `.tpc-root`
(`--tpc-bg`, `--tpc-fg`, `--tpc-muted`, `--tpc-line`, `--tpc-field`, `--tpc-accent`, `--tpc-danger`,
`--tpc-radius`, `--tpc-font`); `theme` is `'light'`, `'dark'`, `'auto'` or a function. It shows:

- the type (Bug, Question, Idea), the message and an optional email;
- checkboxes for what goes with it: the screenshot of the canvas (a JPEG of at most 1600 px), the recent
  warnings and errors (redacted), the environment, one per `addContext` provider, and the current scene as
  `.glb` (off by default; its size is shown once exported);
- "What will be sent": the report JSON as it will leave the page;
- the Turnstile check (its script loads only when the dialog opens), Send, and the id to copy afterwards;
- Download, which saves the report as `.json` instead (also when no `endpoint` is set).

## Errors

The plugin records, as problems: uncaught errors, unhandled rejections, a lost WebGL context, and what the app
passes to `reportError`. Each goes into the log, into `cloud.feedback.problems` and out as a `problem` event
(`{problem, notify}`); `notify` is true the first time a problem is seen, for at most five problems a
session (`cloud.feedback.gate`). The plugin's own toast (with Report) shows then, unless `toasts: false` — an
app with its own toasts listens to `problem` instead, as the modelling editor does. A problem's `fingerprint`
is its kind, its message without numbers, quotes or paths, and its top frame's function name, so the same
problem from another build or another file is the same problem.

Nothing is sent automatically: a report always needs the person to press Send.

## Privacy

What leaves the page is redacted twice, here and again on the worker, by the same rules: URLs lose their
query and fragment, token shapes go (JWTs, Bearer/Basic credentials, `…token=…` pairs, known API key
formats), the user name in a home-folder path goes (`/Users/<user>/…`), and emails other than the sender's
own go. The person's own text keeps its words, links and emails and loses token shapes only. The log keeps
`console.warn` / `console.error` and `ThreeViewer.Console` output, never `console.log`. The environment has no
cookies, storage or history.

## API

- `new ThreepipeCloudPlugin({endpoint?, surface?, turnstileSiteKey?, versions?, theme?, toasts?})`
- `cloud.feedback`: `open(o)`, `close()`, `addContext(name, provider)`, `reportError(error, {kind?, operation?, ext?})`,
  `log` (a `LogBuffer`), `problems`, `gate`, `screenshot()`, `sceneFile()`, `buildPayload(…)`, `redactJson(v)`.
- `cloud.share`: `token`, `available`, `upload(files, {slug?, asset?, token?})` → `{url, slug?, files?, assets?}`.
- Events on the plugin: `problem` `{problem, notify}`, `reportSent` `{id, report}`.
- Pure helpers, also used by the tests: `redact`, `redactDeep`, `redactTokens`, `problemOf`, `fingerprint`,
  `checkPayload`, `buildRequest`, `sendReport`, `LIMITS`.

The limits are the worker's: text 10 000 characters, log 500 lines of 1000 characters, environment 8 KB,
context 16 KB, screenshot 3 MB, files 3 and 10 MB together.

## The worker

`services/cloud` (`threepipe-cloud`): `POST /reports` (a Turnstile pass, daily caps per sender and in total,
redaction, a Discord card without user text), `/staff` (a staff token: list, read, status, note, delete to a
tombstone, and a plain page), and `POST /share` (named shares updated in place by their owner, write-once
assets, `.md` files rendered for browsers). Run it locally with `npm run dev:cloud` (port 9389); its README has
the deploy steps.
