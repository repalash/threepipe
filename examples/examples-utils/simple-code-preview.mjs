import {setupCodePreview} from 'https://cdn.jsdelivr.net/gh/repalash/example-code-previewer/dist/index.js';

const exampleScript = document.getElementById('example-script')
const scripts = exampleScript && exampleScript.dataset.scripts ? exampleScript.dataset.scripts.split(';') : []
if(exampleScript.textContent) scripts.push(exampleScript)
const exampleStyle = document.querySelector('#example-style')
const css = exampleStyle ? exampleStyle.textContent : ''
setupCodePreview(
    document.getElementById('canvas-container') || document.querySelector('.code-preview-container'),
    scripts,
    scripts.map(s=>s.textContent ? 'js' : s.split('.').pop()), // title
    scripts.map(s=>(typeof s === 'string' && s.endsWith('.js')) ? s : 'https://github.com/repalash/threepipe/tree/master/examples/'+ window.location.pathname.split('/examples/').pop().replace('index.html', '')+(s.textContent ? 'index.html' : s)), // todo: github link
    (c)=>c
        .replaceAll(" from 'threepipe'", " from 'https://threepipe.org/dist/index.mjs'")
        .replaceAll(" from 'uiconfig-tweakpane'", " from 'https://unpkg.com/uiconfig-tweakpane@latest/dist/index.mjs'")
        .replaceAll(" from '../", " from 'https://threepipe.org/examples/"),
    {
        title: 'ThreePipe: ' + document.title,
        css,
    },
);
