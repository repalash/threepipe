---
prev: 
    text: '@threepipe/plugins-extra-importers'
    link: './plugins-extra-importers'

next: 
    text: '@threepipe/plugin-blend-importer'
    link: './plugin-blend-importer'

---

# @threepipe/plugin-network

Network/Cloud related plugin implementations for Threepipe.

Includes `AWSClientPlugin` and `TransfrSharePlugin`.

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-network.svg)](https://www.npmjs.com/package/@threepipe/plugin-network)

```bash
npm install @threepipe/plugin-network
```

## TransfrSharePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transfr-share-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/network/src/TransfrSharePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/network/docs/classes/TransfrSharePlugin.html)

TransfrSharePlugin provides functionality to export and upload the scene or an object as glb and provide link to share/preview/edit the files.

It uses the options from the `AssetExporterPlugin` to export the scene or object, and can be configured using its ui.

Uses the free service [transfr.one](https://transfr.one/) by default which deletes the files after a certain time, but the url can be changed to a custom backend or a self-hosted version of transfr.

::: tip Note
Since the uploaded files are publicly accessible by anyone by default, it is recommended to encrypt the file using the exporter options or use a secure backend.
:::

```typescript
import {ThreeViewer} from 'threepipe'
import {TransfrSharePlugin} from '@threepipe/plugin-network'

const viewer = new ThreeViewer({...})

// Add the plugin
const sharePlugin = viewer.addPluginSync(new TransfrSharePlugin())

// when sharing, this query param is set to the model link
sharePlugin.queryParam = 'm' // this is the default
// used when clicking/calling Share page link
sharePlugin.pageUrl = window.location.href // this is the default

// used when clicking/calling Share viewer link
sharePlugin.baseUrls.viewer = 'https://threepipe.org/examples/model-viewer/index.html'
// used when clicking/calling Share editor link
sharePlugin.baseUrls.editor = 'https://threepipe.org/examples/tweakpane-editor/index.html'

// set to a custom server
// sharePlugin.serverUrl = 'https://example.com/'

// upload and get the link of the 3d model
const link = await sharePlugin.getLink()
// or upload and get the share link with a base page. And also copy to clipboard and shows a alert prompt(using viewer.dialog)
const link2 = await sharePlugin.shareLink('https://example.com/custom_viewer')
// or get the editor link directly 
const link3 = await sharePlugin.shareEditorLink()

// to encrypt
const assetExporterPlugin = viewer.getPlugin(AssetExporterPlugin) // this is a dependency, so automatically added
assetExporterPlugin.encrypt = true
// assetExporterPlugin.encryptKey = 'password' // user will be prompted for password when exporting if this is commented 

await sharePlugin.shareViewerLink()
```

## AWSClientPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#aws-client-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/network/src/AWSClientPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/network/docs/classes/AWSClientPlugin.html)

Provides `fetch` function that performs a fetch request with AWS v4 signing.
This is useful for connecting to AWS services like S3 directly from the client.
It also interfaces with the `FileTransferPlugin` to directly upload file when exported with the viewer or the plugin.

::: danger Note
Make sure to use keys with limited privileges and correct CORS settings.
All the keys will be stored in plain text if `serializeSettings` is set to true
:::

```typescript
import {ThreeViewer} from 'threepipe'
import {AWSClientPlugin} from '@threepipe/plugin-network'

const viewer = new ThreeViewer({...})

const awsPlugin = viewer.addPluginSync(new AWSClientPlugin())
// set parameters and export. This can all be done from the UI also.
awsPlugin.accessKeyId = '00000000000000000000'
awsPlugin.accessKeySecret = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
awsPlugin.endpointURL = 'https://s3.amazonaws.com/bucket/'
awsPlugin.pathPrefix = 'some/path/'
// or load a json file with the parameters
// the json file can be creating by entering the data in the UI and clicking the download preset json option.
await viewer.load('file.json')

// this will export the scene as glb
const blob = await viewer.exportScene()

// for a plugin config
// blob = await viewer.export(viewer.getPlugin(GroundPlugin))
// for a material
// blob = await viewer.export(object.material)
// for an object/mesh
// blob = await viewer.export(object, {exportExt: 'glb'})

// upload to s3. needs the parameters to be correct
await viewer.exportBlob(blob, 'filename.glb')
```

::: tip Note
CORS should be enabled for the S3 bucket on the domain where the viewer is hosted. This requirement can be bypassed during development by setting `AWSClientPlugin.USE_PROXY = true`. A free proxy is already set by default and can be changed by setting `AWSClientPlugin.PROXY_URL`.
:::
