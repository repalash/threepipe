import * as globalSecs from '../../globals.js';

export function setupMonacopilot (monaco, editor) {
    if(!globalSecs.MONACOPILOT_ENDPOINT) return

    // const copilot = new window.monacopilot.CompletionCopilot('', {
    //     provider: 'mistral',
    //     model: 'codestral',
    // });

    const completion = window.monacopilot.registerCompletion(monaco, editor, {
        language: 'typescript',
        trigger: 'onDemand', // onTyping, [onIdle]

        endpoint: globalSecs.MONACOPILOT_ENDPOINT,
        token: globalSecs.MONACOPILOT_TOKEN,
        // requestHandler: async ({ body }) => {
        //     return await copilot.complete({body});
        // },

        maxContextLines: 100,
        enableCaching: true,
        allowFollowUpCompletions: true,

        filename: 'script.ts',
        technologies: ['three.js', 'threepipe', 'typescript'],

        // relatedFiles: [
        //     {
        //         path: './utils.js', // The exact path you'd use when importing
        //         content:
        //             'export const reverse = (str) => str.split("").reverse().join("")',
        //     },
        // ],
        onError: error => {
            console.error(error);
        },

    });

    // editor.addCommand(
    //     monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space,
    //     () => {
    //         completion.trigger();
    //     },
    // );
    monaco.editor.addEditorAction({
        id: 'monacopilot.triggerCompletion',
        label: 'Complete Code',
        contextMenuGroupId: 'navigation',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space,
        ],
        run: () => {
            completion.trigger();
        },
    });

    // completion.updateOptions((currentOptions) => ({
    //     relatedFiles: [
    //         ...currentOptions.relatedFiles,
    //         {
    //             path: './newFile.js',
    //             content: 'export function newFunction() { return "hello world"; }',
    //         },
    //     ],
    // }));

}
