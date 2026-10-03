import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import react from '@vitejs/plugin-react'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module, browser} = packageJson

// React, Blueprint and uiconfig-blueprint are bundled; threepipe and the modelling plugins stay external.
// `uiconfig.js` and `ts-browser-helpers` are re-exported by threepipe, so the bundled uiconfig-blueprint
// shares one copy with the viewer (same trick as plugins/blueprintjs).
const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
    'uiconfig.js': 'threepipe',
    'ts-browser-helpers': 'threepipe',
    '@threepipe/mesh-kernel': '@threepipe/mesh-kernel',
    '@threepipe/plugin-mesh-edit': '@threepipe/plugin-mesh-edit',
    '@threepipe/plugin-modelling': '@threepipe/plugin-modelling',
    '@threepipe/plugin-editor-engine': '@threepipe/plugin-editor-engine',
}

export default defineConfig({
    optimizeDeps: {
        exclude: ['uiconfig.js', 'ts-browser-helpers'],
    },
    base: '',
    build: {
        sourcemap: true,
        minify: false,
        cssMinify: isProd,
        cssCodeSplit: false,
        watch: !isProd && process.argv.includes('--watch') ? {
            buildDelay: 1000,
        } : null,
        lib: {
            entry: 'src/index.ts',
            formats: isProd ? ['es', 'umd'] : ['es'],
            name: name,
            fileName: (format) => (format === 'umd' ? main : module).replace('dist/', ''),
        },
        outDir: 'dist',
        emptyOutDir: isProd,
        commonjsOptions: {
            exclude: [/uiconfig.js/, /ts-browser-helpers/],
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true, // one file, so the example importmap and the vite alias need no chunk paths
                globals,
            },
            external: Object.keys(globals),
        },
    },
    plugins: [
        react(),
        // entryRoot: the tsconfig paths reach into sibling packages, which would otherwise shift the output root
        isProd ? dts({tsconfigPath: './tsconfig.json', entryRoot: 'src'}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
