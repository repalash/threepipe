import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import {fixDtsImports, glsl} from '../../scripts/vite-utils.mjs';
import packageJson from './package.json' with {type: 'json'};
import license from 'rollup-plugin-license';
import replace from '@rollup/plugin-replace';
import path from 'node:path';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson
const {main, module, browser} = packageJson

const globals = {
    'three': 'threepipe', // just incase someone uses three
    'threepipe': 'threepipe',
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
        replace({
            'from \'three\'': 'from \'threepipe\'',
            'from "three"': 'from \'threepipe\'', // TS sources reach this transform with double quotes (oxc)
            // 'from \'three/examples/jsm/.*\'': 'from \'threepipe\'', // todo regex doesnt work...
            'from \'three/examples/jsm/loaders/GLTFLoader.js\'': 'from \'threepipe\'',
            'from \'three/examples/jsm/postprocessing/Pass.js\'': 'from \'threepipe\'',
            'from \'three/examples/jsm/utils/BufferGeometryUtils.js\'': 'from \'threepipe\'',
            delimiters: ['', ''],
            preventAssignment: true,
        }),
        replace({ // this is added to throw an error, in that case, add it to above
            'from \'three/': 'from \'unknown/',
            delimiters: ['', ''],
            preventAssignment: true,
        }),
        replace({
            'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
            preventAssignment: true,
        }),
        glsl({ // todo: minify glsl.
            include: 'src/**/*.glsl',
        }),
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
        See ./dependencies.txt for any bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(import.meta.dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ],
})
