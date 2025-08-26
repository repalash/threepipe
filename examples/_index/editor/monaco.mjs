/* global monaco, monacoTM */

import {loadFileFromPath} from './loadTypes.mjs';

function getCssColorVar (name) {
    const rootStyles = getComputedStyle(document.documentElement);
    const color = rootStyles.getPropertyValue(name).trim();
    if(color.startsWith('var(')) {
        return getCssColorVar(color.slice(4, -1).trim());
    }
    return color;
}

const MonacoThemeLight = {
    base: 'vs',
    colors: {
        // "editor.background": getCssColorVar('--background-color'),
        'editor.background': getCssColorVar('--tab-activeBackground'),
        'editor.foreground': getCssColorVar('--text-color'),
    },
    inherit: true,
    rules: [
    ],
};

const MonacoThemeDark = {
    base: 'vs-dark',
    colors: {
        // "editor.background": getCssColorVar('--background-color'),
        'editor.background': getCssColorVar('--tab-activeBackground'),
        'editor.foreground': getCssColorVar('--text-color'),
    },
    inherit: true,
    rules: [
    ],
};

function createEditor (resolve, reject) {
    require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.52.2/min/vs' } });

    // Before loading vs/editor/editor.main, define a global MonacoEnvironment that overwrites
    // the default worker url location (used when creating WebWorkers). The problem here is that
    // HTML5 does not allow cross-domain web workers, so we need to proxy the instantiation of
    // a web worker through a same-domain script
    window.MonacoEnvironment = {
        getWorkerUrl: function (workerId, label) {
            return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
self.MonacoEnvironment = {
  baseUrl: 'https://unpkg.com/monaco-editor@0.52.2/min/'
};
importScripts('https://unpkg.com/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js');`,
            )}`;
        },
    };

    require(['vs/editor/editor.main'], async () => {
        const codebox = document.querySelector('.codebox');

        const tsConfig = {
            module: monaco.languages.typescript.ModuleKind.ESNext,
            // target: monaco.languages.typescript.ScriptTarget.ES2016,
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            // react-jsx
            jsx: monaco.languages.typescript.JsxEmit.React,
            esModuleInterop: true,
        }

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions(tsConfig);
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions(tsConfig);

        const lightPlus = monacoTM.fetchTheme('light-plus');
        const darkPlus = monacoTM.fetchTheme('dark-plus');
        monaco.editor.defineTheme('tp-light', {
            ...lightPlus,
            ...MonacoThemeLight,
            colors: {
                ...lightPlus.colors,
                ...MonacoThemeLight.colors,
            },
            rules: [
                ...lightPlus.rules,
                ...MonacoThemeLight.rules,
            ],
        });
        monaco.editor.defineTheme('tp-dark', {
            ...darkPlus,
            ...MonacoThemeDark,
            colors: {
                ...darkPlus.colors,
                ...MonacoThemeDark.colors,
            },
            rules: [
                ...darkPlus.rules,
                ...MonacoThemeDark.rules,
            ],
        });

        const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

        const editor = monaco.editor.create(codebox, {
            model: null,

            lineNumbers: 'on',
            minimap: { enabled: false },
            automaticLayout: true,
            roundedSelection: false,
            scrollBeyondLastLine: false,
            readOnly: false,
            theme: darkMode ? 'tp-dark' : 'tp-light',
            // theme: darkMode ? "dark-plus" : "light-plus",
            // theme :'vs-dark',
            // semanticHighlighting: true,
            'semanticHighlighting.enabled': true,
        });
        window.editor = editor;

        // https://github.com/microsoft/monaco-editor/issues/2000
        const editorService = editor._codeEditorService;
        const openEditorBase = editorService.openCodeEditor.bind(editorService);
        editorService.openCodeEditor = async (input, source) => {
            const result = await openEditorBase(input, source);
            if(result !== null || !source.setFileUri) return result
            // alert("intercepted")
            // console.log("Open definition for:", input);
            // console.log("Corresponding model:", monaco.editor.getModel(input.resource));
            // console.log("Source: ", source, source === editor);
            // console.log(input)
            // console.log(source)
            // let model = monaco.editor.getModel(input.resource);
            // source.setModel(model);
            source.setFileUri(input.resource.toString());
            source.setPosition({
                lineNumber: input.options.selection.startLineNumber,
                column: input.options.selection.startColumn,
            });
            source.revealRangeInCenterIfOutsideViewport({
                startLineNumber: input.options.selection.startLineNumber,
                endLineNumber: input.options.selection.endLineNumber,
                startColumn: input.options.selection.startColumn,
                endColumn: input.options.selection.endColumn,
            })
            // source.revealRangeInCenterIfOutsideViewport(input.options.selection)
            return result; // always return the base result
        };
        editor._onSaveActions = []
        editor.onSaveAction = (action)=>{
            editor._onSaveActions.push(action);
        }
        editor.doSaveAction = ()=>{
            const actions = editor._onSaveActions;
            for (const action of actions) {
                action();
            }
        }
        // editor.onKeyDown(async (e) => {
        //     if (e.keyCode === monaco.KeyCode.KeyS && (e.ctrlKey || e.metaKey)) {
        //         e.preventDefault();
        //         model._onSave && await model._onSave()
        //     }
        // });
        editor.addAction({
            id: 'threepipe.saveAndRun',
            label: 'Save And Run',
            keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            ],
            contextMenuGroupId: 'navigation', // or 'modification'
            contextMenuOrder: 1.5,
            run: editor.doSaveAction,
        });

        // editor.addCommand(
        //     monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        //     editor.doSaveAction,
        // );

        document.getElementById('codefiles-action-run').onclick = () => editor.doSaveAction()
        document.getElementById('codefiles-action-format').onclick = () => editor.getAction('editor.action.formatDocument').run()

        resolve(editor);
    });
}

