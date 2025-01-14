// rollup.config.js
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import license from 'rollup-plugin-license'
import packageJson from './package.json' with {type: 'json'};
import path from 'path'
import {fileURLToPath} from 'url';
import postcss from 'rollup-plugin-postcss'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {name, version, author} = packageJson
// const {main, module, browser} = packageJson["clean-package"].replace
const isProduction = process.env.NODE_ENV === 'production'

const settings = {
    globals: {
        'three': 'threepipe', // just incase someone uses three
        'threepipe': 'threepipe',
        '@threepipe/plugin-tweakpane': '@threepipe/plugin-tweakpane',
    },
    sourcemap: true,
}

export default {
    input: './src/index.ts',
    output: [
        //     {
        //   file: main,
        //   name: main,
        //   ...settings,
        //   format: 'cjs',
        //   plugins: [
        //     isProduction && terser()
        //   ]
        // },
        {
            file: './dist/index.mjs',
            ...settings,
            name: name,
            format: 'es',
            plugins: [
                isProduction && terser(),
            ],
        },
        {
            file: './dist/index.js',
            ...settings,
            name: name,
            format: 'umd',
            plugins: [
                isProduction && terser(),
            ],
        },
    ],
    external: Object.keys(settings.globals),
    plugins: [
        replace({
            'from \'three\'': 'from \'threepipe\'',
            delimiters: ['', ''],
        }),
        replace({
            'process.env.NODE_ENV': JSON.stringify('production'),
        }),
        postcss({
            modules: false,
            autoModules: true, // todo; issues with typescript import css, because inject is false
            inject: false,
            minimize: isProduction,
            // Or with custom options for `postcss-modules`
        }),
        json(),
        resolve({}),
        typescript({
        }),
        commonjs({
            include: 'node_modules/**',
            extensions: ['.js'],
            ignoreGlobal: false,
            sourceMap: false,
        }),
        license({
            banner: `
        @license
        ${name} v${version}
        Copyright 2022<%= moment().format('YYYY') > 2022 ? '-' + moment().format('YYYY') : null %> ${author}
        ${packageJson.license} License
        See ./dependencies.txt for any bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(__dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ],
}
