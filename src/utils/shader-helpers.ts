const warnEnabled = true

/**
 * Replace a string in a shader function with added options to prepend, append, show warning when not found, and replace all occurrences.
 * @param shader - shader code
 * @param str - string to replace
 * @param newStr - new string to replace with
 * @param replaceAll - replace all occurrences
 * @param prepend - prepend new string to old string
 * @param append - append new string to old string
 */
export function shaderReplaceString(shader: string, str: string, newStr: string, {
    replaceAll = false,
    prepend = false,
    append = false,
} = {}) {
    // todo: use safeReplaceString from ts-browser-helpers
    if (warnEnabled /* && ThreeViewer.ViewerDebugging */) {
        if (!shader.includes(str)) {
            console.error(`${str} not found in shader`)
            return shader
        }
    }
    let s = newStr
    if (prepend) {
        s = newStr + str
    } else if (append) {
        s = str + newStr
    }
    return replaceAll ? shader.replaceAll(str, s) : shader.replace(str, s)
}
