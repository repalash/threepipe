import {defineConfig} from 'vitest/config'
import path from 'node:path'

// The kernel is pure Node: no DOM polyfills, no viewer, no threepipe import.
// If a test here needs a browser global, that is a bug in the kernel, not in the test setup.
export default defineConfig({
    resolve: {
        alias: {
            'three': path.resolve(__dirname, '../../node_modules/three/'),
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        testTimeout: 10000,
    },
})
