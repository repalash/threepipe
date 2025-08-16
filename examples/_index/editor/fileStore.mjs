// const scriptContents = {};
export function saveFile (path, content) {
    // scriptContents[path] = content
    localStorage.setItem('tp-pg-f-' + path, content);
}
export function getFile (path) {
    // if(scriptContents[path]) return scriptContents[path]
    const c = localStorage.getItem('tp-pg-f-' + path);
    // scriptContents[path] = c
    return c
}
