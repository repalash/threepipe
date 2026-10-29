import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json'
import {commonPlugins, fixDtsImports} from '../../scripts/vite-utils.mjs'

// A plain three.js library: three stays external, and the model worker is bundled into its own file,
// which the library starts with new Worker(new URL(..., import.meta.url)).
const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
    base: '',
    build: {
        sourcemap: true,
        minify: false,
        watch: !isProd ? {buildDelay: 1000} : null,
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: () => 'index.mjs',
        },
        outDir: 'dist',
        emptyOutDir: isProd,
        rollupOptions: {
            external: ['three'],
        },
    },
    worker: {
        format: 'es',
        rollupOptions: {output: {entryFileNames: 'motionbricks.worker.js'}},
    },
    plugins: [
        isProd ? dts({tsconfigPath: './tsconfig.json', afterBuild: fixDtsImports}) : null,
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
