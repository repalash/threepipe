import {defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

/**
 * Node unit tests for the `.blend` loader.
 *
 * The `js.blend` parser and `loader/meshData.ts` are both plain Node - no DOM, no three - so the
 * tests parse real `.blend` files rather than synthetic stand-ins. The repo's `tests/setup.ts`
 * polyfills are loaded anyway, because the bake round-trip test constructs three `BufferGeometry`
 * objects and three's module scope touches `ImageData`.
 *
 * Fixture `.blend` files are not in the repo (they are tens of megabytes); see `tests/README.md`.
 */
export default defineConfig({
    // `decompress.ts` imports `gunzipSync` from threepipe, which drags in the shader imports.
    plugins: [
        glsl({include: path.resolve(__dirname, '../../src') + '/**/*.glsl'}),
    ],
    resolve: {
        alias: {
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            'threepipe': path.resolve(__dirname, '../../src/index.ts'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
        include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        testTimeout: 30000,
    },
})
