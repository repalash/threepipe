const warnEnabled = true
const errorStr1 = 'shaderReplaceString: str must be passed if str is a RegExp and append/prepend is true'
/**
 * Replace a string in a shader function with added options to prepend, append, show warning when not found, and replace all occurrences.
 * @param shader - shader code
 * @param str - string to replace
 * @param newStr - new string to replace with
 * @param replaceAll - replace all occurrences
 * @param prepend - prepend new string to old string
 * @param append - append new string to old string
 * @param _str - optional string to use for replacement. This must be passed if str is a RegExp and append/prepend is true
 */
export function shaderReplaceString(shader: string, str: string|RegExp, newStr: string, {
    replaceAll = false,
    prepend = false,
    append = false,
    str: _str = undefined as string|undefined,
} = {}) {
    // todo: use safeReplaceString from ts-browser-helpers
    const isStr = typeof str === 'string'
    if (warnEnabled /* && ThreeViewer.ViewerDebugging */) {
        if (isStr ? !shader.includes(str) : !str.test(shader)) {
            console.error(`${str} not found in shader`)
            return shader
        }
    }
    let s = newStr
    _str = _str ?? (isStr ? str : undefined)
    if (prepend) {
        if (typeof _str !== 'string') throw new Error(errorStr1)
        s = newStr + _str
    } else if (append) {
        if (typeof _str !== 'string') throw new Error(errorStr1)
        s = _str + newStr
    }
    return replaceAll ? shader.replaceAll(str, s) : shader.replace(str, s)
}

// todo use in material extension?
// /**
//  * Regular expression for matching the `void main() {` opener line in GLSL.
//  * @type {RegExp}
//  */
// export const voidMainRegExp = /\bvoid\s+main\s*\(\s*\)\s*{/g
