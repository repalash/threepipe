---
prev:
    text: '@threepipe/plugin-network'
    link: './plugin-network'

aside: false
---

# @threepipe/plugin-cloud

threepipe cloud for any threepipe app (`https://cloud.threepipe.org`; `services/cloud` in the repository, a
Cloudflare Worker with D1 and R2):

- `cloud.feedback` — **Report a Problem / Send Feedback**: a small dialog (bug, question or idea, the text, an
  optional email), what goes with the report (a screenshot, the page's warnings and errors, the browser and
  graphics card, the app's own context and files, the scene as `.glb` if asked), and a toast with **Report**
  when something goes wrong in the page.
  Reports go to your app's **project**; you read them at `https://cloud.threepipe.org/reports`.
- `cloud.auth` — **Sign in with threepipe**: the person approves your app once and it gets its own folder in their
  drive (`Apps/<your app>`). No app registration.
- `cloud.drive` — save, list, rename, move, share and load files in that folder.
- `cloud.share` — upload files and get a link anyone can open.

[Example](https://threepipe.org/examples/#cloud-feedback/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/cloud/src/index.ts) &mdash;
[Worker](https://github.com/repalash/threepipe/blob/master/services/cloud/README.md)

```bash
npm i @threepipe/plugin-cloud
```

```ts
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({
    project: 'my-app',                        // where reports go (create it at cloud.threepipe.org/reports)
    turnstileSiteKey: '0x4AAAA…',             // threepipe cloud's Turnstile widget, for people not signed in
    surface: 'editor',                        // where in the app reports come from
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

// Sign in with threepipe, then save to the person's drive (in your app's folder)
if (!cloud.auth.signedIn) cloud.auth.signIn()             // goes to threepipe cloud and comes back
const item = await cloud.drive.save('chair.glb', await viewer.exportScene())
await viewer.load(await cloud.drive.fileUrl(item.id))    // private: a signed URL (relative files load too)
const link = await cloud.drive.share(item.id)            // anyone with the link
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
- the Turnstile check for a person who is not signed in (its script loads only when the dialog opens; signed-in
  people skip it), Send, and the id to copy afterwards;
- Download, which saves the report as `.json` instead (also when no `project` is set).

## Errors

The plugin records, as problems: uncaught errors, unhandled rejections, a lost WebGL context, and what the app
passes to `reportError`. Each goes into the log, into `cloud.feedback.problems` and out as a `problem` event
(`{problem, notify}`); `notify` is true the first time a problem is seen, for at most five problems a
session (`cloud.feedback.gate`). The plugin's own toast (with Report) shows then, unless `toasts: false` — an
app with its own toasts listens to `problem` instead. A problem's `fingerprint`
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

- `new ThreepipeCloudPlugin({endpoint?, project?, surface?, turnstileSiteKey?, versions?, theme?, toasts?})`; `endpoint`
  defaults to `https://cloud.threepipe.org`.
- `cloud.feedback`: `open(o)`, `close()`, `addContext(name, provider)`, `reportError(error, {kind?, operation?, ext?})`,
  `log` (a `LogBuffer`), `problems`, `gate`, `screenshot()`, `sceneFile()`, `buildPayload(…)`, `redactJson(v)`.
- `cloud.auth`: `signIn({access?, prompt?, returnUrl?})`, `signOut()`, `signedIn`, `key`, `user`, `folder` (the app's
  folder id, or `*` with `access: 'drive'`). Pages on files.threepipe.org run sandboxed without storage: call `signIn()`
  on load there; once approved it comes straight back.
- `cloud.drive`: `save(name, blob, {folder?})`, `saveFolder(name, files, {folder?, entry?})`, `list(folder?)`, `resolve(path)`,
  `item(id)`, `read(id, path?)`, `rename`, `move`, `remove`, `share` / `unshare`, `newId` (every old URL stops working),
  `fileUrl(id, path?, ttl?)`, `newFolder(name, parent?)`. Each upload is an item with a fixed URL; names and folders are labels.
- `cloud.share`: `upload(files, {name?})` → `{url, id}`.
- Events on the plugin: `problem` `{problem, notify}`, `reportSent` `{id, report}`, `signIn` `{result}`.
- Pure helpers, also used by the tests: `redact`, `redactDeep`, `redactTokens`, `problemOf`, `fingerprint`,
  `checkPayload`, `buildRequest`, `sendReport`, `LIMITS`.

The limits are the worker's: text 10 000 characters, log 500 lines of 1000 characters, environment 8 KB,
context 16 KB, screenshot 3 MB, files 3 and 10 MB together.

## threepipe cloud

`services/cloud` in the repository: accounts (GitHub), projects and their reports, the drive, Sign in with threepipe,
uploads for agents and pull-request previews. Run it locally with `npm run dev:cloud` (port 8787); its README has the
API and the deploy steps.
