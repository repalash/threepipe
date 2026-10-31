/**
 * LoadingScreenPlugin unit tests: the file list markup and css. No layout engine here, so the tests check what the
 * layout depends on: every file is its own row (state, name and progress in separate elements), and the css keeps a
 * row on one line, truncates only the name and keeps the list inside the screen. The rendered layout at phone and
 * desktop widths was checked in a browser.
 */
import {afterAll, beforeAll, describe, expect, test} from 'vitest'
import {readFileSync} from 'node:fs'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

// the node test setup has a document stub without elements that the plugin can use
const doc = (globalThis as any).document
const createElement = doc.createElement
/** An element with the members that the plugin uses. */
function fakeElement(tagName: string) {
    return {
        tagName: tagName.toUpperCase(), id: '', innerHTML: '',
        style: {setProperty: () => undefined},
        classList: {add: () => undefined, remove: () => undefined, contains: () => false},
        prepend: () => undefined, appendChild: () => undefined, remove: () => undefined,
    }
}

beforeAll(async() => {
    // through the package entry: importing the plugin module alone runs into an import cycle
    tp = await import('../../index')
    doc.createElement = fakeElement
}, timeout)
afterAll(() => {
    doc.createElement = createElement
})

const files = new Map<string, {state: string, progress?: number}>([
    ['textures/map-normal-leather.jpg', {state: 'downloading', progress: 8}],
    ['https://example.com/hdr/env_metal_058_b_74127c4d30.exr', {state: 'downloading', progress: 44.4}],
    ['a&b.png', {state: 'adding'}],
])

/** The html of the file list for the process state. */
function filesHTML(options: Record<string, any> = {}) {
    const p = new tp.LoadingScreenPlugin()
    Object.assign(p, options)
    p._viewer = {}
    p._updateMainDiv(files, false)
    return {p, html: p.filesElement.innerHTML as string}
}

const entries = (html: string) => html.split('<div class="loadingScreenFileEntry">').slice(1).map(e => e.replace(/<\/div>$/, ''))
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
const span = (cls: string) => new RegExp(`<span class="${cls}">(.*?)</span>`)

/** The declarations of the css rule whose whole selector is `selector` (after a rule, a comment or the start). */
function rule(css: string, selector: string) {
    const m = css.match(new RegExp(`(?:^|\\}|\\*/)\\s*${selector.replace(/[.#]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    expect(m, selector).toBeTruthy()
    return (m?.[1] ?? '').replace(/\s+/g, ' ')
}

describe('LoadingScreenPlugin file list', {timeout}, () => {
    test('each file is one row element with the state, the name and the progress in separate elements', () => {
        const {html} = filesHTML()
        expect(html).not.toContain('<br>')
        const rows = entries(html)
        expect(rows.length).toBe(files.size)
        expect(rows.map(text)).toEqual([
            'downloading: map-normal-leather.jpg - 8%',
            'downloading: env_metal_058_b_74127c4d30.exr - 44%',
            'adding: a&b.png',
        ])
        expect(rows[1]).toMatch(span('loadingScreenFileState'))
        expect(rows[1]).toContain('<span class="loadingScreenProcessState">downloading</span>')
        expect(rows[1].match(span('loadingScreenFileName'))?.[1]).toBe('env_metal_058_b_74127c4d30.exr')
        expect(rows[1].match(span('loadingScreenFileProgress'))?.[1]).toBe(' - 44%')
        // names are escaped, and a file without progress has no progress element
        expect(rows[2].match(span('loadingScreenFileName'))?.[1]).toBe('a&amp;b.png')
        expect(rows[2]).not.toContain('loadingScreenFileProgress')
    })

    test('without process states and progress, a row has only the name', () => {
        const {html} = filesHTML({showProcessStates: false, showProgress: false})
        const rows = entries(html)
        expect(rows.length).toBe(files.size)
        expect(rows.map(text)).toEqual(['map-normal-leather.jpg', 'env_metal_058_b_74127c4d30.exr', 'a&b.png'])
        expect(rows.every(r => !r.includes('loadingScreenFileState') && !r.includes('loadingScreenFileProgress'))).toBe(true)
    })

    test('css: a row stays on one line, only the name is truncated, and the list fits the screen', () => {
        // read from the file: vitest does not process css, so the imported `styles` string is empty here
        const css = readFileSync(new URL('./LoadingScreenPlugin.css', import.meta.url), 'utf8')
        expect(rule(css, '.loadingScreenFilesElement')).toMatch(/max-width: 100%/)
        const row = rule(css, '.loadingScreenFileEntry')
        expect(row).toMatch(/display: grid/)
        // the name column has a min-content width of 0, so a long name does not widen the list or wrap the row
        expect(row).toMatch(/grid-template-columns: auto minmax\(0, auto\) auto/)
        expect(row).toMatch(/white-space: pre/)
        const name = rule(css, '.loadingScreenFileName')
        expect(name).toMatch(/overflow: hidden/)
        expect(name).toMatch(/text-overflow: ellipsis/)
        expect(rule(css, '.loadingScreenFileState')).toMatch(/grid-column: 1/)
        expect(name).toMatch(/grid-column: 2/)
        expect(rule(css, '.loadingScreenFileProgress')).toMatch(/grid-column: 3/)
    })
})
