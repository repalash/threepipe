// Monaco's worker, started from this page's own origin (so the offline service worker serves its scripts too).
// Monaco's CDN folder: keep the version in step with MONACO_VERSION in editor.js. (Not read from the URL: offline,
// the saved copy of this file can answer without the query string, and a worker's location is its response's URL.)
const base = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/'
self.MonacoEnvironment = {baseUrl: base}
importScripts(base + 'vs/base/worker/workerMain.js')
