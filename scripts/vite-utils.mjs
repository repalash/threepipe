import replace from '@rollup/plugin-replace';
import glsl from 'rollup-plugin-glsl';
import json from '@rollup/plugin-json';
import license from 'rollup-plugin-license';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';

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

const dtsSpecifierRE = /(\bfrom\s+|\bimport\s*\(\s*|\bdeclare\s+module\s+)(['"])([^'"\n]+)\2/g
const dtsExtRE = /\.(d\.ts|tsx?|js)$/

/**
 * `afterBuild` hook for vite-plugin-dts: `dts({tsconfigPath, afterBuild: fixDtsImports})`.
 *
 * tsc copies import specifiers into the .d.ts files as they are written in the source, so
 * `from './core'` reaches the published package unchanged. These packages are `"type": "module"`,
 * and TypeScript with `moduleResolution: node16 | nodenext` does not resolve extensionless relative
 * imports in ESM declaration files: every export of the package goes missing for those consumers,
 * and `declare module '../IObject'` augmentations stop applying.
 * This rewrites each relative specifier to the explicit `.js` form (`./core/index.js`, `./Foo.js`),
 * which node10, node16, nodenext and bundler resolution all accept.
 *
 * It throws when a relative specifier matches no emitted declaration, and when a declaration
 * imports a `three/...` subpath without `.js` (`three/src/math/MathUtils`): only node10 resolves
 * those, because it ignores the `exports` map of `@types/three`.
 */
export async function fixDtsImports (emittedFiles) {
    const files = [...emittedFiles.keys()].filter(f => f.endsWith('.d.ts'))
    const emitted = new Set(files.map(f => path.resolve(f)))
    const has = f => emitted.has(f) || existsSync(f)
    const errors = []
    for (const file of files) {
        const text = await readFile(file, 'utf8')
        const out = text.replace(dtsSpecifierRE, (match, head, quote, spec, offset) => {
            const line = text.slice(text.lastIndexOf('\n', offset) + 1, offset)
            if (/^\s*(\*|\/\/)/.test(line)) return match // example code in a doc comment
            let fixed = spec
            if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
                const bare = spec.replace(dtsExtRE, '').replace(/\/$/, '')
                const base = path.resolve(path.dirname(file), bare)
                if (has(base + '.d.ts')) fixed = bare + '.js'
                else if (has(path.join(base, 'index.d.ts'))) fixed = bare + '/index.js'
                else errors.push(`${file}: '${spec}' matches no emitted declaration file`)
            } else if (/^three\/./.test(spec) && !/^three\/(addons|webgpu|tsl)$/.test(spec) && !spec.endsWith('.js')) {
                errors.push(`${file}: '${spec}' needs a .js extension (only node10 resolves it without one); import from 'three' if it is exported there`)
            }
            return head + quote + fixed + quote
        })
        if (out !== text) await writeFile(file, out)
    }
    if (errors.length) throw new Error('Declaration imports that consumers cannot resolve:\n' + errors.join('\n'))
}
