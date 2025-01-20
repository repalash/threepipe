---
prev: 
    text: 'AssetExporterPlugin'
    link: './AssetExporterPlugin'

next: 
    text: 'LoadingScreenPlugin'
    link: './LoadingScreenPlugin'

---

# FileTransferPlugin

[//]: # (todo: image)

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/FileTransferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FileTransferPlugin.html)

Provides a way to extend the `viewer.export` functionality with custom actions. It also maintains a process state for plugins like `LoadingScreenPlugin`.

This plugin is added automatically, there is no need to use it manually, unless writing a plugin to extend the export functionality.

Used in e.g. `AWSClientPlugin` to upload files directly to S3.
