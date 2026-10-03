import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module, browser} = packageJson

// threepipe and the three modelling packages stay external; the engine bundles nothing of its own.
const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
    '@threepipe/mesh-kernel': '@threepipe/mesh-kernel',
    '@threepipe/plugin-mesh-edit': '@threepipe/plugin-mesh-edit',
    '@threepipe/plugin-modelling': '@threepipe/plugin-modelling',
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
                inlineDynamicImports: true,
                globals,
            },
            external: Object.keys(globals),
        },
    },
    plugins: [
        // entryRoot: the tsconfig paths reach into sibling packages, which would otherwise shift the output root
        isProd ? dts({tsconfigPath: './tsconfig.json', entryRoot: 'src'}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
