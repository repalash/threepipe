import {setupCodePreview} from 'https://cdn.jsdelivr.net/gh/repalash/example-code-previewer/dist/index.js';

const rootPath = 'https://threepipe.org/'
const examplePath = 'examples/'
const codePath = 'https://github.com/repalash/threepipe/tree/master/'

const exampleScript = document.getElementById('example-script')
const scripts = exampleScript && exampleScript.dataset.scripts ? exampleScript.dataset.scripts.split(';') : []
if(exampleScript.textContent) scripts.push(exampleScript)
const exampleStyle = document.querySelector('#example-style')
const css = exampleStyle ? exampleStyle.textContent : ''
const importMap = document.querySelector('script[type="importmap"]')
const imports = JSON.parse(importMap.textContent||'{}').imports||{}
Object.entries(imports).forEach(([k,v])=>imports[k] = v.replace(/^\.\/\.\.\/\.\.\//, rootPath)) // ./../../ -> rootPath
function replaceImports(code) {
    for (const [name, link] of Object.entries(imports)) code = code.replaceAll(` from '${name}'`, ` from '${link}'`)
    return code
        .replaceAll(` from '../../`, ` from '${rootPath}`)
        .replaceAll(` from '../`, ` from '${rootPath+examplePath}`)
}
setupCodePreview(
    document.getElementById('canvas-container') || document.querySelector('.code-preview-container'),
    scripts,
    scripts.map(s=>s.textContent ? 'js' : s.split('.').pop()), // title
    scripts.map(s=>(typeof s === 'string' && s.endsWith('.js')) ? s : (codePath+examplePath+window.location.pathname.split('/examples/').pop().replace('index.html', '')+(s.textContent ? 'index.html' : s))), // todo: github link
    (c) => '// Threepipe example: ' + window.location.href + '\n' + replaceImports(c),
    {
        title: 'ThreePipe: ' + document.title,
        css,
    },
);
