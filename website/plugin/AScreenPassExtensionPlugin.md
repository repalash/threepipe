---
prev:
    text: 'PipelinePassPlugin'
    link: './PipelinePassPlugin'

next: false

aside: false
---

# AScreenPassExtensionPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/AScreenPassExtensionPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AScreenPassExtensionPlugin.html)

Abstract base plugin for screen pass extensions. Extend this class to create plugins that add shader-based screen-space effects by extending the main screen pass with custom shader snippets (uniforms, defines, functions).

```typescript
import {AScreenPassExtensionPlugin} from 'threepipe'

class MyScreenEffectPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'MyScreenEffectPlugin'

    // Override shader extension methods as needed
}
```