export async function createMonacoEditor () {
    // in general ignore as its annoying
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
        }
    })

    window.monacoPromise = new Promise(createEditor)
    window.monacoEditor = await window.monacoPromise

    loadFileFromPath(new URL('./examples-utils/simple-bottom-buttons.js', window.location.href).href)
    // loadFileFromPath(new URL('./tweakpane-editor/ThreeEditor.ts?raw', window.location.href).href)
    // loadFileFromPath(new URL('./examples-utils/global-loading.mjs', window.location.href).href)
    // loadFileFromPath(new URL('./examples-utils/simple-code-preview.mjs', window.location.href).href)
    return window.monacoEditor;
}


window.tsWorkerClient = null;
export async function getTsWorker () {
    await window.monacoPromise
    if(window.tsWorkerClient) return window.tsWorkerClient;
    const worker = await monaco.languages.typescript.getTypeScriptWorker();
    window.tsWorkerClient = await worker();
    return window.tsWorkerClient;
}
export async function getJsWorker () {
    await window.monacoPromise
    if(window.jsWorkerClient) return window.jsWorkerClient;
    const worker = await monaco.languages.typescript.getJavaScriptWorker();
    window.jsWorkerClient = await worker();
    return window.jsWorkerClient;
}
export async function getCompiledJs (uri) {
    const client = await getTsWorker().catch(e=>console.warn(e)) || await getJsWorker().catch(e=>console.warn(e));
    if(!client) {
        console.warn('No TS/JS worker client available');
        return;
    }
    const diagnostics = await client.getSyntacticDiagnostics(uri);
    if(diagnostics.length > 0) { // syntax error
        const diagnostics2 = await client.getSemanticDiagnostics(uri);
        console.warn('Syntactic diagnostics found:', diagnostics);
        console.warn('Semantic diagnostics found:', diagnostics2);
        return;
    }
    const result = await client.getEmitOutput(uri)
    if(result.outputFiles.length > 0) {
        return result.outputFiles[0]
    }
}
