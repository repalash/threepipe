import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json';
import {commonPlugins, globalsReplacePlugin} from '../../scripts/vite-utils.mjs';
import react from '@vitejs/plugin-react'

const isProd = process.env.NODE_ENV === 'production'
const { name } = packageJson
const {main, module, browser} = packageJson

const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
    'uiconfig.js': 'threepipe',
    'ts-browser-helpers': 'threepipe',
    'react': 'react',
    'react-dom': 'react-dom',
    'react-dom/client': 'react-dom/client',
    'react/jsx-runtime': 'react/jsx-runtime',
    '@react-three/fiber': '@react-three/fiber',
}

export default defineConfig({
    optimizeDeps: {
        exclude: ['uiconfig.js', 'ts-browser-helpers'],
    },
    base: '',
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
            formats: ['es'],
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
                // inlineDynamicImports: false,
                globals,
            },
            external: Object.keys(globals),

        },
    },
    plugins: [
        react(),
        isProd ? dts({tsconfigPath: './tsconfig.json'}) : null,
        ...globalsReplacePlugin(globals, isProd),
        ...commonPlugins(packageJson, __dirname, isProd),
    ],
})
