// The `./plugin` entry (ProceduralPlugin, the geometryNodes modifier, the nodeGroup command). It imports
// the core package by name, kept external, so both entries share one node registry.
import {defineConfig} from 'vite'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'

const globals = {
    'three': 'three',
    'threepipe': 'threepipe',
    '@threepipe/mesh-kernel': '@threepipe/mesh-kernel',
    '@threepipe/plugin-modelling': '@threepipe/plugin-modelling',
    '@threepipe/plugin-procedural': '@threepipe/plugin-procedural',
}

export default defineConfig({
    base: '',
    build: {
        sourcemap: true,
        minify: false,
        lib: {
            entry: 'src/plugin/index.ts',
            formats: isProd ? ['es', 'umd'] : ['es'],
            name: packageJson.name + '/plugin',
            fileName: (format) => (format === 'umd' ? 'plugin.js' : 'plugin.mjs'),
        },
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
            output: {globals},
            external: Object.keys(globals),
        },
    },
    plugins: [
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
