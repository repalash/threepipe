import {describe, expect, test} from 'vitest'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {exampleInfo} from '../../examples/examples-utils/example-info.mjs'

const page = {pathname: '/examples/ssao-plugin/', hostname: 'threepipe.org', title: 'SSAO Plugin', scripts: './script.ts;./script.js', imports: ['threepipe', '@threepipe/plugin-tweakpane']}

describe('exampleInfo', () => {
    test('links the source and the live example of master on threepipe.org', () => {
        const info = exampleInfo(page)!
        expect(info.name).toBe('ssao-plugin')
        expect(info.sourceUrl).toBe('https://github.com/repalash/threepipe/blob/master/examples/ssao-plugin/script.ts')
        expect(info.liveUrl).toBe('https://threepipe.org/examples/ssao-plugin/')
    })

    test('anywhere else links dev, where a new example already exists', () => {
        for (const hostname of ['dev.threepipe.org', 'files.threepipe.org', 'localhost', 'f415e77c.threepipe.pages.dev']) {
            const info = exampleInfo({...page, hostname})!
            expect(info.sourceUrl).toContain('/blob/dev/')
            expect(info.liveUrl).toBe('https://dev.threepipe.org/examples/ssao-plugin/')
        }
    })

    test('finds the example under a deeper path (a preview on the cloud)', () => {
        expect(exampleInfo({...page, pathname: '/b/threepipe/pr-12/examples/ssao-plugin/index.html'})!.name).toBe('ssao-plugin')
    })

    test('no button outside an example', () => {
        expect(exampleInfo({...page, pathname: '/examples/'})).toBeNull()
        expect(exampleInfo({...page, pathname: '/examples/index.html'})).toBeNull()
        expect(exampleInfo({...page, pathname: '/examples/_index/x'})).toBeNull()
        expect(exampleInfo({...page, pathname: '/guide/'})).toBeNull()
    })

    test('the prompt names the source files, not the file a build writes', () => {
        const {prompt} = exampleInfo(page)!
        expect(prompt).toContain('"SSAO Plugin"')
        expect(prompt).toContain('/master/examples/ssao-plugin/script.ts')
        expect(prompt).not.toContain('script.js')
        expect(prompt).toContain('Packages it uses: threepipe, @threepipe/plugin-tweakpane')
        expect(exampleInfo({...page, scripts: './App.svelte'})!.prompt).toContain('/examples/ssao-plugin/App.svelte')
    })

    test('View source opens the file the page lists, and the page itself when its code is inline', () => {
        expect(exampleInfo({...page, scripts: './script.tsx;./script.js'})!.sourceUrl).toMatch(/\/blob\/master\/examples\/ssao-plugin\/script\.tsx$/)
        expect(exampleInfo({...page, scripts: './App.svelte'})!.sourceUrl).toMatch(/\/App\.svelte$/)
        const inline = exampleInfo({...page, scripts: './index.html'})!
        expect(inline.sourceUrl).toMatch(/\/blob\/master\/examples\/ssao-plugin\/index\.html$/)
        expect(inline.prompt.match(/index\.html/g)).toHaveLength(1) // not listed twice
    })

    test('without data-scripts or a title it falls back to the folder and the name', () => {
        const {prompt, title, sourceUrl} = exampleInfo({...page, title: ' ', scripts: undefined, imports: undefined})!
        expect(title).toBe('ssao-plugin')
        expect(sourceUrl).toBe('https://github.com/repalash/threepipe/tree/master/examples/ssao-plugin')
        expect(prompt).toContain('Source: https://github.com/repalash/threepipe/tree/master/examples/ssao-plugin')
        expect(prompt).not.toContain('Packages it uses')
    })
})

describe('example pages', () => {
    // an agent that fetches a page gets no script: the head and the noscript are what point it to llms.txt
    test('each page links the instructions for agents', () => {
        // a folder without index.html is not a page (a build can leave a compiled script.js behind)
        const pages = readdirSync('examples', {withFileTypes: true}).filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'examples-utils')
            .map(d => `examples/${d.name}/index.html`).filter(p => existsSync(p))
        expect(pages.length).toBeGreaterThan(200)
        const missing = pages.filter(p => {
            const html = readFileSync(p, 'utf8')
            return !html.includes('<link rel="help" type="text/plain" href="../llms.txt"') || !html.includes('<noscript>')
        })
        expect(missing).toEqual([])
    })
})
