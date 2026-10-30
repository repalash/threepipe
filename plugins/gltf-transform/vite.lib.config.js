import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'
import packageJson from './package.json' with {type: 'json'};
import license from 'rollup-plugin-license';
import path from 'node:path';
import {fixDtsImports, glsl} from '../../scripts/vite-utils.mjs';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson

const dist = 'lib'

// Externalize all dependencies — derive from package.json
const externalDeps = [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
]

export default defineConfig({
    optimizeDeps: {
        exclude: externalDeps,
    },
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
            fileName: 'index',
        },
        outDir: dist,
        emptyOutDir: isProd,
        rolldownOptions: {
            output: {
                comments: {legal: false}, // strip bundled legal comments, the license() banner is added after
                globals: Object.fromEntries(externalDeps.map(d => [d, d])),
            },
            // Function-based external to catch deep/subpath imports like
            // @gltf-transform/extensions/dist/khr-draco-mesh-compression/encoder
            external: (id) => externalDeps.some(dep => id === dep || id.startsWith(dep + '/')),
        },
    },
    plugins: [
        isProd ? dts({tsconfigPath: './tsconfig.json', afterBuild: fixDtsImports}) : null,
        glsl({
            include: 'src/**/*.glsl',
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
                output: path.join(import.meta.dirname, dist, 'dependencies.txt'),
                includePrivate: true,
            },
        }),
    ],
})
