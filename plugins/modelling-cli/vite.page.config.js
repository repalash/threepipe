import {defineConfig} from 'vite'
import path from 'node:path'

/**
 * The headless session page, bundled with everything it imports so the published CLI can serve it from
 * `dist/page/` with no other files. threepipe comes from its built bundle (`npm run build` at the root).
 */
export default defineConfig({
    root: path.resolve(__dirname, 'page'),
    base: './',
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../dist/index.mjs'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/modelling-parts': path.resolve(__dirname, '../modelling-parts/src/index.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, 'dist/page'),
        emptyOutDir: true,
        sourcemap: false,
        minify: true,
        target: 'es2022',
        chunkSizeWarningLimit: 4000,
    },
})
