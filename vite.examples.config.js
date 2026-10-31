import {defineConfig} from 'vite'
import packageJson from './package.json' with {type: 'json'};
import license from 'rollup-plugin-license';
import path from 'node:path';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';
import {glsl} from './scripts/vite-utils.mjs';
import {execFileSync} from 'node:child_process';

const isProd = process.env.NODE_ENV === 'production'
const { name, version, author } = packageJson
const {main, module, browser} = packageJson

const alias = {
    'three': path.resolve(import.meta.dirname, './node_modules/three/'),
    'threepipe': path.resolve(import.meta.dirname, './src/index.ts'),
    '@threepipe/plugin-network': path.resolve(import.meta.dirname, './plugins/network/src/index.ts'),
    '@threepipe/plugin-tweakpane': path.resolve(import.meta.dirname, './plugins/tweakpane/src/index.ts'),
    '@threepipe/plugin-blueprintjs': path.resolve(import.meta.dirname, './plugins/blueprintjs/src/index.ts'),
    '@threepipe/plugin-svg-renderer': path.resolve(import.meta.dirname, './plugins/svg-renderer/src/index.ts'),
    '@threepipe/plugin-tweakpane-editor': path.resolve(import.meta.dirname, './plugins/tweakpane-editor/src/index.ts'),
    '@threepipe/plugin-blend-importer': path.resolve(import.meta.dirname, './plugins/blend-importer/src/index.ts'),
    '@threepipe/plugins-extra-importers': path.resolve(import.meta.dirname, './plugins/extra-importers/src/index.ts'),
    '@threepipe/plugin-geometry-generator': path.resolve(import.meta.dirname, './plugins/geometry-generator/src/index.ts'),
    '@threepipe/plugin-gaussian-splatting': path.resolve(import.meta.dirname, './plugins/gaussian-splatting/src/index.ts'),
    '@threepipe/plugin-configurator': path.resolve(import.meta.dirname, './plugins/configurator/src/index.ts'),
    '@threepipe/plugin-gltf-transform': path.resolve(import.meta.dirname, './plugins/gltf-transform/src/index.ts'),
    '@threepipe/plugin-assimpjs': path.resolve(import.meta.dirname, './plugins/assimpjs/src/index.ts'),
    '@threepipe/plugin-r3f': path.resolve(import.meta.dirname, './plugins/r3f/src/index.ts'),
    '@threepipe/plugin-path-tracing': path.resolve(import.meta.dirname, './plugins/path-tracing/src/index.ts'),
    '@threepipe/plugin-3d-tiles-renderer': path.resolve(import.meta.dirname, './plugins/3d-tiles-renderer/src/index.ts'),
    '@threepipe/plugin-timeline-ui': path.resolve(import.meta.dirname, './plugins/timeline-ui/src/index.ts'),
    '@threepipe/plugin-annotations': path.resolve(import.meta.dirname, './plugins/annotations/src/index.ts'),
    '@threepipe/plugin-troika-text': path.resolve(import.meta.dirname, './plugins/troika-text/src/index.ts'),
    '@threepipe/webgi-plugins': path.resolve(import.meta.dirname, './plugins/webgi-plugins/src/index.ts'),
    'suspend-react': 'https://esm.sh/suspend-react',
    'react': 'https://esm.sh/react@19/',
    'react/jsx-runtime': 'https://esm.sh/react@19/jsx-runtime',
    'react-dom': 'https://esm.sh/react-dom@19/',
    'react-dom/client': 'https://esm.sh/react-dom@19/client',
    'react-reconciler': 'https://esm.sh/react-reconciler@19/',
    '@react-three/fiber': 'https://esm.sh/@react-three/fiber@9.3.0?external=react,react-dom,three',
    '@react-three/drei': 'https://esm.sh/@react-three/drei@10.7.4?external=react,react-dom,three,@react-three/fiber',
    'vue': 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js',
    'vue-import': 'https://unpkg.com/vue-import/dist/vue-import.esm-browser.js',
    'troika-three-text': 'https://esm.sh/troika-three-text?external=three',
    'uiconfig-tweakpane/lib/esm': 'uiconfig-tweakpane',
}
export default defineConfig(async ({command})=>{

    // examples/globals.js (gitignored) holds the example env values. `npm run build-examples` writes it, but a fresh
    // clone whose install stopped early has none, and the editor on examples/index.html fails to load without it.
    if (command === 'serve') execFileSync(process.execPath, ['./scripts/generate-example-env.mjs'], {cwd: import.meta.dirname, stdio: 'inherit'})

    // we have to download remote libs and replace alias with local paths, otherwise local module resolution don't work...
    for (const [key, value] of Object.entries(alias)) {
        if(value.startsWith('https://') && value.endsWith('mjs')) {
            const filename = key.replace('/', '_') + '.mjs';
            const libDir = path.resolve(import.meta.dirname, path.join('node_modules/.temp', 'vite-remote-lib'));
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
            exclude: ['uiconfig.js',
                'tweakpane',
                '@threepipe/tweakpane-image-plugin',
                'ts-browser-helpers',
                'uiconfig-tweakpane',
                ...Object.keys(alias)],
        },
        // define: {
        //     'process.env': process.env
        // },
        resolve: {
            alias,
        },
        plugins: [
            { // the server prints its root URL; the examples start at /examples/index.html
                name: 'root-to-examples',
                apply: 'serve',
                configureServer (server) {
                    server.middlewares.use((req, res, next) => {
                        if (req.url !== '/' && req.url !== '/index.html') return next()
                        res.statusCode = 302
                        res.setHeader('Location', '/examples/index.html')
                        res.end()
                    })
                },
            },
            // The example import maps point at the built bundles (dist/, plugins/*/dist/), which a fresh clone does not
            // have, and esm.sh modules with `external=three` (troika-three-text, r3f) import `three` through them.
            // Serve a module that re-exports the sources, so those modules and the page share one threepipe.
            // resolveId does the same for the imports vite resolves itself (inline <script type="module"> in examples).
            {
                name: 'dist-from-source',
                apply: 'serve',
                enforce: 'pre', // before vite's resolver, which would load a built dist/ next to the sources
                configureServer (server) {
                    server.middlewares.use((req, res, next) => {
                        const m = req.url?.split('?')[0].match(/^\/(plugins\/[^/]+\/)?dist\/index\.m?js$/)
                        if (!m) return next()
                        res.setHeader('Content-Type', 'text/javascript')
                        res.end(`export * from '/${m[1] || ''}src/index.ts'\n`)
                    })
                },
                resolveId (id, importer, options) {
                    // not for the dependency scan: it would parse all of src/ through the inline scripts
                    if (options?.scan || !importer || !/\/dist\/index\.m?js$/.test(id)) return null
                    const file = path.resolve(path.dirname(importer.split('?')[0]), id)
                    const m = path.relative(import.meta.dirname, file).split(path.sep).join('/').match(/^(plugins\/[^/]+\/)?dist\/index\.m?js$/)
                    return m ? path.resolve(import.meta.dirname, (m[1] || '') + 'src/index.ts') : null
                },
            },
            // The dev server compiles JSX with the classic runtime (React.createElement), so React must be in scope;
            // plugin sources are written for the automatic runtime and may not import it (plugins/r3f).
            {
                name: 'plugin-jsx-react-in-scope',
                apply: 'serve',
                enforce: 'pre',
                transform (code, id) {
                    if (!/\/plugins\/[^/]+\/src\/.*\.[jt]sx$/.test(id.split('?')[0])) return null
                    if (/^\s*import\s+(?:\*\s+as\s+)?React\b/m.test(code)) return null
                    return {code: 'import React from \'react\';' + code, map: null}
                },
            },
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
                    output: path.join(import.meta.dirname, 'dist', 'dependencies.txt'),
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
                            const filePath = path.join(import.meta.dirname, req.url.slice(0, -'?raw'.length));
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
                        .replace('src="./script.js" data-scripts="./script.jsx', 'src="./script.jsx" data-scripts="./script.tsx')
                        .replace('src="./script.js" data-scripts="./script.tsx', 'src="./script.tsx" data-scripts="./script.tsx')
                        .replace('src="./script.js"', 'src="./script.ts"');
                    return res
                } },
            },

            // hack to be able to use React from esm.sh
            {
                name: 'jsx-react-global',
                apply: 'serve',
                transform (code, id) {
                    // Only process JSX files
                    if (id.endsWith('/script.jsx') || id.endsWith('/script.tsx')) {
                        // Check if the file imports React
                        const hasReactImport = /import\s+(?:\*\s+as\s+)?React(?:\s*,|\s+from|\s*$)/m.test(code) ||
                            /import\s+.*\{[^}]*React[^}]*\}.*from/m.test(code) ||
                            /import\s+.*from\s+['"]react['"]/m.test(code);

                        if (hasReactImport) {
                            // Add window.React = React at the end of the file
                            return code + '\nwindow.React = React;';
                        }
                    }
                    return null;
                },
            },
        ],
        server: {
            // npm start opens the examples in the browser, except in CI, over SSH and on Linux without a display
            open: process.env.CI || process.env.SSH_CONNECTION ||
                process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? false : '/examples/index.html',
            // This is the default value, and will add all files with node_modules
            // in their paths to the ignore list.
            // sourcemapIgnoreList (sourcePath, sourcemapPath) {
            //     return sourcePath.includes('node_modules') && !sourcePath.includes('three/')
            // },
            sourcemapIgnoreList: false,
        },
        build: {
            sourcemap: false,
        },
    }
})
