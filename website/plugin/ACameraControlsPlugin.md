---
prev:
    text: 'AAssetManagerProcessStatePlugin'
    link: './AAssetManagerProcessStatePlugin'

next:
    text: 'BaseGroundPlugin'
    link: './BaseGroundPlugin'

aside: false
---

# ACameraControlsPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/ACameraControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ACameraControlsPlugin.html)

Abstract base plugin for camera controls. Extend this class to create custom camera control plugins that integrate with the viewer's camera system, providing orbit, pan, zoom, and other interaction modes.

```typescript
import {ACameraControlsPlugin} from 'threepipe'

class MyControlsPlugin extends ACameraControlsPlugin {
    static readonly PluginType = 'MyControlsPlugin'

    // Override control methods as needed
}
```
