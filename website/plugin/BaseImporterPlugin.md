---
prev:
    text: 'BaseGroundPlugin'
    link: './BaseGroundPlugin'

next:
    text: 'PipelinePassPlugin'
    link: './PipelinePassPlugin'

aside: false
---

# BaseImporterPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/BaseImporterPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/BaseImporterPlugin.html)

Abstract base plugin for file importers. Extend this class to create plugins that add support for loading new file formats into the viewer's asset manager.

```typescript
import {BaseImporterPlugin} from 'threepipe'

class MyFormatImporterPlugin extends BaseImporterPlugin {
    static readonly PluginType = 'MyFormatImporterPlugin'

    // Override import methods as needed
}
```
