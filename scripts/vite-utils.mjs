import replace from '@rollup/plugin-replace';
import glsl from 'rollup-plugin-glsl';
import json from '@rollup/plugin-json';
import license from 'rollup-plugin-license';
import path from 'node:path';

export function globalsReplacePlugin (globals, isProd) {
    return [
        replace({
            values: Object.entries(globals).reduce((p, [key, value]) => {
                if(key === value) return p
                return {
                    ...p,
                    [`from '${key}'`]: `from '${value}'`,
                    [`from "${key}"`]: `from '${value}'`,
                    [`require('${key}')`]: `require('${value}')`,
                    [`require("${key}")`]: `require('${value}')`,
                }
            }, {}),
            delimiters: ['', ''],
            preventAssignment: true,
        }),
        replace({
            'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
            preventAssignment: true,
        }),
    ]
}

export function commonPlugins (packageJson, dirname, isProduction = false) {
    const { name, version, author } = packageJson;
    return [
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
        See ./dependencies.txt for any bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ]
}
