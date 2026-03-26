---
prev:
    text: 'BaseImporterPlugin'
    link: './BaseImporterPlugin'

next:
    text: 'AScreenPassExtensionPlugin'
    link: './AScreenPassExtensionPlugin'

aside: false
---

# PipelinePassPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/PipelinePassPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PipelinePassPlugin.html)

Abstract base plugin for render pipeline passes. Extend this class to create plugins that add custom render passes to the viewer's rendering pipeline (e.g. post-processing effects, buffer generation).

```typescript
import {PipelinePassPlugin} from 'threepipe'

class MyPassPlugin extends PipelinePassPlugin {
    static readonly PluginType = 'MyPassPlugin'

    // Override pass methods as needed
}
```
