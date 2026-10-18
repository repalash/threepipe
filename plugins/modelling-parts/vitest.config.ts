import {defineConfig} from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    resolve: {
        alias: {
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
})
