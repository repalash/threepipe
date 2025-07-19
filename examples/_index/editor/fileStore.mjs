const scriptContents = {};
export function saveFile (path, content) {
    scriptContents[path] = content
    localStorage.setItem('tp-pg-f-' + path, content);
}
export function getFile (path) {
    if(scriptContents[path]) return scriptContents[path]
    scriptContents[path] = localStorage.getItem('tp-pg-f-' + path);
    return scriptContents[path]
}
