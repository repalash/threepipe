/**
 * localStorage, or a store in memory where the page cannot use it: a sandboxed page (a pull-request build on
 * files.threepipe.org runs in an opaque origin) throws a SecurityError on any localStorage access.
 */
export const exampleStorage = (() => {
    try {
        const s = window.localStorage
        s.getItem('tp-storage-check')
        return s
    } catch {
        const m = new Map()
        return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k)}
    }
})()

// const scriptContents = {};
export function saveFile (path, content) {
    // scriptContents[path] = content
    exampleStorage.setItem('tp-pg-f-' + path, content);
}
export function getFile (path) {
    // if(scriptContents[path]) return scriptContents[path]
    const c = exampleStorage.getItem('tp-pg-f-' + path);
    // scriptContents[path] = c
    return c
}
