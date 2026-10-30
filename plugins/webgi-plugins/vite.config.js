import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json' with {type: 'json'};
import license from 'rollup-plugin-license';
import path from 'node:path';
import {fixDtsImports, globalsReplacePlugin, glsl} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson
const {main, module} = packageJson

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
        ...globalsReplacePlugin(globals, isProd),
        glsl({ // todo: minify glsl.
            include: 'src/**/*.glsl',
        }),
        // Custom banner instead of commonPlugins(): the license field is "SEE LICENSE IN LICENSE", so the banner names the license itself.
        license({
            banner: `
        @license
        ${name} v${version}
        Copyright 2023<%= moment().format('YYYY') > 2023 ? '-' + moment().format('YYYY') : null %> ${author}
        Modified GNU GPL-3.0-only, see LICENSE
        See ./dependencies.txt for any bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(import.meta.dirname, 'dist', 'dependencies.txt'),
                includePrivate: true, // Default is false.
            },
        }),
    ],
})
