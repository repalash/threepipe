---
prev:
  text: 'Setting Background Color and Images'
  link: './scene-background'

next: 
  text: 'Using Vanilla Three.js style code'
  link: './vanilla-threejs'
aside: false
---

# ShaderToy Shaders in Three.js

This tutorial shows how to use shaders from ShaderToy in a Three.js scene by using them as custom screen shaders. You'll learn how to run ShaderToy shaders in a Three.js context, pass uniforms, and create interactive controls.

<iframe src="https://threepipe.org/examples/shadertoy-player/" style="width:100%;height:600px;border:none;" loading="lazy" title="Threepipe Shader Toy Player Example"></iframe>

## Overview

ShaderToy is a popular online shader editor that uses a specific format for fragment shaders. To use these shaders in Three.js, we need to:

1. Set up the proper uniforms that ShaderToy expects
2. Create a custom material that wraps the ShaderToy shader
3. Use it as a screen shader in threepipe
4. Handle mouse input and time updates

## Step 1: Setting Up the Basic Structure

First, let's create a new project or install `threepipe`, `@threepipe/plugin-tweakpane`(into existing project) and import the necessary modules in your project:

```bash
# If you are starting a new project, use the following command to create a new threepipe project
npm create threepipe@latest
# If you are adding to an existing project, install threepipe and the Tweakpane UI plugin
npm install threepipe @threepipe/plugin-tweakpane
```

Import the required modules in your JavaScript or TypeScript file:

```typescript
import {
    ExtendedShaderMaterial,
    glsl,
    GLSL3,
    LoadingScreenPlugin,
    MaterialExtension,
    ThreeViewer,
    Vector2,
    Vector3,
    Vector4,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
```

::: tip
Checkout the [Quickstart section](./../guide/getting-started#quickstart) for more details on how to set up a basic threepipe project.
:::

## Step 2: Define ShaderToy Uniforms

ShaderToy shaders expect specific uniforms. Create these to match the ShaderToy specification:

```typescript
const uniforms = {
    iResolution: {value: new Vector3()},     // viewport resolution
    iTime: {value: 0},                      // shader playback time
    iFrame: {value: 0},                     // current frame number
    iMouse: {value: new Vector4()},         // mouse pixel coords
    iTimeDelta: {value: 0},                 // render time delta
    iDate: {value: new Vector4()},          // current date
    iFrameRate: {value: 0},                 // frame rate
    iChannel0: {value: null},               // texture channels
    iChannel1: {value: null},
    iChannel2: {value: null},
    iChannel3: {value: null},
    // Additional uniforms for channel sizes
    iChannel0Size: {value: new Vector2()},
    iChannel1Size: {value: new Vector2()},
    iChannel2Size: {value: new Vector2()},
    iChannel3Size: {value: new Vector2()},
    
    // Custom uniforms for shader parameters
    customFloat: {value: 0.5},              // Sample float parameter
    customColor: {value: new Vector3(1.0, 0.5, 0.2)}, // Sample color parameter
    customIntensity: {value: 1.0},          // Sample intensity parameter
}
```

### Adding Custom Parameters

You can extend the uniforms object with any custom parameters your shader needs. These will be available in your fragment shader and can be controlled through the UI. Common types include:

- **Float values**: For controlling intensity, speed, scale, etc.
- **Vector3 colors**: For color parameters
- **Vector2/Vector3/Vector4**: For vectors
- **Boolean flags**: For enabling/disabling effects (passed as floats: 0.0 or 1.0)

## Step 3: Create the Shader Material

The fragment shader needs to be adapted to work with Three.js. Here's the wrapper that makes ShaderToy shaders compatible:

```glsl
precision highp int;
precision highp sampler2D;

uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iTimeDelta;
uniform int iFrame;
uniform float iFrameRate;

// Channel uniforms
uniform vec2 iChannel0Size;
uniform vec2 iChannel1Size;
uniform vec2 iChannel2Size;
uniform vec2 iChannel3Size;

in vec2 vUv;
layout(location = 0) out vec4 glFragColor;

void main() {
    // Set up channel resolutions
    vec3 iChannelResolution[4];
    iChannelResolution[0] = vec3(iChannel0Size, 1.0);
    iChannelResolution[1] = vec3(iChannel1Size, 1.0);
    iChannelResolution[2] = vec3(iChannel2Size, 1.0);
    iChannelResolution[3] = vec3(iChannel3Size, 1.0);

    // Call the ShaderToy main function
    mainImage(glFragColor, gl_FragCoord.xy);
    
    // Apply screen shader processing
    vec4 diffuseColor = glFragColor;
    #glMarker
    glFragColor = diffuseColor;
    
    // Ensure alpha is 1.0 for screen shaders
    glFragColor.a = 1.0;
}
```

The shader calls the `mainImage` function, which is where your ShaderToy code will go. This function should be defined in your ShaderToy code and will receive the `fragColor` and `fragCoord` parameters.

Since this is not defined in the shader itself, it will not compile without a material extension that injects the `mainImage` function.

::: info Note `glMarker`
The `#glMarker` directive is a placeholder for the `ScreenPass` in threepipe that indicates where the screen shader extensions should be added. These include extensions by plugins like `TonemapPlugin`, `VignettePlugin`, etc.
You can remove it if you don't need these extensions. 

`diffuseColor` is the final color output of the shader, which will be modified by the screen shader extensions.
Checkout the [Screen Pass guide](./../guide/screen-pass) for more information on how screen shaders work in threepipe.
:::

## Step 4: Create the Material Extension

Use a `MaterialExtension` to inject your ShaderToy code:

```typescript
const toyExtension: MaterialExtension = {
    parsFragmentSnippet: `
        unfiform float customFloat;
        uniform vec3 customColor;
        uniform float customIntensity;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec2 uv = fragCoord / iResolution.xy;
            fragColor = vec4(uv * customIntensity, 0, 1);
        }
    `,
    isCompatible: () => true,
    computeCacheKey: Math.random().toString(),
}
```

