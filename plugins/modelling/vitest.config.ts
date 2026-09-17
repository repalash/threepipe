import {defineConfig} from 'vitest/config'
import path from 'node:path'

// The command layer depends on threepipe, which needs the same handful of DOM globals the root
// suite provides. Anything needing a real viewer belongs in the Playwright suite, not here.
export default defineConfig({
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../src/index.ts'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        testTimeout: 10000,
    },
})
