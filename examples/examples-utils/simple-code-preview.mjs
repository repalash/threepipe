import {setupCodePreview} from 'https://cdn.jsdelivr.net/gh/repalash/example-code-previewer/dist/index.js';

const rootPath = 'https://threepipe.org/'
const examplePath = 'examples/'
const codePath = 'https://github.com/repalash/threepipe/tree/master/'

const exampleScript = document.getElementById('example-script')
const scripts = exampleScript && exampleScript.dataset.scripts ? exampleScript.dataset.scripts.split(';') : []
if(exampleScript && exampleScript.textContent) scripts.push(exampleScript)
const exampleStyle = document.querySelector('#example-style')
const css = exampleStyle ? exampleStyle.textContent : ''
const importMap = document.querySelector('script[type="importmap"]')
const imports = importMap ? JSON.parse(importMap.textContent || '{}').imports || {} : {}
Object.keys(imports).forEach((k)=>(k === 'threepipe' || k.startsWith('@threepipe/')) ? (imports[k] = 'https://unpkg.com/' + k + '/dist/index.mjs') : '') // required for codepen to work. this is done because plugins refer to threepipe as esm
Object.entries(imports).forEach(([k,v])=>imports[k] = v.replace(/^\.\/\.\.\/\.\.\//, rootPath)) // ./../../ -> rootPath

// function replaceImports(code) {
//     for (const [name, link] of Object.entries(imports)) code = code.replaceAll(` from '${name}'`, ` from '${link}'`)
//     return code
//         .replaceAll(` from '../../`, ` from '${rootPath}`)
//         .replaceAll(` from '../`, ` from '${rootPath+examplePath}`)
// }
scripts.length && setupCodePreview(
    document.querySelector('.code-preview-container') || document.getElementById('canvas-container') || document.body,
    scripts,
    scripts.map(s=>s.textContent ? 'js' : s.split('.').pop()), // title
    scripts.map(s=>(typeof s === 'string' && s.endsWith('.js')) ? s : (codePath + examplePath + window.location.pathname.split('/examples/').pop().replace('index.html', '') + (s.textContent ? 'index.html' : s))), // todo: github link
    (c) => '// Threepipe example: ' + window.location.href + '\n' + (c),
    {
        title: 'ThreePipe: ' + document.title,
        css,
    },
    `
<!-- Import maps polyfill -->
<!-- Remove this when import maps will be widely supported -->
<script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
<script type="importmap">${JSON.stringify({imports}, null, 2)}</script>
`,
);
