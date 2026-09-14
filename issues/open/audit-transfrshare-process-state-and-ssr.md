# TransfrSharePlugin: process state stuck on 'Uploading' when upload fails + `pageUrl = window.location.href` crashes under SSR/Node

**Severity:** low
**Found:** 2026-06-13 code audit

Two small defects in TransfrSharePlugin.

## Bug 1 — process state never cleared on upload failure
```ts
this._viewer!.assetManager.setProcessState(path, {state: 'Uploading'})
const res = await fetch(this.serverUrl, {method: 'PUT', body: obj})
if (res.status !== 200) { throw new Error('Failed to upload file') }
const data = (await res.text())?.trim()
this._viewer!.assetManager.setProcessState(path, undefined)   // only on success path
try { new URL(data) } catch (e) { throw new Error('Invalid URL ' + data) }
```
The clearing call `setProcessState(path, undefined)` is only on the success path, not in a `finally`. On any failure (non-200, or invalid returned URL) the process state stays `'Uploading'` indefinitely, so the asset manager keeps showing an in-progress upload. `shareLink` catches the error for the alert but never clears the state either.
**Fix:** wrap the upload in try/finally and call `setProcessState(path, undefined)` in the `finally`.

## Bug 2 — `pageUrl = window.location.href` field initializer crashes under SSR/Node
```ts
@uiInput()
    pageUrl = window.location.href
```
This class field initializer is evaluated in the constructor; `window.location.href` read unconditionally at `new TransfrSharePlugin()` throws in Node when `window`/`window.location` is not polyfilled. threepipe is documented Node-safe with polyfill; unlike other plugins that guard `window` behind methods, this runs eagerly.
**Fix:** default `pageUrl = ''` and populate from `window.location.href` lazily in `onAdded`, guarded by `typeof window !== 'undefined'`.

## Files
- `plugins/network/src/TransfrSharePlugin.ts:54-74` — `getLink` clears process state only on success
- `plugins/network/src/TransfrSharePlugin.ts:27` — `pageUrl = window.location.href` eager field initializer
