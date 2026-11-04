import {defineConfig} from 'vite'
import packageJson from './package.json' with {type: 'json'};
import path from 'node:path';
import {commonPlugins, globalsReplacePlugin, declarations} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module} = packageJson

const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
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
        watch: !isProd ? {
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
        rolldownOptions: {
            output: {
                globals,
            },
            external: Object.keys(globals),
        },
    },
    plugins: [
        isProd ? declarations() : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, import.meta.dirname, isProd),
    ],
})
