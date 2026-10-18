import {defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

// Redaction, fingerprints, the toast caps, the payload and the request run in Node against fakes. The dialog
// in a real page, against a local threepipe-cloud worker, is the `modelling-editor-feedback` Playwright test.
export default defineConfig({
    // threepipe's source imports `.glsl`; the pattern is absolute because createFilter resolves it against this package.
    plugins: [glsl({include: path.resolve(__dirname, '../../src') + '/**/*.glsl'})],
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../src/index.ts'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
        include: ['tests/**/*.test.ts'],
        testTimeout: 10000,
    },
})
