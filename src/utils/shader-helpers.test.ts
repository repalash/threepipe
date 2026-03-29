import {describe, test, expect, vi} from 'vitest'
import {shaderReplaceString} from './shader-helpers'

describe('shaderReplaceString', () => {
    const shader = `
uniform vec3 uColor;
void main() {
    gl_FragColor = vec4(uColor, 1.0);
}
`

    test('replaces a string occurrence', () => {
        const result = shaderReplaceString(shader, 'uColor', 'vColor')
        expect(result).toContain('vColor')
        // only first occurrence replaced by default
        expect(result.indexOf('vColor')).toBeLessThan(result.lastIndexOf('uColor'))
    })

    test('replaceAll replaces all occurrences', () => {
        const result = shaderReplaceString(shader, 'uColor', 'vColor', {replaceAll: true})
        expect(result).not.toContain('uColor')
        expect(result.split('vColor').length).toBe(3) // 2 occurrences
    })

    test('prepend adds new string before the match', () => {
        const result = shaderReplaceString(shader, 'void main()', '// custom code\n', {prepend: true})
        expect(result).toContain('// custom code\nvoid main()')
    })

    test('append adds new string after the match', () => {
        const result = shaderReplaceString(shader, 'void main() {', '\n    // injected', {append: true})
        expect(result).toContain('void main() {\n    // injected')
    })

    test('returns shader unchanged when string not found (with warning)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = shaderReplaceString(shader, 'nonexistent', 'replacement')
        expect(result).toBe(shader)
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })

    test('replaces without warning when warn=false and string not found', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = shaderReplaceString(shader, 'nonexistent', 'replacement', {warn: false})
        // replaceAll with no match just returns the original string
        expect(result).toBe(shader)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    test('works with RegExp', () => {
        const result = shaderReplaceString(shader, /uniform\s+vec3\s+\w+;/, 'uniform vec4 vColor;')
        expect(result).toContain('uniform vec4 vColor;')
    })

    test('throws when prepend with RegExp and no _str provided', () => {
        expect(() => {
            shaderReplaceString(shader, /uColor/, 'prefix_', {prepend: true})
        }).toThrow('str must be passed')
    })

    test('prepend with RegExp works when _str is provided', () => {
        const result = shaderReplaceString(shader, /uColor/, 'prefix_', {prepend: true, str: 'uColor'})
        expect(result).toContain('prefix_uColor')
    })

    test('append with RegExp works when _str is provided', () => {
        const result = shaderReplaceString(shader, /uColor/, '_suffix', {append: true, str: 'uColor'})
        expect(result).toContain('uColor_suffix')
    })

    test('prepend takes priority when both prepend and append are true', () => {
        // Source code uses `if (prepend) ... else if (append)`, so prepend wins
        const result = shaderReplaceString(shader, 'void main()', '/* injected */', {prepend: true, append: true})
        // prepend: newStr + str = '/* injected */void main()'
        expect(result).toContain('/* injected */void main()')
        // append would produce 'void main()/* injected */' which should NOT be in the result
        // (the replacement only happens once, so the original 'void main()' is replaced)
    })

    test('empty shader string input', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = shaderReplaceString('', 'uColor', 'vColor')
        expect(result).toBe('')
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })

    test('empty shader string with warn=false', () => {
        const result = shaderReplaceString('', 'uColor', 'vColor', {warn: false})
        // String.replace on empty string with no match returns empty string
        expect(result).toBe('')
    })

    test('replaceAll combined with prepend', () => {
        const result = shaderReplaceString(shader, 'uColor', 'PREFIX_', {replaceAll: true, prepend: true})
        // prepend: s = newStr + str = 'PREFIX_uColor'
        // replaceAll: replaces all 'uColor' with 'PREFIX_uColor'
        expect(result).not.toContain(/(?<!PREFIX_)uColor/)
        const count = result.split('PREFIX_uColor').length - 1
        expect(count).toBe(2) // both occurrences replaced
    })

    test('replaceAll combined with append', () => {
        const result = shaderReplaceString(shader, 'uColor', '_SUFFIX', {replaceAll: true, append: true})
        // append: s = str + newStr = 'uColor_SUFFIX'
        // replaceAll: replaces all 'uColor' with 'uColor_SUFFIX'
        const count = result.split('uColor_SUFFIX').length - 1
        expect(count).toBe(2)
    })

    test('warn=false with string that IS found (normal replacement path)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = shaderReplaceString(shader, 'uColor', 'vColor', {warn: false})
        // When warn=false the warning check is skipped entirely, goes straight to replacement
        expect(result).toContain('vColor')
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })
})
