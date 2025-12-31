---
prev: 
    text: 'GeometryUVPreviewPlugin'
    link: './GeometryUVPreviewPlugin'

next: 
    text: 'SceneUiConfigPlugin'
    link: './SceneUiConfigPlugin'

---

# TailwindCSSCDNPlugin

[Example](https://threepipe.org/examples/#tailwind-css-cdn-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/TailwindCSSCDNPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TailwindCSSCDNPlugin.html)

TailwindCSSCDNPlugin dynamically loads Tailwind CSS from a CDN to enable rapid UI development with utility classes directly in your Threepipe application.

This plugin is perfect for quickly prototyping or building custom UI overlays without requiring a build step or bundler configuration. The plugin automatically injects the Tailwind CSS script tag when added to the viewer and removes it when the plugin is removed.

## Usage

```typescript
import {ThreeViewer, TailwindCSSCDNPlugin} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})

// Add the TailwindCSS CDN Plugin
const tailwindPlugin = viewer.addPluginSync(new TailwindCSSCDNPlugin())

// Now you can use Tailwind CSS classes in your HTML elements
const button = document.createElement('button')
button.className = 'bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-lg transition duration-200'
button.textContent = 'Click me'
button.onclick = () => {
    console.log('Button clicked!')
}
document.body.appendChild(button)
```

## Creating UI Elements

Once the plugin is added, you can create HTML elements and style them with Tailwind utility classes:

```typescript
// Create a card with model information
const card = document.createElement('div')
card.className = 'absolute top-4 left-4 bg-white rounded-lg shadow-xl p-6 max-w-sm'
card.innerHTML = `
    <h2 class="text-2xl font-bold mb-2 text-gray-800">Model Viewer</h2>
    <p class="text-gray-600 mb-4">Interactive 3D model viewer with Tailwind CSS styling</p>
    <button class="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded transition duration-200">
        Reset Camera
    </button>
`
document.body.appendChild(card)
```

::: warning Note
When using `innerHTML`, ensure the content is sanitized to prevent XSS vulnerabilities.
:::

## Configuration

The CDN URL can be customized if needed:

```typescript
// Change the CDN URL before adding the plugin (optional)
TailwindCSSCDNPlugin.CDN_URL = 'https://cdn.tailwindcss.com' // Default URL

const tailwindPlugin = viewer.addPluginSync(new TailwindCSSCDNPlugin())
```

## Notes

- The plugin loads Tailwind CSS from a CDN, so an internet connection is required
- For production applications with complex UIs, consider using a build step with Tailwind CSS installed locally
- The plugin does not save its state (toJSON is set to null), as it only loads CSS
- Tailwind CSS classes will be available after a brief loading period (~500ms)

## Example

Check out the [live example](https://threepipe.org/examples/#tailwind-css-cdn-plugin/) to see TailwindCSSCDNPlugin in action with a complete UI implementation.

