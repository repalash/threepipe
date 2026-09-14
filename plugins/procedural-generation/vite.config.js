import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import fs from 'node:fs'
import path from 'node:path'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module, browser} = packageJson

const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
    '@threepipe/plugin-tweakpane': '@threepipe/plugin-tweakpane',
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
            formats: isProd && main !== module ? ['es', 'umd'] : ['es'],
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
                globals,
            },
            external: Object.keys(globals),
        },
    },
    plugins: [
        isProd ? dts({tsconfigPath: './tsconfig.json'}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
        // Create graph subpath re-export after build
        {
            name: 'graph-subpath',
            closeBundle() {
                const dir = path.resolve(__dirname, 'dist/graph')
                fs.mkdirSync(dir, {recursive: true})
                fs.writeFileSync(path.join(dir, 'index.mjs'), 'export * from "../index.mjs"\n')
            },
        },
    ],
})
