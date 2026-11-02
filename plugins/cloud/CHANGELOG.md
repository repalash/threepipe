# @threepipe/plugin-cloud Changelog

## 0.1.0

- Initial package: `ThreepipeCloudPlugin`, the client of threepipe cloud (https://cloud.threepipe.org, services/cloud).
  - `auth`: Sign in with threepipe (a key for the app's folder, or the whole drive), kept for the session.
  - `drive`: folders and items of the signed-in person's drive (`save`, `saveFolder`, `share`, `unshare`, `newId`, `remove`, …).
  - `share`: `upload` files as one drive item and get a link anyone can open.
  - `feedback`: the Report a problem dialog (bug, question, idea, other) with a screenshot, the scene, the redacted log
    around `console` and `ThreeViewer.Console`, the environment and `addContext` providers; toasts for problems with
    fingerprints, `reportError`. Signed-in reports skip Turnstile.
