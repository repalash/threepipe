import {defineConfig} from 'vitest/config'
import path from 'node:path'

// Like the kernel, this package is pure Node: no DOM, no viewer, no threepipe import outside `src/plugin`.
// A test that needs a browser global is a bug in the package, not in the test setup.
export default defineConfig({
    resolve: {
        alias: {
            'three': path.resolve(__dirname, '../../node_modules/three/'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            // `src/plugin` imports the package by name, so its bundle shares the core's node registry.
            '@threepipe/plugin-procedural': path.resolve(__dirname, 'src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        testTimeout: 20000,
    },
})
