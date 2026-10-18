import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module} = packageJson

// The kernel stays external: a part is MeshData from @threepipe/mesh-kernel, shared with whoever builds it.
const globals = {
    '@threepipe/mesh-kernel': '@threepipe/mesh-kernel',
}

export default defineConfig({
    base: '',
    build: {
        sourcemap: true,
        minify: false,
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
        rollupOptions: {
            output: {
                globals,
            },
            external: Object.keys(globals),
        },
    },
    plugins: [
        // keep `@threepipe/*` imports as package names in the emitted types (tsconfig paths point at sibling dists)
        isProd ? dts({tsconfigPath: './tsconfig.json', aliasesExclude: [/^@threepipe\//]}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
