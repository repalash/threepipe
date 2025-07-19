/* global monaco */

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
        //     token("attribute.name", Colors.ORANGE3),
        //     token("attribute.value", Colors.LIME2),
        //     token("comment", Colors.GRAY2),
        //     token("delimiter", Colors.DARK_GRAY5),
        //     token("function", Colors.BLUE3),
        //     token("identifier", Colors.TURQUOISE2),
        //     token("keyword", Colors.VIOLET4),
        //     token("number", Colors.ROSE2),
        //     token("operator", Colors.VIOLET4),
        //     token("string", Colors.LIME2),
        //     token("tag", Colors.FOREST3),
        //     token("type.identifier", Colors.GOLD2),
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
        // token("attribute.name", Colors.ORANGE4),
        // token("attribute.value", Colors.LIME4),
        // token("comment", Colors.GRAY2),
        // token("delimiter", Colors.LIGHT_GRAY3),
        // token("function", Colors.BLUE4),
        // token("identifier", Colors.TURQUOISE3),
        // token("keyword", Colors.VIOLET4),
        // token("number", Colors.ROSE4),
        // token("operator", Colors.VIOLET5),
        // token("string", Colors.LIME4),
        // token("tag", Colors.FOREST3),
        // token("type.identifier", Colors.GOLD5),
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

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            module: monaco.languages.typescript.ModuleKind.ESNext,
            // target: monaco.languages.typescript.ScriptTarget.ES2016,
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            esModuleInterop: true,
        });

        monaco.editor.defineTheme('tp-light', MonacoThemeLight);
        monaco.editor.defineTheme('tp-dark', MonacoThemeDark);
        // monaco.editor.defineTheme('light-plus', fetchTheme('light-plus'));
        // monaco.editor.defineTheme('dark-plus', fetchTheme('dark-plus'));
        // console.log(fetchTheme('dark-plus'))

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

        resolve(editor);
    });
}

export async function createEditor2 () {
    // in general ignore as its annoying
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
        }
    })

    window.monacoPromise = new Promise(createEditor)
    window.monacoEditor = await window.monacoPromise
}



