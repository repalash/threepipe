import {_testFinish, _testStart, CommandsPlugin, htmlDialogWrapper, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {
    // The dialog of the viewer shows the toasts. The UI plugins (TweakpaneUiPlugin, BlueprintJsUiPlugin) set the HTML
    // dialog; without one, the default dialog writes a toast to the console. This example has no UI plugin, so it sets it.
    ThreeViewer.Dialog = htmlDialogWrapper

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})

    const container = viewer.container
    const panel = document.getElementById('toasts')!
    const button = (label: string, onClick: () => void) => {
        const b = document.createElement('button')
        b.textContent = label
        b.onclick = onClick
        panel.appendChild(b)
    }

    // A toast in the viewer: at the top centre of its container. It goes after 4 s (an error after 8 s), or on a click.
    button('Info', () => viewer.dialog.toast?.('Link copied', {container}))
    button('Warning', () => viewer.dialog.toast?.('The file is large: the export takes a while', {kind: 'warn', container}))
    button('Error', () => viewer.dialog.toast?.('Export failed: no write access', {kind: 'error', container}))
    // duration 0: it stays until a click
    button('Stays until a click', () => viewer.dialog.toast?.('Click me to close', {duration: 0, container}))
    // at most 3 in a container: a new one takes out the oldest
    button('Five at once (3 stay)', () => {
        for (let i = 1; i <= 5; i++) viewer.dialog.toast?.('Toast ' + i, {container})
    })
    // without a container: fixed at the top centre of the page
    button('On the page', () => viewer.dialog.toast?.('A toast on the page'))

    // The CommandsPlugin shows the error and the warning of an action in a toast of the viewer (toastResults)
    const commands = viewer.addPluginSync(CommandsPlugin)
    commands.register({
        id: 'upload', label: 'Upload', shortcut: 'Shift+U',
        run: async() => ({error: 'Upload failed: no server in this example'}),
    })
    button('An action that fails (Shift+U)', () => commands.run('upload'))

    // The place and the look: CSS variables of the dialog on the container (or the page)
    const label = document.createElement('label')
    label.textContent = 'Top'
    const top = document.createElement('input')
    top.type = 'range'
    top.min = '0'
    top.max = '200'
    top.value = '12'
    top.oninput = () => container.style.setProperty('--dialog-toast-top', top.value + 'px')
    label.appendChild(top)
    panel.appendChild(label)
    // At the bottom: a CSS rule of the page (see index.html) moves the toasts to the bottom centre
    button('At the bottom (on or off)', () => {
        document.body.classList.toggle('toasts-bottom')
        viewer.dialog.toast?.(document.body.classList.contains('toasts-bottom') ? 'The toasts are at the bottom' : 'The toasts are at the top', {container})
    })
    button('Dark blue toasts', () => container.style.setProperty('--dialog-toast-bg', '#1d3b8b'))
}

_testStart()
init().finally(_testFinish)
