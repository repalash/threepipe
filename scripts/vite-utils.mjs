import replace from '@rollup/plugin-replace';
import rollupGlsl from 'rollup-plugin-glsl';
import license from 'rollup-plugin-license';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {copyFile, glob, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

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

/**
 * rollup-plugin-glsl (`.glsl` files as compressed string modules), marked as JavaScript for Rolldown:
 * Vite 8 needs `moduleType: 'js'` when a transform turns a non-JS file into JS.
 */
export function glsl (options) {
    const plugin = rollupGlsl(options)
    return {
        ...plugin,
        transform (code, id) {
            const result = plugin.transform.call(this, code, id)
            return result && {...result, moduleType: 'js'}
        },
    }
}

export function commonPlugins (packageJson, dirname, isProduction = false) {
    const { name, version, author } = packageJson;
    return [
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
                output: path.join(dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ]
}

// `from '…'`, `import('…')`, side-effect `import '…'` and `declare module '…'`
const dtsSpecifierRE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+(?=['"])|\bdeclare\s+module\s+)(['"])([^'"\n]+)\2/g
const dtsExtRE = /\.(d\.ts|tsx?|js)$/

/**
 * Fixes the imports of the written declaration files, see {@link declarations}.
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
 *
 * Side-effect imports of packages (`import '@svgdotjs/svg.topath.js'`, which TypeScript 7 keeps in declarations) are
 * removed: they only matter at runtime, and a consumer checking the declarations fails on one without types.
 */
async function fixDtsImports (emittedFiles) {
    const files = emittedFiles.filter(f => f.endsWith('.d.ts'))
    const emitted = new Set(files.map(f => path.resolve(f)))
    const has = f => emitted.has(f) || existsSync(f)
    const errors = []
    for (const file of files) {
        const original = await readFile(file, 'utf8')
        const text = original.replace(/^import\s+(['"])(?![./])[^'"\n]+\1;?\n/gm, '')
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
        if (out !== original) await writeFile(file, out)
    }
    if (errors.length) throw new Error('Declaration imports that consumers cannot resolve:\n' + errors.join('\n'))
}

/**
 * Vite plugin that writes the declaration files of a package after a production build:
 * `tsc --emitDeclarationOnly` with TypeScript 7 (a separate native process, much faster and lighter than loading the
 * TypeScript compiler into the build), then {@link fixDtsImports}.
 *
 * Type errors do not stop the build (the declarations are written anyway), they are counted in one line.
 * @param {object} [options]
 * @param {string} [options.tsconfig] - relative to the package, `tsconfig.json` by default
 * @param {boolean} [options.copyDtsFiles] - also copy the hand-written `.d.ts` files of the `rootDir` (tsc does not)
 */
export function declarations ({tsconfig = 'tsconfig.json', copyDtsFiles = false} = {}) {
    let root, outDir
    return {
        name: 'threepipe-declarations',
        apply: 'build',
        configResolved (config) {
            root = config.root
            outDir = path.resolve(root, config.build.outDir)
        },
        async closeBundle () {
            const start = Date.now()
            const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin/tsc')
            const result = spawnSync(process.execPath, [tsc, '-p', tsconfig, '--declaration', '--emitDeclarationOnly', '--declarationDir', outDir,
                '--listEmittedFiles', '--pretty', 'false', '--singleThreaded'], {cwd: root, encoding: 'utf8'})
            const lines = (result.stdout + result.stderr).split('\n')
            const emitted = lines.filter(l => l.startsWith('TSFILE: ')).map(l => l.slice(8).trim())
            const errors = lines.filter(l => /error TS\d+/.test(l))
            // exit status 1: errors and nothing written (like a broken tsconfig), 2: errors and the declarations written
            if (result.status !== 0 && result.status !== 2 || !emitted.length) {
                throw new Error(`tsc -p ${tsconfig} wrote no declarations (exit ${result.status}):\n` + (errors.join('\n') || result.stderr || result.error))
            }
            if (copyDtsFiles) {
                const rootDir = path.resolve(root, JSON.parse(spawnSync(process.execPath, [tsc, '-p', tsconfig, '--showConfig'],
                    {cwd: root, encoding: 'utf8'}).stdout).compilerOptions.rootDir ?? '.')
                for await (const file of glob('**/*.d.ts', {cwd: rootDir})) {
                    const to = path.join(outDir, file)
                    await mkdir(path.dirname(to), {recursive: true})
                    await copyFile(path.join(rootDir, file), to)
                    emitted.push(to)
                }
            }
            await fixDtsImports(emitted)
            const typeErrors = errors.length ? `, ${errors.length} type errors (npx tsc -p ${tsconfig} --noEmit lists them)` : ''
            console.log(`[declarations] ${emitted.filter(f => f.endsWith('.d.ts')).length} files in ${path.relative(root, outDir)} in ${Date.now() - start}ms${typeErrors}`)
        },
    }
}
