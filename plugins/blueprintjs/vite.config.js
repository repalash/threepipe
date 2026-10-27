import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json' with {type: 'json'};
import {commonPlugins, globalsReplacePlugin, fixDtsImports} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module, browser} = packageJson

const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
    'uiconfig.js': 'threepipe',
    'ts-browser-helpers': 'threepipe',
    // 'react': 'react',
    // 'react-dom': 'react-dom',
    // 'react-dom/client': 'react-dom/client',
    // 'react/jsx-runtime': 'react/jsx-runtime',
}

export default defineConfig({
    optimizeDeps: {
        exclude: ['uiconfig.js', 'ts-browser-helpers'],
    },
    base: '',
    resolve: {
        // Bundle this package's own copies: in the workspace, hoisted dependencies (react-uid, ...) resolve the root react 19
        dedupe: ['react', 'react-dom', 'tslib'],
    },
    // define: {
    //     'process.env': process.env
    // },
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
                // inlineDynamicImports: false,
                globals,
            },
            external: Object.keys(globals),

        },
    },
    plugins: [
        isProd ? dts({tsconfigPath: './tsconfig.json', afterBuild: fixDtsImports}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, import.meta.dirname, isProd),
    ],
})
