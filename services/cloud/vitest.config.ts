import {defineConfig} from 'vitest/config'

// The worker runs in Miniflare (workerd, with local D1 and R2), bundled by esbuild in test/harness.ts.
// Outbound fetches (siteverify, Discord) go to a stub in the harness: nothing leaves the machine.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 30000,
        hookTimeout: 60000,
    },
})
