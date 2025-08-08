import {defineConfig} from 'vite'
import json from '@rollup/plugin-json';
import dts from 'vite-plugin-dts'
import packageJson from './package.json';
import license from 'rollup-plugin-license';
import glsl from 'rollup-plugin-glsl';
import path from 'node:path';
import {globalsReplacePlugin} from './scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson
const {main, module, browser} = packageJson

const globals = {}

export default defineConfig({
    optimizeDeps: {
        exclude: ['uiconfig.js', 'ts-browser-helpers'],
    },
    // define: {
    //     'process.env': process.env
    // },
    build: {
        sourcemap: true,
        minify: isProd,
        cssMinify: isProd,
        cssCodeSplit: false,
        watch: !isProd ? {
            buildDelay: 1000,
        } : null,
        lib: {
            entry: 'src/index.ts',
            formats: isProd ? ['es', 'umd'] : ['es'],
            name: name,
            fileName: (format) => (format === 'umd' ? browser : module).replace('dist/', ''),
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
        isProd ? dts({tsconfigPath: './tsconfig.json'}) : null,
        ...globalsReplacePlugin(globals, isProd),
        glsl({ // todo: minify glsl.
            include: 'src/**/*.glsl',
        }),
        json(),
        // postcss({
        //     modules: false,
        //     autoModules: true,  // todo; issues with typescript import css, because inject is false
        //     inject: false,
        //     minimize: isProduction,
        //     // Or with custom options for `postcss-modules`
        // }),
        license({
            banner: `
        @license
        ${name} v${version}
        Copyright 2022<%= moment().format('YYYY') > 2022 ? '-' + moment().format('YYYY') : null %> ${author}
        ${packageJson.license} License
        See ./dependencies.txt for bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(__dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ],
})
