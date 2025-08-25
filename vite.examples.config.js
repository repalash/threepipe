import {defineConfig} from 'vite'
import json from '@rollup/plugin-json';
import packageJson from './package.json';
import license from 'rollup-plugin-license';
import glsl from 'rollup-plugin-glsl';
import path from 'node:path';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson
const {main, module, browser} = packageJson

const alias = {
    'three': path.resolve(__dirname, './node_modules/three/'),
    'threepipe': path.resolve(__dirname, './src/index.ts'),
    '@threepipe/plugin-network': path.resolve(__dirname, './plugins/network/src/index.ts'),
    '@threepipe/plugin-tweakpane': path.resolve(__dirname, './plugins/tweakpane/src/index.ts'),
    '@threepipe/plugin-blueprintjs': path.resolve(__dirname, './plugins/blueprintjs/src/index.ts'),
    '@threepipe/plugin-svg-renderer': path.resolve(__dirname, './plugins/svg-renderer/src/index.ts'),
    '@threepipe/plugin-tweakpane-editor': path.resolve(__dirname, './plugins/tweakpane-editor/src/index.ts'),
    '@threepipe/plugin-blend-importer': path.resolve(__dirname, './plugins/blend-importer/src/index.ts'),
    '@threepipe/plugins-extra-importers': path.resolve(__dirname, './plugins/extra-importers/src/index.ts'),
    '@threepipe/plugin-geometry-generator': path.resolve(__dirname, './plugins/geometry-generator/src/index.ts'),
    '@threepipe/plugin-gaussian-splatting': path.resolve(__dirname, './plugins/gaussian-splatting/src/index.ts'),
    '@threepipe/plugin-configurator': path.resolve(__dirname, './plugins/configurator/src/index.ts'),
    '@threepipe/plugin-gltf-transform': path.resolve(__dirname, './plugins/gltf-transform/src/index.ts'),
    '@threepipe/plugin-assimpjs': path.resolve(__dirname, './plugins/assimpjs/src/index.ts'),
    '@threepipe/plugin-r3f': path.resolve(__dirname, './plugins/r3f/src/index.ts'),
    '@threepipe/plugin-path-tracing': path.resolve(__dirname, './plugins/path-tracing/src/index.ts'),
    '@threepipe/plugin-3d-tiles-renderer': path.resolve(__dirname, './plugins/3d-tiles-renderer/src/index.ts'),
    '@threepipe/plugin-timeline-ui': path.resolve(__dirname, './plugins/timeline-ui/src/index.ts'),
    '@threepipe/webgi-plugins': 'https://unpkg.com/@threepipe/webgi-plugins@0.5.6/dist/index.mjs',
    'react': 'https://esm.sh/react@19/',
    'react/jsx-runtime': 'https://esm.sh/react@19/jsx-runtime',
    'react-dom': 'https://esm.sh/react-dom@19/',
    'react-dom/client': 'https://esm.sh/react-dom@19/client',
    '@react-three/fiber': 'https://esm.sh/@react-three/fiber@9.3.0?external=react,react-dom,three',
    'vue': 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js',
    'vue-import': 'https://unpkg.com/vue-import/dist/vue-import.esm-browser.js',
}
export default defineConfig(async ()=>{

    // we have to download remote libs and replace alias with local paths, otherwise local module resolution don't work...
    for (const [key, value] of Object.entries(alias)) {
        if(value.startsWith('https://') && value.endsWith('mjs')) {
            const filename = key.replace('/', '_') + '.mjs';
            const libDir = path.resolve(__dirname, path.join('node_modules/.temp', 'vite-remote-lib'));
            const libPath = path.join(libDir, filename);

            // Ensure dir exists
            fs.mkdirSync(libDir, { recursive: true });

            // Download once at startup
            const res = await fetch(value);
            const code = await res.text();
            fs.writeFileSync(libPath, code, 'utf-8');
            alias[key] = libPath;
        }
    }

    return {
        optimizeDeps: {
            exclude: ['uiconfig.js', 'ts-browser-helpers', ...Object.keys(alias)],
        },
        // define: {
        //     'process.env': process.env
        // },
        resolve: {
            alias,
        },
        plugins: [
            !isProd ? react({
                jsxRuntime: 'classic',
            }) : react(),
            // replace({
            //     'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
            //     preventAssignment: true,
            // }),
            glsl({ // todo: minify glsl.
                include: '**/*.glsl',
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

            { // this is because vite doesn't return raw html with ?raw query
                name: 'raw-html',
                configureServer (server) {
                    server.middlewares.use('/', (req, res, next) => {
                        // Custom logic to serve raw HTML
                        if (req.url.includes('.html?raw')) {
                            // Read and serve the file directly from filesystem
                            const filePath = path.join(__dirname, req.url.slice(0, -'?raw'.length));
                            const content = fs.readFileSync(filePath, 'utf8');
                            res.setHeader('Content-Type', 'text/plain');
                            res.end(content);
                            return;
                        }
                        next();
                    });
                },
            },

            {
                name: 'transform-html-replace-js-to-ts',
                apply: 'serve',
                transformIndexHtml: { order: 'pre', handler:  (html) => {
                    const res = html
                        .replace('src="./script.js" data-scripts="./script.tsx', 'src="./script.tsx" data-scripts="./script.tsx')
                        .replace('src="./script.js"', 'src="./script.ts"');
                    return res
                } },
            },
        ],
        server: {
            // This is the default value, and will add all files with node_modules
            // in their paths to the ignore list.
            sourcemapIgnoreList (sourcePath, sourcemapPath) {
                return sourcePath.includes('node_modules') && !sourcePath.includes('three/')
            },
        },
    }
})
