---
prev:
  text: 'GLTF Fat/Mesh Lines'
  link: './gltf-mesh-lines'

next: 
  text: 'ShaderToy Shaders in Three.js'
  link: './shadertoy-player'
aside: false
---

# Setting Background Color and Images

The Background in `threepipe` is managed by the `scene` in the `viewer`.

It can be set to a color(using [`scene.setBackgroundColor`](https://threepipe.org/docs/classes/RootScene.html#setBackgroundColor)), a flat 2d or environment map texture(using [`scene.background`](https://threepipe.org/docs/classes/RootScene.html#background)), or both. 
When both are set, the color is multiplied with the texture, so it can be used to tint the background.

The final intensity(brightness) of the background can also be controlled with the [`scene.backgroundIntensity`](https://threepipe.org/docs/classes/RootScene.html#backgroundintensity) property on the scene.

## Background Color

To set the background color, use the `setBackgroundColor` method on the scene. This will set a solid color as the background.

```javascript
viewer.scene.setBackgroundColor(0x000000); // Set background to black
```

::: info
The color passed in can be a number (`0xff00ff`), a string(`'#ff00ff'`, `'rgba(255, 0, 255, 1)'`), or a `Color` object.

It will be converted to a `Color` object internally and set to the `backgroundColor` property of the scene.
:::

To remove the background color, set it to `null`:

```javascript
viewer.scene.setBackgroundColor(null); // Remove background color
```

To get the current background color, access the [`backgroundColor`](https://threepipe.org/docs/classes/RootScene.html#backgroundcolor) property of the scene:

```javascript
const currentColor = viewer.scene.backgroundColor; // Get current background color
console.log('#' + currentColor.getHexString()); // Log color in hex format
```

## Background Texture

An Image/Texture can be set as the background using the `viewer.setBackgroundMap` function by passing in a url, `IAsset`, `File` object or a loaded `Texture`.

```javascript
viewer.setBackgroundMap('https://example.com/path/to/texture.jpg'); // Set background texture
// or load an env map as background
viewer.setBackgroundMap('https://example.com/path/to/envmap.hdr', { 
    setEnvironment: true // if set to true, the environment map will also be set as the scene's background
});
// or set the background property directly
viewer.scene.background = viewer.load<ITexture>('https://example.com/path/to/texture.jpg')
```

If a color is set, it will be multiplied with the texture, allowing you to tint the background.

To remove the background texture, simply set it to `null`:

```javascript
viewer.setBackgroundMap(null)
// or 
viewer.scene.background = null;
```

::: tip
When setting a flat texture as the background, it will be stretched to fill the entire viewport.

This can be changed by either setting the `mapping` property of the texture to `EquirectangularReflectionMapping`. (it is set automatically when loading an appropriate HDR/EXR texture)
:::

## Transparent Background

To set a transparent background, you can set both the `scene.background` and `scene.backgroundColor` to `null`.

```javascript
viewer.scene.background = null; // Remove background texture
viewer.scene.setBackgroundColor(null); // Remove background color
```

::: info RGBM Rendering Mode
`ThreeViewer` uses `rgbm` rendering by default, which doesn't directly support transparent backgrounds.

To use transparent background with `rgbm` mode, `clipBackground` function in `ViewerRenderManager.screenPass` is used. 
This clips/removes the background color from the final render, allowing for a transparent background effect.
:::

## Clip Background

In many cases, you may want to render the background color so that it can be used by plugins/post-processing effects like bloom, reflections, etc but composite the render with transparency over other content.

This can be achieved by setting the `clipBackground` property of `ScreenPass` in the `ViewerRenderManager`. This renders the background color and texture normally, but clips it from the final render, allowing for a transparent background effect.

```javascript
viewer.renderManager.screenPass.clipBackground = true; // Enable clipping of background
```

Note that this is also automatically set when using `rgbm` rendering mode, and `null` for the background. But it will render the background first as black and clip it.
So, when using `rgbm`, set the background color to an ideal color for the scene and use `clipBackground` to remove it.

## Background Intensity

The intensity of the background can be controlled using the `backgroundIntensity` property of the scene. This property is a multiplier for the background color and texture.

This allows you to adjust the brightness of the background without changing the color or texture itself and even achieve greater than 100% brightness backgrounds for HDR rendering

```javascript
viewer.scene.backgroundIntensity = 0.5; // Set background intensity to 50%
viewer.scene.backgroundIntensity = 5; // Set background intensity to 500%
```

## Pan/Scale Background

To adjust the position or scale of the background texture, you can modify the `offset`, `center`, `repeat`, `rotation` properties of the texture. This allows you to pan or scale the background texture as needed.

```javascript
const backgroundTexture = viewer.scene.background;
if (backgroundTexture) {
    backgroundTexture.offset.set(0.1, 0.1); // Move texture by 10% in both x and y directions
    backgroundTexture.repeat.set(2, 2); // Repeat texture twice in both x and y directions
    backgroundTexture.rotation = Math.PI / 4; // Rotate texture by 45 degrees
}
```

For equirect textures, `rotation` can be set to rotate the texture around the y-axis, which can be useful for adjusting the orientation of the environment map.

```javascript
if (backgroundTexture && backgroundTexture.mapping === EquirectangularReflectionMapping) {
    backgroundTexture.rotation = Math.PI / 2; // Rotate environment map by 90 degrees
}
```

[//]: # (TODO - add example how to adjust background like css background-position, background-size, etc)

## Serialization

The background color and texture can be serialized to JSON along with the scene.

Since the scene object is part of the viewer configuration when saving a glb with config, it is also saved and applied when loading the glb.

The serialization supports colors, image urls, embedded textures with formats that require external loaders like HDR, EXR, etc.