Here, `parsFragmentSnippet` is added to the material's fragment shader just before the main function. 
You can replace it with your ShaderToy code with any custom uniforms you need.

Checkout the [Material Extension guide](./../guide/material-extension) for more information.

This has a default shader, but you can dynamically change the `parsFragmentSnippet` to load different ShaderToy shaders at runtime.

```typescript
const response = await fetch('https://samples.threepipe.org/shaders/tunnel-cylinders.glsl')
const shaderText = await response.text()
toyExtension.parsFragmentSnippet = v
toyExtension.computeCacheKey = Math.random().toString()
material.setDirty()
```

## Step 5: Set Up the Material and Viewer

Create the [`ExtendedShaderMaterial`](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html) and configure the viewer:

```typescript
const material = new ExtendedShaderMaterial({
    uniforms: uniforms,
    defines: {
        IS_SCREEN: '1',
        IS_LINEAR_OUTPUT: '1',
    },
    glslVersion: GLSL3,
    vertexShader: toyVert,
    fragmentShader: toyFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: false,
})

material.registerMaterialExtensions([toyExtension])

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas'),
    msaa: false,
    rgbm: false,
    tonemap: false,
    screenShader: material,  // Use as screen shader/material
    renderScale: 2,
})
```

The material is set as the `screenShader` in the viewer configuration, which sets it as material in the `ScreenPass`. Check out the [Screen Pass guide](./../guide/screen-pass) for more details on how custom screen shaders/materials work in threepipe.

::: info Note `ExtendedShaderMaterial`
[`ExtendedShaderMaterial`](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html) is a custom material that allows dynamic shader code injection and supports the `MaterialExtension` system.
It extends the standard `ShaderMaterial` to provide additional features like automatic uniform management, shader code injection, compatibility with the threepipe material extension system, and automatic texture encoding and size support.
It is used here to apply the ShaderToy shader as a screen shader in the viewer.
:::

## Step 6: Handle Time and Frame Updates

Update the uniforms each frame to animate the shader:

```typescript
viewer.addEventListener('preFrame', (ev) => {
    if (!params.running && !params.stepFrame) return

    // Update time uniforms
    uniforms.iTimeDelta.value = (ev.deltaTime || 0) / 1000.0
    params.time += uniforms.iTimeDelta.value
    uniforms.iTime.value = params.time
    uniforms.iFrame.value = params.frame++

    // Update date
    const date = new Date()
    uniforms.iDate.value.set(
        date.getFullYear(), 
        date.getMonth(), 
        date.getDate(), 
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
    )

    // Update resolution
    const bufferSize = [
        viewer.renderManager.renderSize.width * viewer.renderManager.renderScale,
        viewer.renderManager.renderSize.height * viewer.renderManager.renderScale
    ]
    uniforms.iResolution.value.set(bufferSize[0], bufferSize[1], 1)

    material.uniformsNeedUpdate = true
    viewer.setDirty()
})
```

## Step 7: Handle Mouse Input

Implement mouse tracking to match ShaderToy's mouse behavior:

```typescript
const mouse = {
    position: new Vector2(),
    clickPosition: new Vector2(),
    isDown: false,
    isClick: false,
}

function getMouseFromEvent(canvas, e) {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
    return mouse.position.set(x / rect.width, 1.0 - y / rect.height)
}

// Update mouse uniform in preFrame event
uniforms.iMouse.value.set(
    mouse.position.x * bufferSize[0],
    mouse.position.y * bufferSize[1],
    mouse.clickPosition.x * (mouse.isDown ? 1 : -1) * bufferSize[0],
    mouse.clickPosition.y * (mouse.isClick ? 1 : -1) * bufferSize[1]
)
```

Checkout the example code for the full boilderplate for mouse handling, including adding event listeners for `mousedown`, `mouseup`, and `mousemove` to update the `mouse` object.

## Step 8: Add Interactive Controls

Create a UI to control the shader, including custom uniform parameters:

