---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ThreePipe"
  text: "3D on the Web\nMade Easy"
  tagline: "Effortlessly create 3D web experiences, from quick demos to advanced applications, with Three.js"
  image:
    src: /logo.svg
    alt: Threepipe
  actions:
    - theme: brand
      text: Examples
      link: https://threepipe.org/examples
      target: _blank
    - theme: alt
      text: Get Started
      link: ./guide/getting-started
    - theme: brand
      text: 3D glTF Editor
      link: https://editor.threepipe.org
    - theme: alt
      text: About Threepipe
      link: ./guide/introduction

features:
  - title: Start quickly
    details: Simple, intuitive API for creating 3D model viewers, configurators and editors on websites, with many built-in presets for common workflows and use-cases.
    link: ./guide/getting-started
    linkText: Get Started
  - title: 3D and glTF Editor
    details: Create, edit and configure 3D scenes in the browser. Provides a complete no-code flow to configure 3d models, configurators, animations etc
    link: ./guide/editors
    linkText: Learn More
  - title: Modular Architecture
    details: Modular architecture that allows you to easily extend the viewer, scene objects, materials, shaders, rendering, post-processing and serialization with custom functionality.
    linkText: All Features
    link: ./guide/features
  - title: Free and Open Source
    details: Threepipe is completely free and open source under the Apache license 2.0. You can use it for personal or commercial projects without any restrictions, with attribution.
    link: https://github.com/repalash/threepipe/blob/master/LICENSE
    rel: external
    target: _blank
    linkText: Apache License 2.0
  - title: Plugin system
    details: Plugin system along with a rich library of built-in plugins that allows you to add new features to the viewer, like post-processing, custom materials, etc.
    linkText: Read More
    link: ./guide/plugin-system
  - title: Rendering Pipeline
    details: Built-in post processing and modular rendering pipeline with included deferred rendering, post-processing, RGBM HDR rendering, etc
    linkText: Read More
    link: ./guide/render-pipeline
  - title: Material Extension
    details: A custom material extension framework to modify/inject/build custom shader code into existing materials at runtime from multiple plugins.
    linkText: Read More
    link: ./guide/material-extension
  - title: Asset Management
    details: Extendable asset import, export pipeline with support for gltf, glb, obj+mtl, fbx, mat(pmat/bmat), json, zip, png, jpeg, svg, webp, ktx2, ply, 3dm and many more.
    linkText: File Formats
    link: ./guide/features#file-formats
  - title: Framework Agnostic
    details: Can be used with any framework or library like React, Angular, Vue, Svelte, etc. or directly with vanilla JS/TS.
    linkText: Get Started
    link: ./guide/getting-started
  - title: TypeScript, Autocomplete
    details: Written in TypeScript with full type definitions and autocomplete support in modern IDEs. 
    link: https://github.com/repalash/threepipe
    linkText: Read the source
  - title: Serialization
    details: Automatic serialization of all viewer and plugin settings in GLB(with custom extensions) and JSON formats.
    linkText: Read More
    link: ./guide/serialization
  - title: Helpers and Optimizations
    details: Three.js optimization and helpers for managing objects, states, maintaining references, disposing objects, etc.
    linkText: Browse Features
    link: ./guide/features
  - title: UI Configuration
    details: UiConfig compatibility to automatically generate configuration UIs for viewer, plugins and three.js object dynamically in the browser.
    link: https://repalash.com/uiconfig.js/
    rel: external
    target: _blank
    linkText: Read More
  - title: 3D Model Viewer
    details: Offline 3D model viewer app to quickly preview 3d models locally on MacOS/Windows with support for viewing and converting 25 file formats to glTF. 
    link: https://3dviewer.xyz/
    linkText: Download App
    target: _blank
  - title: Advanced Rendering
    details: Supports advanced rendering plugins like SSAO, WebGi plugins(SSR, Bloom, GI), path tracing, etc for industry specific apps.
    link: https://webgi.dev/
    rel: external
    target: _blank
    linkText: Checkout WebGi
  - title: Jewelery and Fashion
    details: Compatibility with iJewel3D plugins for high-quality rendering and virtual try-on of jewelery, gemstones, diamonds, precious metals, fabric etc.
    link: https://ijewel3d.com/
    rel: external
    target: _blank
    linkText: Checkout iJewel3D

---
