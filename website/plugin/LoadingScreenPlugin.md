---
prev: 
    text: 'FileTransferPlugin'
    link: './FileTransferPlugin'

next: 
    text: 'InteractionPromptPlugin'
    link: './InteractionPromptPlugin'

---

# LoadingScreenPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#loading-screen-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/LoadingScreenPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/LoadingScreenPlugin.html)

Loading Screen Plugin adds configurable overlay with a logo, loading text, spinner and the list of loading items. It also provides options to minimize and maximize the loading popup when there is no objects in the scene.

The overlay is automatically added to the viewer container and shown when any files are loading. Behaviour can be configured to change how its shown and hidden, and can even be triggered programmatically.

```typescript
import {ThreeViewer, LoadingScreenPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const loadingScreen = viewer.addPluginSync(new LoadingScreenPlugin())
loadingScreen.loadingTextHeader = 'Loading Helmet 3D Model'
loadingScreen.errorTextHeader = 'Error Loading Helmet 3D Model'
loadingScreen.showFileNames = true
loadingScreen.showProcessStates = true
loadingScreen.showProgress = true
loadingScreen.backgroundOpacity = 0.4 // 0-1
loadingScreen.backgroundBlur = 28 // px
```

See also the base class [AAssetManagerProcessStatePlugin](https://threepipe.org/docs/classes/AAssetManagerProcessStatePlugin.html) to write a custom loading plugin.
