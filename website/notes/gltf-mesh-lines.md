---
prev:
  text: 'Fat Lines'
  link: './fat-lines'

next: 
  text: 'Setting Background Color and Images'
  link: './scene-background'

aside: false
---

# GLTF Mesh Lines: Fat Lines in glTF

[GLTF Mesh Lines Example](https://threepipe.org/examples/#gltf-mesh-lines/)
<iframe src="https://threepipe.org/examples/gltf-mesh-lines/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="GLTF Mesh Lines Example"></iframe>

See Also: [Fat Lines Example](https://threepipe.org/examples/#fat-lines/)
See Also: [Fat Line Spiral Example](https://threepipe.org/examples/#fat-line-spiral/)

If you've ever tried to render thick ("fat") lines in three.js, especially when importing models from GLTF files, you know it can be surprisingly tricky. By default, three.js only supports 1-pixel wide lines due to WebGL limitations. This makes it difficult to achieve visually appealing, stylized, or technical line renderings directly from imported models.

The standard `THREE.Line` and `THREE.LineSegments` classes rely on basic WebGL line rendering, which is limited to a width of 1 pixel on most platforms. As a result, creating thick lines for wireframes, outlines, or technical illustrations is not possible out of the box.

To work around this, three.js provides the [Line2, LineMaterial](https://threejs.org/docs/#examples/en/lines/Line2) classes in three.js addons. 
These render lines as thin meshes, allowing for customizable widths, colors, and other properties.
The `threepipe` framework extends this further by providing an option to automatically use these advanced line types for all lines imported from GLTF files.

You can enable this feature globally by setting:

```ts
GLTFLoader2.UseMeshLines = true;
```

::: info Note
Lines imported this way do not render to the GBuffer, as the mesh-based lines are not standard webgl lines. This may change in later versions of three.js or threepipe.
:::

Once the feature is enabled, glTF files with lines will be imported using `Line2` and `LineMaterial2` instead of the default line classes.

This can be controlled per-glTF file during load with the `useMeshLines` option:

```ts
const obj = await viewer.load('model.gltf', {
  useMeshLines: false,
});
```

When enabled, all lines in the imported GLTF will use `Line2`/`LineMaterial2`, allowing you to set properties like `linewidth` (yes, it's all lowercase)

```ts
material.linewidth = 10;
```

> **Note:** The resolution of the line is set automatically based on the render size, so `linewidth` is always in pixels. If you want the line width to attenuate with distance (i.e., be in world units), you can set the `worldUnits` flag on the material to `true`.

## API Documentation

- `MeshLine` - https://threepipe.org/docs/classes/MeshLine.html
- `MeshLineSegments` - https://threepipe.org/docs/classes/MeshLineSegments.html
- `LineMaterial2`/`MeshLineMaterial` - https://threepipe.org/docs/classes/LineMaterial2.html
- `GLTFLoader2` - https://threepipe.org/docs/classes/GLTFLoader2.html
- three.js `LineMaterial` - https://threejs.org/docs/?q=line#examples/en/lines/LineMaterial
- three.js `Line2` - https://threejs.org/docs/?q=line#examples/en/lines/Line2 
