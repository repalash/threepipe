import {defineConfig} from 'vite'
import license from 'rollup-plugin-license';
import replace from '@rollup/plugin-replace';
import packageJson from './package.json';
import path from 'node:path';

// Build of the plain three.js entry (`@threepipe/plugin-blend-importer/three`, src/threejs.ts).
// Unlike vite.config.js, `three` stays `three` (no rewrite to threepipe) and is the only external:
// the parser, fflate and fzstd are bundled, so a three.js project needs nothing else installed.
// Types come from vite.config.js's dts step, which covers every file in src/.
const isProd = process.env.NODE_ENV === 'production'
const {name, version, author} = packageJson

export default defineConfig({
    base: '',
    build: {
        sourcemap: true,
        minify: false,
        lib: {
            entry: 'src/threejs.ts',
            formats: isProd ? ['es', 'umd'] : ['es'],
            name: 'BlendLoader', // UMD global: window.BlendLoader.BlendLoader
            fileName: (format) => format === 'umd' ? 'threejs.js' : 'threejs.mjs',
        },
        outDir: 'dist',
        emptyOutDir: false, // runs after vite.config.js, which owns dist/
        rollupOptions: {
            external: ['three'],
            output: {globals: {three: 'THREE'}},
        },
    },
    plugins: [
        replace({
            'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
            preventAssignment: true,
        }),
        license({
            banner: `
        @license
        ${name} v${version} (three.js entry)
        Copyright 2022<%= moment().format('YYYY') > 2022 ? '-' + moment().format('YYYY') : null %> ${author}
        ${packageJson.license} License
        See ./dependencies-three.txt for bundled third-party dependencies and licenses.
      `,
            thirdParty: {
                output: path.join(__dirname, 'dist', 'dependencies-three.txt'),
                includePrivate: true,
            },
        }),
    ],
})
