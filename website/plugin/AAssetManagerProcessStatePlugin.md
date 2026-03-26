---
prev:
    text: 'TailwindCSSCDNPlugin'
    link: './TailwindCSSCDNPlugin'

next:
    text: 'ACameraControlsPlugin'
    link: './ACameraControlsPlugin'

aside: false
---

# AAssetManagerProcessStatePlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/AAssetManagerProcessStatePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AAssetManagerProcessStatePlugin.html)

Abstract base plugin for processing assets during the asset manager pipeline. Extend this class to create plugins that intercept and transform assets as they are loaded or processed by the viewer.

```typescript
import {AAssetManagerProcessStatePlugin} from 'threepipe'

class MyProcessorPlugin extends AAssetManagerProcessStatePlugin {
    static readonly PluginType = 'MyProcessorPlugin'

    // Override processing methods as needed
}
```
