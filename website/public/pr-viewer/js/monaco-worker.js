// Monaco's worker, started from this page's own origin (so the offline service worker serves its scripts too).
// `?base=` is Monaco's CDN folder (…/min/).
const base = new URL(self.location.href).searchParams.get('base')
if (!/^https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[\d.]+\/min\/$/.test(base || '')) throw new Error('Unexpected Monaco base')
self.MonacoEnvironment = {baseUrl: base}
importScripts(base + 'vs/base/worker/workerMain.js')
