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

    // const codebar = document.querySelector('.codebar');
    const codefiles = document.querySelector('.codefiles-tabs');
    const exampleState = {};

    function getIcon () {
        const tsIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="1.414" clip-rule="evenodd" viewBox="0 0 500 500" class="FileName-icon-i4M61"><g fill="#0288d1"><path d="M454 454H46V46h408zM66 66v368h368V66z"></path><path d="M349.8 237.85c-2.347-.007-4.503.053-6.114.205-12.593 1.095-24.356 6.595-32.407 15.153-4.033 4.288-7.687 10.436-9.472 15.939-1.967 6.065-1.953 5.949-1.943 15.45.01 12.139.627 15.146 4.757 23.219 4.153 8.118 10.48 14.749 19.608 20.55 4 2.542 14.245 7.65 22.611 11.275 18.211 7.889 23.972 11.528 26.645 16.835l1.104 2.19v4.59c0 4.427-.018 4.655-.918 6.48-2.054 4.224-6.903 7.683-13.112 9.354-2.348.63-3.424.72-8.671.722-5.136 0-6.383-.106-8.737-.692-4.11-1.04-7.573-2.478-10.28-4.271-3.315-2.195-9.832-8.775-12.483-12.603-1.17-1.69-2.345-3.075-2.609-3.075-.436 0-22.907 12.847-26.829 15.338-1.322.84-1.657 1.223-1.657 1.896 0 1.396 5.25 9.332 9.363 14.152 8.379 9.822 25.182 18.481 40.066 20.65 5.884.856 15.657 1.133 22.485.63 4.474-.328 8.996-1.177 13.855-2.602 17.58-5.157 29.575-16.112 34.02-31.074 1.813-6.103 2.546-13.61 1.947-19.943-1.228-12.994-5.222-22.18-13.106-30.137-7.321-7.388-17.372-13.341-37.209-22.04-17.199-7.54-21.688-10.47-24.167-15.767-2.14-4.573-1.732-10.867.96-14.778 3.15-4.578 9.58-6.84 16.751-5.89 6.668.88 10.98 3.523 15.205 9.313 2.194 3.006 3.717 4.572 4.447 4.572.72 0 3.822-1.914 13.451-8.307 9.802-6.506 12.884-8.714 13.095-9.38.328-1.031-1.208-3.445-5.702-8.958-9.023-11.067-19.63-16.942-33.25-18.416-3.344-.363-7.79-.564-11.702-.576zm-108.35 1.878c-8.085-.005-17.321 0-27.583.01-53.219.052-65.571.14-65.904.483-.324.324-.408 3.587-.408 15.766v15.357l24.2.088 24.202.087.005 68.503c.002 37.677.087 68.822.205 69.212l.182.712h17.588c15.747 0 17.607-.035 17.779-.498.105-.275.182-31.42.182-69.212v-68.714l24.201-.087 24.201-.088v-15.542c0-13.47-.052-15.58-.473-15.842-.222-.14-14.127-.224-38.383-.236z"></path></g></svg>'
        return tsIcon;
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

    function createCodefileTab (uri, close = true) {
        const tab = document.createElement('div')
        const filename = uri.split('/').pop()

        tab.className = 'codefile';
        tab.title = uri.replace('file:///', '')
        // tab.textContent = uri.split('/').pop();
        tab.innerHTML = `
                        <div class="codefile-name">
                        <div class="codefile-name1">${filename}</div></div>
                        ${getIcon && getIcon()}
                        <div class="codefile-button ${close ? 'can-close' : ''}" title="Close" aria-label="Close ${filename}"></div>
                        `
        tab.dataset.path = uri
        tab.onclick = () => {
            if(tab.classList.contains('codefile-disabled')) return
            window.monacoEditor && window.monacoEditor.setFileUri(uri);
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

    async function setFileUri (uri) {
        if(!uri || !window.monacoEditor) {
            window.monacoEditor && window.monacoEditor.setModel(null)
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

        window.monacoEditor.setModel(model);
    }

    async function createFile (absUrl, example, getContent) {
        const uris = urlToUri(absUrl)
        const tab = createCodefileTab(uris, false);

        tab.classList.add('codefile-disabled');
        const editor = await window.monacoPromise

        const currentFile = getFile(uris) || 'export {}'

        const model = monaco.editor.createModel(currentFile, undefined, monaco.Uri.parse(uris));

        model.refreshJsContent = async ()=>{
            if(model._refreshingJs) return model._refreshingJs
            let changed = false
            model._refreshingJs = (async ()=> {
                if(!uris.endsWith('.ts')) {
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
                    console.log(jsFile)
                    model.compiledContent = jsFile.text;
                    changed = true
                }
            })()
            await model._refreshingJs
            model._refreshingJs = undefined
            if(!changed) return
            const onChange = exampleState[example]?.onChange
            if(onChange && model.compiledContent !== undefined) {
                onChange(model, uris, model.compiledContent ?? model.getValue())
            }
        }

        model.refreshSavedState = () => {
            let value = model.getValue()
            const savedVal = getFile(uris)
            if(value === savedVal) tab.classList.remove('codefile-unsaved');
            else tab.classList.add('codefile-unsaved');
            return value
        }

        model.onDidChangeContent(()=>{
            model.refreshSavedState()
        })

        model._onSave = async ()=> {
            saveFile(uris, model.getValue());
            model.refreshSavedState()
            await model.refreshJsContent()
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

        saveFile(uris, model.getValue());
        model.refreshSavedState()

        // model._onSave() // no await

        tab.classList.remove('codefile-disabled');

        return tab
    }

    window.monacoPromise.then(editor=>editor.setFileUri = setFileUri)

    async function setEditorExample (example111, examples111, customContent, createNew, saveExample) {
        // remove existing tabs
        codefiles.innerHTML = '';
        // console.log(example111)
        window.monaco && monaco.editor && monaco.editor.getModels().forEach(model => model.dispose());
        const example = example111.split('/examples/').pop().split('/index.html')[0].split('/')[0];
        const examples = examples111.map(e=>e.split('/examples/').pop().split('/index.html')[0].split('/')[0])
        console.warn(example)
        const htmlPath = new URL('./' + example + '/index.html', window.location.href)
        const htmlContent = customContent || await (fetch(htmlPath.href + '?raw')).then(res=>res.text()).catch(e=>{
            console.error('Error fetching example:', e);
            return '';
        });
        if(!htmlContent) {
            return;
        }
        const parsed = new DOMParser().parseFromString(htmlContent, 'text/html');
        const scripts = parsed.querySelectorAll('script');
        const styles = parsed.querySelectorAll('style');
        const exampleScript = Array.from(scripts).find(s=>s.id === 'example-script');
        if(!exampleScript) {
            console.warn('No example script found in the example HTML');
            return;
        }
        const exampleStyle = parsed.querySelector('#example-style');
        const importMap = parsed.querySelector('script[type="importmap"]');
        const imports = importMap ? JSON.parse(importMap.textContent || '{}').imports || {} : {};
        const sources = exampleScript.dataset.scripts ? exampleScript.dataset.scripts.split(';') : [];
        const mainSource = sources.find(s=>s.endsWith('/script.ts'));
        if(!mainSource) {
            console.warn('No main source script found in the example script dataset');
            return;
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
            js: exampleScript.textContent || '',
            onChange: (model, uris, content)=>{
                if(uris.endsWith('.ts')) {
                    state.js = content;
                }else if(uris.endsWith('.html')) {
                    state.html = content;
                } else {
                    console.warn('Unknown file type for onChange:', uris);
                }
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
                const url = new URL(window.location.href)
                url.pathname += example + '/';
                url.hash = ''
                url.search = ''
                baseTag.href = url.href; // or any specific base URL you want

                if(!state.changed) {
                    state.changed = true
                    if(exampleId2 !== example) {
                        createNew(exampleId2, example, parsedHtml.documentElement.outerHTML);
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
        exampleState[exampleId2] = state

        const getContent = async (absUrl) => {
            if(exampleId2 === example) return null
            const url = new URL(absUrl)
            if(url.pathname.endsWith('.ts')) url.search = '?raw' // vite
            url.pathname = url.pathname.replace(exampleId2, example);
            const content = await (await fetch(url.href)).text()
            return content
        }

        if(exampleId2 !== example) {
            htmlPath.pathname = htmlPath.pathname.replace(example, exampleId2);
        }

        const mainScriptUrl = new URL(mainSource, htmlPath.href);

        createFile(mainScriptUrl.href, exampleId2, getContent).then(tab=>tab.click())
        createFile(htmlPath.href, exampleId2, getContent)

        for (let key of Object.keys(imports)) {
            if(!key.startsWith('./'))
                loadTypesFromTarGz(key)
            else {
                continue
            }
        }
    }

    return setEditorExample
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
