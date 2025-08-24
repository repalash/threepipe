---
prev: 
    text: '@threepipe/plugin-path-tracing'
    link: './plugin-path-tracing'

next:
  text: '@threepipe/plugin-r3f'
  link: './plugin-r3f'

aside: false
---

# @threepipe/plugin-timeline-ui

A timeline UI component and panel for Threepipe Viewer and Editor to preview and edit global timeline for viewer animations and plugins.

[Example](https://threepipe.org/examples/#timeline-ui-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/timeline-ui/src/TimelineUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/timeline-ui/docs/classes/TimelineUiPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-timeline-ui.svg)](https://www.npmjs.com/package/@threepipe/plugin-timeline-ui)

```bash
npm install @threepipe/plugin-timeline-ui
```

<iframe src="https://threepipe.org/examples/timeline-ui-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Timeline UI Plugin Example"></iframe>

Includes `TimelineUiPlugin` that creates and manages the react component of the timeline ui. 

To use the plugin, simply add it to the viewer or editor:

```typescript
import { ThreeViewer } from 'threepipe';
import { TimelineUiPlugin } from '@threepipe/plugin-timeline-ui';

const viewer = new ThreeViewer({...});
const root = document.body // set a custom html root to add the timeline panel, document.body is the default if not passed
const timelineUi = viewer.addPluginSync(new TimelineUiPlugin(root));
```

The UI is shown while the plugin is `enabled`. To to remove/unmount the UI, you can disable the plugin, enabling it again will re-render the UI:

```typescript
timelineUi.enabled = false; // this will remove the UI from the DOM
timelineUi.enabled = true; // this will re-render the UI
```

The React component can also be used in a standalone react application. Import the `Timeline`(react component), and `TimelineManager`, from the `src` directory and use it in your application:

```tsx
import {Timeline} from '@threepipe/plugin-timeline-ui/src/Timeline';
import {useEffect, useRef} from 'react';
import {TimelineManager} from "@threepipe/plugin-timeline-ui/src/TimelineManager";
import {ThreeViewer} from "./ThreeViewer";

const viewer = new ThreeViewer({...}); // Initialize your ThreeViewer instance, check the react docs for more details

export function MyTimeline() {
    const manager = new TimelineManager(viewer);

    return (
        <Timeline
            manager={manager}
            closeTimeline={()=>{
                console.log('User clicked the close button');
            }}
        />
    );
}
```