```typescript
// Define parameters object to store UI-controlled values
const params = {
    resolution: new Vector2(1280, 720),
    time: 0,
    frame: 0,
    running: true,
    stepFrame: false,
    // Custom parameters
    customFloat: 0.5,
    customColor: new Color(),
    customIntensity: 1.0,
}

const ui = {
    label: 'Shader Controls',
    type: 'folder',
    expanded: true,
    value: params,
    children: [{
        type: 'button',
        label: () => params.running ? 'Pause' : 'Play',
        onClick: () => {
            params.running = !params.running
        },
    }, {
        type: 'button',
        label: 'Reset',
        onClick: () => {
            params.frame = 0
            params.time = 0
        },
    }, {
        type: 'folder',
        label: 'Custom Parameters',
        expanded: true,
        children: [{
            type: 'slider',
            path: 'customFloat',
            label: 'Sample Float',
            bounds: [0, 1],
            stepSize: 0.01,
            onChange: () => {
                uniforms.customFloat.value = params.customFloat
                material.uniformsNeedUpdate = true
                viewer.setDirty()
            },
        }, {
            type: 'color',
            path: 'customColor',
            label: 'Sample Color',
            onChange: () => {
                uniforms.customColor.value.set(
                    params.customColor.r,
                    params.customColor.g,
                    params.customColor.b
                )
                material.uniformsNeedUpdate = true
                viewer.setDirty()
            },
        }, {
            type: 'slider',
            path: 'customIntensity',
            label: 'Intensity',
            bounds: [0, 3],
            stepSize: 0.1,
            onChange: () => {
                uniforms.customIntensity.value = params.customIntensity
                material.uniformsNeedUpdate = true
                viewer.setDirty()
            },
        }],
    }, {
        type: 'button',
        label: 'Edit Shader',
        onClick: () => setupShaderEditor(toyExtension.parsFragmentSnippet, setShader),
    }],
}

const uiPlugin = viewer.addPluginSync(new TweakpaneUiPlugin(true))
uiPlugin.appendChild(ui)
```

### UI Control Types

The TweakpaneUiPlugin supports various control types for different uniform parameters:

- **slider**: For numeric values with min/max bounds
- **color**: For RGB color values (automatically converts to Vector3)
- **button**: For triggering actions
- **checkbox**: For boolean values
- **folder**: For grouping related controls
- **vec**: For Vector2/Vector3/Vector4 values (like resolution)

### Connecting UI to Uniforms

Each UI control should have an `onChange` callback that:
1. Updates the corresponding uniform value
2. Sets `material.uniformsNeedUpdate = true`
3. Calls `viewer.setDirty()` to trigger a re-render

## Step 9: Dynamic Shader Loading

Implement a function to update the shader dynamically:

```typescript
const setShader = (shaderCode) => {
    toyExtension.parsFragmentSnippet = shaderCode
    toyExtension.computeCacheKey = Math.random().toString()
    material.setDirty()
    viewer.setDirty()
}

// Load a shader from URL
const response = await fetch('path/to/shader.glsl')
const shaderText = await response.text()
setShader(shaderText)
```

## Texture Channels

Textures can be set in the uniforms for the shader channels, or can be added to the UI config to configure dynamically:

```typescript
uniforms.iChannel0.value = await viewer.load('path/to/texture0.png')
// ...

// sample to add to the UI
const uiConfig = {
    type: 'image',
    property: [uniforms.iChannel0, 'value'],
    label: 'iChannel0',
    onChange: ()=>{
        material.uniformsNeedUpdate = true
        material.setDirty()
    }
}
ui.appendChild(uiConfig)
```

## ShaderToy post-processing

Since the material is added as the `screenShader`, it is rendered in `ScreenPass` after other passes like `RenderPass`, etc. 
Output of these can be used to in the shader toy shader to blend the 3d scene with a custom shadertoy effect.

This can be done by defining and accessing the `tDiffuse` and `tTransparent` uniforms in the material and shader code.
Check out the [ScreenPass.glsl](https://github.com/repalash/threepipe/blob/master/src/postprocessing/ScreenPass.glsl) for a sample of how to access these textures in the shader code, as well as interfacing with the gbuffer.

Check the [Screen Pass guide](./../guide/screen-pass) for more details and an example.

## Key Points

1. **Screen Shader Usage**: The material is used as a `screenShader` in the viewer configuration, which applies it as a post-processing effect.

2. **Uniform Management**: All ShaderToy uniforms must be properly updated each frame for the shader to work correctly.

3. **Coordinate Systems**: Pay attention to coordinate system differences between ShaderToy and Three.js, especially for mouse coordinates.

4. **Performance**: Screen shaders run on every pixel, so complex shaders can impact performance significantly.

5. **Material Extensions**: Using MaterialExtension allows dynamic shader code injection without recreating the entire material.

This setup provides a complete ShaderToy player that can run most ShaderToy shaders with proper time, mouse, and resolution handling, plus interactive controls for experimentation.

Check out the [live example](https://threepipe.org/examples/shadertoy-player/) to see it in action along with the source code on [GitHub](https://github.com/repalash/threepipe/tree/master/examples/shadertoy-player/script.ts).

