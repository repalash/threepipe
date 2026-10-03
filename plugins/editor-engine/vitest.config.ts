import {defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

// Keymap parsing, the input router's dispatch rules and the redo-last round trip run in Node against
// fakes; threepipe's source needs the same handful of DOM globals the root suite provides. Anything
// needing a real viewer or a GPU belongs in the Playwright suite (`tests/interactive.spec.ts`).
export default defineConfig({
    // threepipe's source imports `.glsl`, so the same transform the root suite uses is needed here.
    // `createFilter` resolves a relative pattern against the cwd, which here is this package -
    // so the pattern has to be absolute to reach threepipe's shaders.
    plugins: [glsl({include: path.resolve(__dirname, '../../src') + '/**/*.glsl'})],
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../src/index.ts'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/plugin-mesh-edit': path.resolve(__dirname, '../mesh-edit/src/index.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        testTimeout: 10000,
    },
})
