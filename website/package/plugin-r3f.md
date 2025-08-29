---
prev:
    text: 'Animation Timeline UI'
    link: './plugin-timeline-ui'

next:
  text: 'Troika Text Plugin'
  link: './plugin-troika-text'

aside: false
---

# @threepipe/plugin-r3f

[React Three Fiber](https://r3f.docs.pmnd.rs/) integration plugin for ThreePipe

[Example](https://threepipe.org/examples/#r3f-jsx-sample/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/r3f/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/r3f/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-r3f.svg)](https://www.npmjs.com/package/@threepipe/plugin-r3f)

```bash
npm install @threepipe/plugin-r3f
```

The R3F plugin provides React Three Fiber integration for ThreePipe, allowing you to create declarative React-based 3D experiences using familiar JSX syntax while leveraging ThreePipe's powerful viewer context and plugin system.

::: info Compatibility

The plugin has been tested with React 19+ and React Three Fiber 9+.

It is a work in progress and may not cover all R3F features. Contributions and feedback are welcome!

Create issues or pull requests on the [GitHub repository](https://github.com/repalash/threepipe).

:::

## Key Components

### ViewerCanvas

The main React component that wraps the ThreePipe viewer in a React context, providing access to the viewer instance throughout your component tree.

`ViewerCanvas` is the wrapper around the r3f `Canvas` component that initializes the ThreePipe viewer and provides the viewer context to all child components.

Any children added to this component are added to the scene model root.

### Asset
A component for loading scenes, models, environment maps, textures, and other assets with automatic background setup options.

This is the declarative equivalent of using the `viewer.load` function.

### Model
A component for loading 3D models (GLTF, GLB, etc.) and placing them inside the parent component.

This is the declarative equivalent of using the `viewer.import` function.

### Three.js classes

Most three.js classes can be used as is, similar to how they are used in React Three Fiber.

To use the extra features provided by threepipe and plugins, it is preferable to use the following components:  

- `mesh2` - `Mesh2`, Same as `mesh`
- `perspectiveCamera2` - `PerspectiveCamera2`, extends `PerspectiveCamera`
- `orthographicCamera2` - `OrthographicCamera2`, extends `OrthographicCamera`
- `ambientLight2` - `AmbientLight2`, extends `AmbientLight`
- `directionalLight2` - `DirectionalLight2`, extends `DirectionalLight`
- `pointLight2` - `PointLight2`, extends `PointLight`
- `spotLight2` - `SpotLight2`, extends `SpotLight`
- `hemisphereLight2` - `HemisphereLight2`, extends `HemisphereLight`
- `rectAreaLight2` - `RectAreaLight2`, extends `RectAreaLight`
- `physicalMaterial` - `PhysicalMaterial`, extends `MeshPhysicalMaterial`
- `unlitMaterial` - `UnlitMaterial`, extends `MeshBasicMaterial`
- `meshLine` - `MeshLine`, extends `Line2`
- `meshLineMaterial` - `MeshLineMaterial`, extends `LineMaterial`

For any classes that are not available yet, can be extended manually in the end code, or use `primitive` from r3f. Checkout the [r3f docs](https://r3f.docs.pmnd.rs/api/typescript#extend-usage) for more details.

## Basic Usage

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ViewerCanvas, Asset, Model } from '@threepipe/plugin-r3f'
import { LoadingScreenPlugin } from 'threepipe'

function App() {
  return (
    <ViewerCanvas
      id="three-canvas"
      style={{width: 800, height: 600}}
      plugins={[LoadingScreenPlugin]}
      onMount={async (viewer) => {
        console.log('Viewer mounted:', viewer)
      }}
    >
      <React.Suspense fallback={<div>Loading...</div>}>
        <Asset 
          url="https://samples.threepipe.org/minimal/venice_sunset_1k.hdr"
          autoSetBackground={true}
        />
        <Asset 
          url="https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf"
          autoCenter={true}
          autoScale={true}
        />
      </React.Suspense>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="orange" />
        <Asset
          url="https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf"
        />
      </mesh>
    </ViewerCanvas>
  )
}

createRoot(document.getElementById('root')).render(<App />)
```

## Advanced Usage

### Accessing Viewer Context

Use the provided hooks to access the viewer instance and its functionality:

```tsx
import { useViewer } from '@threepipe/plugin-r3f'

function MyComponent() {
  const viewer = useViewer()
  
  React.useEffect(() => {
    if (viewer) {
      // Access viewer methods and properties
      viewer.addEventListener('preFrame', (e) => {
        console.log('Frame at time:', e.time)
      })
    }
  }, [viewer])
  
  return <mesh>...</mesh>
}
```

### Using with Plugins

You can pass ThreePipe plugins to the ViewerCanvas to extend functionality:

```tsx
import { 
  ViewerCanvas, 
  Asset, 
  Model 
} from '@threepipe/plugin-r3f'
import { 
  LoadingScreenPlugin, PickingPlugin
} from 'threepipe'

function App() {
  return (
    <ViewerCanvas
      plugins={[
        LoadingScreenPlugin, PickingPlugin
      ]}
      onMount={(viewer) => {
        // Configure plugins after mount
        const tonemapPlugin = viewer.getPlugin(TonemapPlugin)
        if (tonemapPlugin) {
          tonemapPlugin.exposure = 1.5
        }
      }}
    >
      {/* Your 3D content */}
    </ViewerCanvas>
  )
}
```

## Features

- **Declarative API**: Use familiar JSX syntax to define your 3D scene
- **React Integration**: Full integration with React lifecycle and state management
- **Plugin System**: Access to all ThreePipe plugins and functionality
- **Asset Loading**: Built-in components for loading models, textures, and environments
- **Context Provider**: Viewer instance available throughout your component tree
- **TypeScript Support**: Full TypeScript definitions for type-safe development

## Samples

- [**r3f-js-sample**](https://threepipe.org/examples/#r3f-js-sample/) - Uses HTM  for JSX-like syntax without build tools.
  - Pure JavaScript approach using `htm` library for template literals
  - No build step required - runs directly in the browser
  - Perfect for quick prototyping and learning

- [**r3f-jsx-sample**](https://threepipe.org/examples/#r3f-jsx-sample/) - JSX syntax compiled in the browser using Babel.
  - Includes a 3D fallback mesh during Suspense loading
  - Great for development without local tooling setup

- [**r3f-tsx-sample**](https://threepipe.org/examples/#r3f-tsx-sample/) - Typescript JSX(TSX) syntax example.
  - TypeScript integration with type safety

- [**r3f-tsx-webgi**](https://threepipe.org/examples/#r3f-tsx-webgi/) - Typescript JSX(TSX) + Plugins example.
  - TypeScript integration with webgi plugins

- [**r3f-jsx-webgi**](https://threepipe.org/examples/#r3f-jsx-webgi/) - JSX + Plugins example.
  - Babel compiled JSX with webgi plugins

### Importing and Setup

**Web Browser (Import Maps)**
All examples use [import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to load dependencies directly in the browser without a build step. This approach is perfect for:
- Quick experimentation and prototyping
- Learning and educational purposes
- Simple deployments without build complexity

**Local Development (Vite + Node.js)**
For production applications, we recommend using a bundler like [Vite](https://vitejs.dev/) with Node.js:

```bash
npm create threepipe@latest my-r3f-app
cd my-r3f-app
npm install threepipe @threepipe/plugin-r3f
npm run dev
```

This provides:
- Hot module replacement for faster development
- Optimized builds for production
- Better error handling and debugging
- Full ecosystem tooling support

## API Reference

For detailed API documentation, visit the [API Reference](https://threepipe.org/plugins/r3f/docs/).
