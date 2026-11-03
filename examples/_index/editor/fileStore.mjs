// const scriptContents = {};
// localStorage, or undefined in a sandboxed page (an opaque origin), where any read of it throws: files are then not kept
const storage = (() => { try { return window.localStorage } catch { return undefined } })()
export function saveFile (path, content) {
    // scriptContents[path] = content
    storage?.setItem('tp-pg-f-' + path, content);
}
export function getFile (path) {
    // if(scriptContents[path]) return scriptContents[path]
    const c = storage?.getItem('tp-pg-f-' + path) ?? null;
    // scriptContents[path] = c
    return c
}
