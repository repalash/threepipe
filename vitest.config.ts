import {configDefaults, defineConfig} from 'vitest/config'
import path from 'node:path'
import {glsl} from './scripts/vite-utils.mjs'

export default defineConfig({
    plugins: [
        glsl({include: 'src/**/*.glsl'}),
    ],
    resolve: {
        alias: [
            {find: 'threepipe', replacement: path.resolve(import.meta.dirname, './src/index.ts')},
            // the ES module: since three.js r186 the package's main (build/three.cjs) is a deprecated CommonJS stub that
            // re-exports it with require(esm), and an alias to the package folder resolved to main
            {find: /^three$/, replacement: path.resolve(import.meta.dirname, './node_modules/three/build/three.module.js')},
            {find: /^three\//, replacement: path.resolve(import.meta.dirname, './node_modules/three') + '/'},
        ],
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
