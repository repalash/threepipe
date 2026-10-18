# @threepipe/plugin-cloud

threepipe's cloud features for any threepipe app, against one threepipe-cloud worker
([`services/cloud`](../../services/cloud)):

- `cloud.feedback` — Report a Problem / Send Feedback: a plain-DOM dialog (bug, question or idea, the text, an
  optional email), a screenshot, the page's redacted warnings and errors, the environment, the app's own
  context and files, the scene as `.glb` if asked; toasts with Report for uncaught errors, rejections, a lost
  WebGL context and `reportError`. Nothing is sent without the person pressing Send.
- `cloud.share` — upload files and get a URL (needs one of the worker's share tokens).

```ts
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({endpoint: 'https://cloud.example.com', turnstileSiteKey: '0x4AAAA…'}))
cloud.feedback.addContext('app', () => ({tool: app.tool}))
button.onclick = () => cloud.feedback.open({type: 'bug'})
```

See `website/package/plugin-cloud.md` for the API, the privacy rules and the limits.
