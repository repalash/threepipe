import {beforeAll, describe, expect, it, vi} from 'vitest'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {MathUtils} from 'three'
import type {ISceneEventMap} from 'threepipe'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60000)

describe('public declarations', () => {
    // npm ci/prepare builds these artifacts. Run npm run build after source edits.
    // The same fixture can be compiled in a consumer installed from npm pack.
    it('preserves custom scene events and a numeric lerp type under strict checking', () => {
        const testDirectory = path.dirname(fileURLToPath(import.meta.url))
        const root = path.resolve(testDirectory, '../..')
        const cache = path.join(root, 'node_modules/.cache')
        mkdirSync(cache, {recursive: true})
        const directory = mkdtempSync(path.join(cache, 'public-declarations-'))
        try {
            const consumer = path.join(directory, 'consumer.ts')
            writeFileSync(consumer, readFileSync(path.join(testDirectory, 'fixtures/public-declarations.ts.txt')))
            const program = ts.createProgram([consumer], {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                strict: true,
                skipLibCheck: false,
                noEmit: true,
                allowSyntheticDefaultImports: true,
                types: [],
                lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
            })
            const files = new Set([
                consumer,
                path.join(root, 'lib/core/object/RootScene.d.ts'),
                path.join(root, 'lib/utils/animation.d.ts'),
            ])
            for (const file of files) {
                expect(program.getSourceFile(file), `Missing public declaration: ${file}. Run npm run build.`).toBeDefined()
            }
            // This assertion targets the consumer and these two declarations.
            // The full packed-consumer check reports unrelated package diagnostics separately.
            const diagnostics = ts.getPreEmitDiagnostics(program)
                .filter(diagnostic => !diagnostic.file || files.has(path.resolve(diagnostic.file.fileName)))
                .map(diagnostic => `${diagnostic.file?.fileName}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
            expect(diagnostics).toEqual([])
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    }, 60000)

    it('delivers custom scene events and preserves listener removal', () => {
        const scene = new tp.RootScene<ISceneEventMap & {custom: {value: number}}>(new tp.PerspectiveCamera2())
        const listener = vi.fn(event => expect(event.target).toBe(scene))
        scene.addEventListener('custom', listener)
        scene.dispatchEvent({type: 'custom', value: 7})
        expect(listener).toHaveBeenCalledOnce()
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({type: 'custom', value: 7}))
        scene.removeEventListener('custom', listener)
        scene.dispatchEvent({type: 'custom', value: 8})
        expect(listener).toHaveBeenCalledOnce()
    })

    it('retains deprecated scene event warnings and registration', () => {
        const scene = new tp.RootScene(new tp.PerspectiveCamera2())
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            for (const [event, replacement] of [
                ['activeCameraChange', 'mainCameraChange'],
                ['activeCameraUpdate', 'mainCameraUpdate'],
                ['sceneMaterialUpdate', 'materialUpdate'],
                ['update', 'sceneUpdate'],
            ] as const) {
                const listener = vi.fn()
                scene.addEventListener(event, listener)
                expect(error).toHaveBeenLastCalledWith(`${event} is deprecated. Use ${replacement} instead.`)
                expect(scene.hasEventListener(event, listener)).toBe(true)
            }
            expect(error).toHaveBeenCalledTimes(4)
        } finally {
            error.mockRestore()
        }
    })

    it('retains the original lerp function and extrapolation behavior', () => {
        expect(tp.lerp).toBe(MathUtils.lerp)
        expect(tp.lerp(0, 10, 0.5)).toBe(5)
        expect(tp.lerp(0, 10, 2)).toBe(20)
    })
})
