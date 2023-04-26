const warnEnabled = true

export function shaderReplaceString(shader: string, str: string, newStr: string, {
    replaceAll = false,
    prepend = false,
    append = false,
} = {}) {
    // todo: use safeReplaceString from ts-browser-helpers
    if (warnEnabled) {
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
