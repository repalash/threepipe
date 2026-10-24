import {configDefaults, defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

export default defineConfig({
    plugins: [
        glsl({include: 'src/**/*.glsl'}),
    ],
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, './src/index.ts'),
            'three': path.resolve(__dirname, './node_modules/three/'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: [
            'src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
        ],
        exclude: [
            ...configDefaults.exclude,
            'experiments/**',
            '.claude/**',
            '.repos/**',
            'three.js-modded/**',
            'three-ts-types/**',
            'website/**',
            'examples/**',
            'plugins/**',
        ],
        reporters: process.env.CI ? ['verbose', 'junit'] : ['default'],
        outputFile: {
            junit: './test-results/junit.xml',
        },
        testTimeout: 10000,
    },
})
