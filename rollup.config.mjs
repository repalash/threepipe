// rollup.config.js
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import packageJson from './package.json' assert {type: 'json'};
import path from 'node:path'
import {fileURLToPath} from 'node:url';
import postcss from 'rollup-plugin-postcss'
import glsl from "rollup-plugin-glsl"
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import license from "rollup-plugin-license";
import terser from "@rollup/plugin-terser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {name, version, author} = packageJson
const {main, module, browser} = packageJson["clean-package"].replace
const isProduction = process.env.NODE_ENV === 'production'

const settings = {
    globals: {},
    sourcemap: isProduction
}

export default {
    input: './src/index.ts',
    output: [
        // {
        //   file: main,
        //   name: main,
        //   ...settings,
        //   format: 'cjs',
        //   plugins: [
        //     isProduction && terser()
        //   ]
        // },
        {
            file: module,
            ...settings,
            name: name,
            // dir: 'dist', // indicate not create a single-file
            // preserveModules: true, // indicate not create a single-file
            // preserveModulesRoot: 'src', // optional but useful to create a more plain folder structure
            format: 'es'
        },
        isProduction ? {
            file: browser,
            ...settings,
            name: name,
            format: 'umd',
            plugins: [
                isProduction && terser()
            ]
        } : null,
    ],
    external: [],
    plugins: [
        replace({
            'process.env.NODE_ENV': JSON.stringify( 'production' ),
            '.css?inline': '.css',
            preventAssignment: true,
        }),
        // replace({
        //     exclude: 'src/**',
        //     delimiters: ['', ''],
        //     values:{
        //         'from \'three\'': 'from \'threepipe\'',
        //     },
        // }),
        glsl({ // todo: minify glsl.
            include: "src/**/*.glsl"
        }),
        postcss({
            extensions: ['.css', '.css?inline'],
            modules: false,
            autoModules: true,  // todo; issues with typescript import css, because inject is false
            inject: false,
            minimize: isProduction,
            // Or with custom options for `postcss-modules`
        }),
        json(),
        resolve({}),
        typescript({}),
        commonjs({
            include: 'node_modules/**',
            extensions: ['.js'],
            ignoreGlobal: false,
            sourceMap: false
        }),
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
        })
    ]
}
