/* global monaco */
import {loadTypesFromTarGz, urlToUri} from './loadTypes.mjs';
import {getFile, saveFile} from './fileStore.mjs';
import {createMonacoEditor, getCompiledJs} from './monaco.mjs';
import {setupTM} from './textmate.mjs';
import {setupMonacopilot} from './copilot.mjs';

export function setupCodeEditor (iframe) {
    createMonacoEditor().then((editor)=>{
        setupTM(monaco, editor)
        setupMonacopilot(monaco, editor)
    })

    const codebar = document.querySelector('.codebar');
    const codefiles = document.querySelector('.codefiles-tabs');
    const codefilesActions = document.querySelector('.codefiles-actions');
    const exampleState = {};

    setupPaneSep();

    const updateDisabledActions = (editor) => {
        const model = editor.getModel()
        if(model && model._isSaved)
            codefilesActions.classList.add('codefile-actions-disabled')
        else
            codefilesActions.classList.remove('codefile-actions-disabled')
    }

    async function disposeTab (uri) {
        if(!uri) return
        let tab = codefiles.querySelector(`div[data-path="${uri}"]`);
        tab && tab.remove()

        const tabs = codefiles.querySelectorAll('.codefile');
        if(!tabs.length) return
        const path = tabs[0].dataset.path;

        if(!window.monacoEditor) return

        path && window.monacoEditor.setFileUri && window.monacoEditor.setFileUri(path)

        // todo?
        let model = monaco.editor.getModel(uri)
        model && model.dispose()
    }

    function createCodefileTab (uri, close = true, formatOnLoad = false) {
        const tab = document.createElement('div')
        const filename = uri.split('/').pop()
        const ext = filename.split('.').pop().toLowerCase()

        tab.className = 'codefile';
        tab.title = uri.replace('file:///', '')
        // tab.textContent = uri.split('/').pop();
        tab.innerHTML = `
                        <div class="codefile-name">
                        ${icons[extIcos[ext] || ''] || ''}
                        <div class="codefile-name1">${filename}</div></div>
                        <div class="codefile-button ${close ? 'can-close' : ''}" title="Close" aria-label="Close ${filename}"></div>
                        `
        tab.dataset.path = uri
        tab.onclick = () => {
            if(tab.classList.contains('codefile-disabled')) return
            window.monacoEditor && window.monacoEditor.setFileUri(uri, formatOnLoad);
        };
        const closeBtn = tab.querySelector('.codefile-button')
        closeBtn.onclick = (e)=>{
            if(!close) return
            disposeTab(uri)
            e.preventDefault()
            e.stopPropagation()
        }
        codefiles.appendChild(tab);
        return tab;
    }

    async function setFileUri (uri, formatOnLoad = false) {
        const editor = window.monacoEditor
        if(!uri || !editor) {
            editor && editor.setModel(null)
            return
        }

        let model = monaco.editor.getModel(uri);
        if(!model) {
            console.error('Model not found for URI:', uri);
            return
        }

        [...codefiles.getElementsByClassName('codefile-selected')].forEach((elem)=>{
            elem.classList.remove('codefile-selected');
        })
        let tab = codefiles.querySelector(`div[data-path="${uri}"]`);
        if(!tab) {
            tab = createCodefileTab(uri);
        }
        tab.classList.add('codefile-selected');

        editor.setModel(model);

        updateDisabledActions(editor)

        if(formatOnLoad) {
            setTimeout(() => {
                editor.getAction('editor.action.formatDocument').run();
            }, 100)
        }
    }

    async function createFile (absUrl, example, getContent, format) {
        const uris = urlToUri(absUrl)
        const tab = createCodefileTab(uris, false, format);

        tab.classList.add('codefile-disabled');
        const editor = await window.monacoPromise

        const currentFile = getFile(uris) || 'export {}'

        const model = monaco.editor.createModel(currentFile, undefined, monaco.Uri.parse(uris));

        model.refreshJsContent = async (first = false)=>{
            if(model._refreshingJs) return model._refreshingJs
            let changed = false
            model._refreshingJs = (async ()=> {
                if(!uris.endsWith('.ts') && !uris.endsWith('.tsx') && !uris.endsWith('.jsx')) {
                    const v = model.getValue()
                    if(v !== model.compiledContent) {
                        model.compiledContent = v
                        changed = true
                    }
                    return
                }
                const jsFile = await getCompiledJs(uris).catch(e=>{
                    console.error(e)
                    return null
                })
                if (jsFile && model.compiledContent !== jsFile.text) {
                    // console.log(jsFile)
                    model.compiledContent = jsFile.text;
                    changed = true
                }
            })()
            await model._refreshingJs
            model._refreshingJs = undefined
            if(!changed) return
            const onChange = exampleState[example]?.onChange
            if(onChange && model.compiledContent !== undefined) {
                onChange(model, uris, model.compiledContent ?? model.getValue(), first)
            }
        }

        model.refreshSavedState = () => {
            let value = model.getValue()
            const savedVal = getFile(uris)
            model._isSaved = value === savedVal
            if(model._isSaved) tab.classList.remove('codefile-unsaved');
            else tab.classList.add('codefile-unsaved');
            updateDisabledActions(editor)
            return value
        }

        model.onDidChangeContent(()=>{
            model.refreshSavedState()
        })

        model._onSave = async (first = false)=> {
            saveFile(uris, model.getValue());
            model.refreshSavedState()
            await model.refreshJsContent(first)
        }

        editor.onSaveAction(async (e) => {
            if(editor.getModel() !== model) return
            model._onSave && await model._onSave()
        });

        // const refreshJs = model.refreshJsContent()

        const content = await getContent(absUrl)

        // await refreshJs

        if(content !== null && content !== currentFile) {
            model.setValue(content)
        }

        // saveFile(uris, model.getValue());
        // model.refreshSavedState()
        model._onSave(true) // no await

        tab.classList.remove('codefile-disabled');

        return tab
    }

    async function setEditorExample (example111, examples111, customContent, createNew, saveExample) {
        // remove existing tabs
        codefiles.innerHTML = '';
        // console.log(example111)
        window.monaco && monaco.editor && monaco.editor.getModels().forEach(model => model.dispose());
        const example = example111.split('/examples/').pop().split('/index.html')[0].split('/')[0];
        const examples = examples111.map(e=>e.split('/examples/').pop().split('/index.html')[0].split('/')[0])
        const indexFilename = 'index.html';
        const htmlPath = new URL('./' + example + '/' + indexFilename, window.location.href)
        let htmlContent = customContent || await (fetch(htmlPath.href + '?raw')).then(res=>res.text()).catch(e=>{
            console.error('Error fetching example:', e);
            return '';
        });
        if(!htmlContent) {
            return;
        }
        const parsed = new DOMParser().parseFromString(htmlContent, 'text/html');
        const scripts = parsed.querySelectorAll('script');
        const styles = parsed.querySelectorAll('style');
        // console.log(htmlContent)
        const exampleScript = Array.from(scripts).find(s=>s.id === 'example-script');
        if(!exampleScript) {
            console.warn('No example script found in the example HTML');
            return;
        }
        const exampleStyle = parsed.querySelector('#example-style');
        const importMap = parsed.querySelector('script[type="importmap"]');
        const imports = importMap ? JSON.parse(importMap.textContent || '{}').imports || {} : {};
        const sources = exampleScript.dataset.scripts ? exampleScript.dataset.scripts.split(';').filter(s=>!s.endsWith('.html')) : [];
        const hasContent = exampleScript.textContent
        const mainSource = sources.find(s=>s.endsWith('/script.ts') || s.endsWith('/script.tsx')) || sources[0] || (hasContent ? './script.js' : null);
        if(!mainSource) {
            console.warn('No main source script found in the example script dataset');
            return;
        }
        if(hasContent) {
            exampleScript.textContent = ''
            exampleScript.src = mainSource;
            htmlContent = parsed.documentElement.outerHTML
        }
        let exampleId2 = example
        if(!customContent) {
            while (examples.includes(exampleId2)) {
                exampleId2 = nextName(exampleId2);
            }
        }

        const state = {
            id: exampleId2,
            changed: false,
            html: htmlContent,
            js: hasContent || '',
            files: [], // extrafiles
            onChange: (model, uris, content, first = false)=>{
                if(uris.endsWith('/script.ts') || uris.endsWith('/script.tsx') || uris.endsWith('/script.js') || uris.endsWith('/script.jsx')) {
                    state.js = content;
                }else if(uris.endsWith('/index.html')) {
                    state.html = content;
                }else {
                    let hasFile = false
                    for (const file of state.files) {
                        if(uris.endsWith('/' + file.name.replace(/^\.\//, ''))) {
                            file.content = content;
                            hasFile = true
                            break
                        }
                    }
                    if(!hasFile)
                        console.warn('Unknown file type for onChange:', uris);
                }
                if(first) return

                const parsedHtml = new DOMParser().parseFromString(state.html, 'text/html');
                // replace script
                const existingScript = parsedHtml.querySelector('#example-script');
                if(existingScript) {
                    existingScript.removeAttribute('src');
                    existingScript.textContent = state.js;
                }
                let baseTag = parsedHtml.querySelector('base');
                if (!baseTag) {
                    baseTag = parsedHtml.createElement('base');
                    parsedHtml.head.prepend(baseTag);
                }
                const importMap = parsedHtml.querySelector('script[type="importmap"]');
                if (importMap) {
                    const imports = JSON.parse(importMap.textContent || '{}').imports || {};
                    let changed = false
                    for (const file of state.files) {
                        if(imports[file.key] && file.content) {
                            const mime = file.name.endsWith('.ts') || file.name.endsWith('.tsx') || file.name.endsWith('.js') || file.name.endsWith('.jsx') ? 'text/javascript' :
                                file.name.endsWith('.css') ? 'text/css' : 'text/plain';
                            // imports[file.key] = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content);
                            imports[file.key] = 'data:' + mime + ';base64,' + btoa(file.content);
                            changed = true
                        }
                    }
                    if(changed) {
                        importMap.textContent = JSON.stringify({imports}, null, 2);
                    }
                }
                // todo

                const url = new URL(window.location.href)
                url.pathname += example + '/';
                url.hash = ''
                url.search = ''
                baseTag.href = url.href; // or any specific base URL you want

                if(!state.changed) {
                    state.changed = true
                    if(exampleId2 !== example) {
                        createNew(exampleId2, example, parsedHtml.documentElement.outerHTML);
                    }else{
                        saveExample(exampleId2, parsedHtml.documentElement.outerHTML);
                    }
                }else {
                    saveExample(exampleId2, parsedHtml.documentElement.outerHTML);
                }

                // const iframe = document.querySelector('.codebox iframe');
                if(iframe) {
                    iframe.removeAttribute('src')
                    // const doc = iframe.contentDocument || iframe.contentWindow.document;
                    // doc.open();
                    // doc.write(parsedHtml.documentElement.outerHTML);
                    // doc.close();
                    // console.log(parsedHtml.documentElement.outerHTML)
                    iframe.srcdoc = parsedHtml.documentElement.outerHTML;
                } else {
                    console.warn('No iframe found to update with the new HTML content');
                }
            },
        }
        for (let key of Object.keys(imports)) {
            if (key.startsWith('./')) {
                if(key.includes('/../')) continue // just in case
                const name = key.endsWith('.js') ? key : key + '.ts'; // todo check if ts file exists
                const file = {key, name, content: ''}

                const ref = imports[key]
                if(ref && ref.startsWith('data:')) {
                    const dataUrl = ref.split('base64,')
                    file.content = atob(dataUrl[1]);
                }
                state.files.push(file)
            }
        }

        exampleState[exampleId2] = state


        if(exampleId2 !== example) {
            htmlPath.pathname = htmlPath.pathname.replace(example, exampleId2);
        }

        const mainScriptUrl = new URL(mainSource, htmlPath.href);
        // const extraFileUrls = []

        const getContent = async (absUrl) => {
            if(exampleId2 === example) return null
            if(absUrl === mainScriptUrl.href && hasContent) {
                return trimCodeIndents(hasContent);
            }
            if(absUrl === htmlPath.href && htmlContent) {
                return htmlContent
            }
            const url = new URL(absUrl)
            // if(url.pathname.endsWith('.ts') || url.pathname.endsWith('.html'))
            url.search = 'raw'
            url.pathname = url.pathname.replace(exampleId2, example);
            const content = await (await fetch(url.href)).text()
            return content
        }

        // console.log(hasContent, !!hasContent)
        createFile(mainScriptUrl.href, exampleId2, getContent, false).then(tab=>{
            setTimeout(()=>{
                tab.click()
            }, 100)
        })

        for (const file of state.files) {
            const pathUrl = new URL(file.name, htmlPath.href);
            // // extraFileUrls.push(pathUrl)
            createFile(pathUrl.href, exampleId2, getContent, false)

        }
        createFile(htmlPath.href, exampleId2, getContent, false)

        const editor = await window.monacoPromise
        loadTypesFromTarGz('threepipe')
        loadTypesFromTarGz('uiconfig-tweakpane')
        for (let key of Object.keys(imports)) {
            if (key.startsWith('./')) {
                // nothing
            } else {
                loadTypesFromTarGz(key)
            }
        }
    }

    // Function to setup show-code-btn listener in iframe
    function setupIframeCodeButton () {
        try {

            let setup = false
            // Function to actually setup the button once it's available
            const setupButton = (st = true) => {
                if(setup) return true
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const showCodeBtn = iframeDoc.querySelector('.show-code-btn');
                if (showCodeBtn) {
                    setup = true
                    showCodeBtn.onclick = () => {
                        codebar.classList.toggle('closed');
                    };

                    // add style in iframe
                    const style = iframeDoc.createElement('style');
                    style.textContent = `
                        .code-block{
                            display: none !important;
                        }
                    `;
                    iframeDoc.head.appendChild(style);
                    return true; // Success
                }
                setTimeout(()=>setupButton(), 1000)
                return false; // Button not found yet
            };
            if (setupButton(false)) return;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            iframeDoc.addEventListener('DOMContentLoaded', () => {
                setupButton()
            });
        } catch (e) {
            // Handle cross-origin or other access issues
            console.warn('Could not access iframe content:', e);
        }
    }

    iframe.addEventListener('load', () => {
        setupIframeCodeButton();
    });

    // Check if iframe is already loaded and setup immediately if needed
    if (iframe.contentDocument && iframe.contentDocument.readyState !== 'loading') {
        setupIframeCodeButton();
    }

    window.monacoPromise.then(editor=>editor.setFileUri = setFileUri)

    return setEditorExample
}

function trimCodeIndents (code) {
    const lines = code.split('\n')
    if (!lines.length) return ''
    let ts = 0
    while (lines[ts].trim() === '' && ts < lines.length - 1) ts++
    lines.splice(0, ts)
    if (!lines.length) return ''
    const indent = lines[0].match(/^\s*/)[0]
    return lines.map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n')
}

function nextName (n) {
    if(n.endsWith('-copy')) {
        return n + '-1'
    }
    const parts = n.split('-');
    const lastPart = parts[parts.length - 1];
    const isNumber = /^\d+$/.test(lastPart);
    if (isNumber) {
        const newNumber = parseInt(lastPart, 10) + 1;
        parts[parts.length - 1] = newNumber.toString();
    } else {
        parts.push('copy');
    }
    return parts.join('-');
}

/**
 * Simple Drag - https://github.com/lingtalfi/simpledrag/blob/master/simpledrag.js
 */
function simpleDrag (el, onDrag, onStop, direction) {
    let startX = 0;
    let startY = 0;
    let dragging = false;

    function move (e) {

        const fix = {};
        onDrag && onDrag(el, e.pageX, startX, e.pageY, startY, fix);
        if ('vertical' !== direction) {
            const pageX = ('pageX' in fix) ? fix.pageX : e.pageX;
            if ('startX' in fix) {
                startX = fix.startX;
            }
            if (false === ('skipX' in fix)) {
                el.style.left = (pageX - startX) + 'px';
            }
        }
        if ('horizontal' !== direction) {
            const pageY = ('pageY' in fix) ? fix.pageY : e.pageY;
            if ('startY' in fix) {
                startY = fix.startY;
            }
            if (false === ('skipY' in fix)) {
                el.style.top = (pageY - startY) + 'px';
            }
        }
    }

    function startDragging (e) {
        if (e.currentTarget instanceof HTMLElement || e.currentTarget instanceof SVGElement) {
            dragging = true;
            const left = el.style.left ? parseInt(el.style.left) : 0;
            const top = el.style.top ? parseInt(el.style.top) : 0;
            startX = e.pageX - left;
            startY = e.pageY - top;
            window.addEventListener('mousemove', move);
        }
        else {
            throw new Error('Your target must be an html element');
        }
    }

    function mouseUp (e) {
        if (true === dragging) {
            dragging = false;
            window.removeEventListener('mousemove', move);
            onStop && onStop(el, e.pageX, startX, e.pageY, startY);
        }
    }

    el.addEventListener('mousedown', startDragging);
    window.addEventListener('mouseup', mouseUp);

    return ()=>{
        el.removeEventListener('mousedown', startDragging);
        window.removeEventListener('mouseup', mouseUp);
        window.removeEventListener('mousemove', move);
    }
}

function setupPaneSep () {
    const sidebar = document.querySelector('.sidebar');
    const leftPane = document.querySelector('.left-pane');
    const rightPane = document.querySelector('.right-pane');
    const paneSep = document.querySelector('.panes-separator');

    // The script below constrains the target to move horizontally between a left and a right virtual boundaries.
    // - the left limit is positioned at 10% of the screen width
    // - the right limit is positioned at 90% of the screen width
    const leftLimit = 20;
    const rightLimit = 80;

    simpleDrag(paneSep, function (el, pageX, startX, pageY, startY, fix) {
        const sidebarW = sidebar.getBoundingClientRect().width

        fix.skipX = true;
        if (pageX - sidebarW < window.innerWidth * leftLimit / 100) {
            pageX = sidebarW + window.innerWidth * leftLimit / 100;
            fix.pageX = pageX;
        }
        if (pageX > window.innerWidth * rightLimit / 100) {
            pageX = window.innerWidth * rightLimit / 100;
            fix.pageX = pageX;
        }

        let cur = pageX// / window.innerWidth * 100;
        if (cur < 0) {
            cur = 0;
        }
        if (cur > window.innerWidth) {
            cur = window.innerWidth;
        }

        // const right = (100 - cur - 2);
        const paneSepW = paneSep.getBoundingClientRect().width / 2
        leftPane.style.width = `${100 * (cur - sidebarW - paneSepW) / window.innerWidth}%`
        rightPane.style.width = `${100 * (window.innerWidth - cur - paneSepW) / window.innerWidth}%`

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        sidebar.style.pointerEvents = 'none'
        leftPane.style.pointerEvents = 'none'
        rightPane.style.pointerEvents = 'none'
        paneSep.classList.add('pane-sep-dragging')
    }, () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        sidebar.style.pointerEvents = ''
        leftPane.style.pointerEvents = ''
        rightPane.style.pointerEvents = ''
        paneSep.classList.remove('pane-sep-dragging')
    }, 'horizontal');
}

const icons = {
    'javascript': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="#E79627" viewBox="-40 -40 586 586" class="file-icon"><path d="M412.226 385.563c28.065 37.511-46.893 64.77-77.11 10.559l-41.05 23.822 2.516 4.167c15.464 26.04 39.62 41.294 72.27 45.673 71.481 8.55 118.148-37.034 92.817-101.767C443.667 331 396.5 324 369 305.75c-16.172-9.422-12.806-29.364.183-37.365 10.102-6.222 33.317-7.01 45.274 17.786l39.28-25.317C422.75 205 349.5 216.25 327.544 241.627 297.688 276.702 306.228 315.85 332.5 341c20.434 19.561 52.501 26.202 79.726 44.563m-185.588 79.069c22.63-9.153 35.904-28.074 39.416-56.202.305-2.848.508-184.599.508-184.599h-49.788l-.36 179.779c-1.164 11.64-8.122 19.983-18.289 21.619-17.347 2.791-28.911-2.26-40.963-24.826l-40.535 24.508c17.373 40.839 69.745 55.838 110.011 39.72M44.873 0h422.254C491.987 0 512 20.013 512 44.873v422.254c0 24.86-20.013 44.873-44.873 44.873H44.873C20.013 512 0 491.987 0 467.127V44.873C0 20.013 20.013 0 44.873 0"></path></svg>',
    'typescript': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 -1 16 16" class="file-icon"><path fill="#1E9CEF" d="M10.771 10.992a2.28 2.28 0 0 1-1.632-.759v1.29c1.055.686 2.87.56 3.5-.264a1.9 1.9 0 0 0 .253-1.889c-.656-1.321-2.214-1.4-2.668-2.238-.5-1.351 1.564-1.6 2.557-.685V5.234a2.85 2.85 0 0 0-1.566-.277 1.92 1.92 0 0 0-2.067 1.867c-.054 1.5 1.663 1.891 2.525 2.586.586.498.544 1.703-.902 1.582m-4.913.862V6.016H3.977v-.965h4.8v.965H6.9v5.838zM14.125.875v12.25H1.875V.875zM15 0H1v14h14z" class="typeScript_svg__i-color"></path></svg>',
    'react': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="#26A2C1" viewBox="0 0 16 16" class="file-icon"><path d="M16 8c0-1.06-1.32-2.06-3.36-2.68.46-2.08.26-3.72-.66-4.26a1.5 1.5 0 0 0-.74-.18v.72c.16 0 .28.02.38.08.44.26.64 1.22.48 2.46l-.16.96a15.5 15.5 0 0 0-2.08-.36c-.44-.6-.9-1.16-1.36-1.64 1.08-.96 2.08-1.5 2.76-1.5V.88c-.9 0-2.08.64-3.26 1.74C6.8 1.52 5.64.88 4.74.88v.72c.68 0 1.68.54 2.74 1.52-.46.48-.92 1.02-1.34 1.62-.74.08-1.44.2-2.08.36a5.4 5.4 0 0 1-.16-.94c-.16-1.24.04-2.22.48-2.48.1-.06.22-.08.38-.08V.9c-.28 0-.52.06-.74.18-.92.52-1.12 2.18-.64 4.24C1.32 5.94 0 6.94 0 8s1.32 2.06 3.36 2.68c-.46 2.08-.26 3.72.66 4.26.22.12.46.18.74.18.9 0 2.08-.64 3.26-1.74 1.18 1.1 2.36 1.74 3.26 1.74.28 0 .52-.06.74-.18.92-.52 1.12-2.18.64-4.24C14.68 10.06 16 9.06 16 8m-4.24-2.18c-.12.42-.28.86-.44 1.28l-.42-.78c-.16-.26-.3-.52-.46-.76.44.08.88.16 1.32.26m-1.5 3.48c-.26.44-.52.86-.78 1.24a18 18 0 0 1-2.94 0A16 16 0 0 1 5.08 8a16 16 0 0 1 1.46-2.54 18 18 0 0 1 2.94 0A16 16 0 0 1 10.94 8c-.2.44-.44.88-.68 1.3m1.06-.42c.18.44.32.88.46 1.3-.42.1-.88.2-1.34.26.16-.26.32-.5.46-.78zM8 12.36c-.3-.32-.6-.66-.9-1.04.3.02.6.02.9.02s.6 0 .9-.02c-.28.38-.6.72-.9 1.04m-2.42-1.92c-.46-.06-.9-.16-1.34-.26.12-.42.28-.86.44-1.28l.42.78zM8 3.64c.3.32.6.66.9 1.04-.3-.02-.6-.02-.9-.02s-.6 0-.9.02c.28-.38.6-.72.9-1.04M5.58 5.56c-.16.26-.32.5-.46.78q-.24.39-.42.78c-.18-.44-.32-.88-.46-1.3.42-.1.88-.18 1.34-.26m-2.96 4.1C1.46 9.16.72 8.52.72 8s.74-1.16 1.9-1.66c.28-.12.58-.22.9-.32.18.64.44 1.3.74 1.98q-.45 1.02-.72 1.98c-.32-.1-.62-.2-.92-.32m1.76 4.66c-.44-.26-.64-1.22-.48-2.46l.16-.96c.64.16 1.34.28 2.08.36.44.6.9 1.16 1.36 1.64-1.08.96-2.08 1.5-2.74 1.5a1 1 0 0 1-.38-.08m7.74-2.5c.16 1.24-.04 2.22-.48 2.48a.7.7 0 0 1-.38.08c-.68 0-1.68-.54-2.74-1.52.46-.48.92-1.02 1.34-1.62.74-.08 1.44-.2 2.08-.36.08.32.14.64.18.94m1.26-2.16c-.28.12-.58.22-.9.32-.18-.64-.44-1.3-.74-1.98q.45-1.02.72-1.98c.32.1.62.22.92.34 1.16.5 1.9 1.14 1.9 1.66 0 .5-.76 1.14-1.9 1.64M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"></path></svg>',
    'html5': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" class="file-icon"><path fill="#F4BF75" d="m11.631 5.1.136-1.531H4.233l.4 4.672h5.216l-.187 2-1.679.459-1.67-.464L6.2 9.015H4.71l.19 2.433 3.085.875h.032v-.009l3.06-.866.423-4.76H6.014L5.886 5.1h5.744ZM2 1h12l-1.091 12.583L7.983 15l-4.892-1.417Z" class="html_svg__i-color"></path></svg>',
    'css3': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 -1 16 16" class="file-icon"><path fill="#1E9CEF" d="M3.785 2H14l-1.805 9.164L6.738 13 2 11.164l.482-2.447H4.5l-.2 1.011 2.864 1.107 3.3-1.107.461-2.328h-8.2l.395-2.045h8.206l.258-1.313h-8.2Z" class="css_svg__i-color"></path></svg>',
    'json': '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" class="file-icon"><path fill="#92AA5D" d="M5 3h2v2H5v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5h2v2H5c-1.07-.27-2-.9-2-2v-4a2 2 0 0 0-2-2H0v-2h1a2 2 0 0 0 2-2V5a2 2 0 0 1 2-2m14 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3zm-7 12a1 1 0 0 1 1 1 1 1 0 0 1-1 1 1 1 0 0 1-1-1 1 1 0 0 1 1-1m-4 0a1 1 0 0 1 1 1 1 1 0 0 1-1 1 1 1 0 0 1-1-1 1 1 0 0 1 1-1m8 0a1 1 0 0 1 1 1 1 1 0 0 1-1 1 1 1 0 0 1-1-1 1 1 0 0 1 1-1"></path></svg>',
    'folder-fill': '<svg xmlns="http://www.w3.org/2000/svg" fill="#2196F3" viewBox="0 0 16 16" width="1em" height="1em" class="file-icon"><path d="M6.56 2.48H2.24c-.8 0-1.44.64-1.44 1.44v8.64c0 .79.65 1.44 1.44 1.44h11.52c.79 0 1.44-.65 1.44-1.44v-7.2c0-.8-.65-1.44-1.44-1.44H8z"></path></svg>',
    'folder': '<svg xmlns="http://www.w3.org/2000/svg" fill="#2196F3" viewBox="0 0 16 16" width="1em" height="1em" class="file-icon"><path d="M13.66 12.46H2.34v-7h11.32zm.1-8.54H8L6.56 2.48H2.24c-.8 0-1.44.64-1.44 1.44v8.64c0 .8.64 1.44 1.44 1.44h11.52c.8 0 1.44-.64 1.44-1.44v-7.2c0-.8-.65-1.44-1.44-1.44"></path></svg>',
}

const extIcos = {
    'ts': 'typescript',
    'tsx': 'react',
    'js': 'typescript',
    'jsx': 'react',
    'html': 'html5',
    'css': 'css3',
    'json': 'json',
}
