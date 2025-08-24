---
prev:
    text: '@threepipe Packages'
    link: './threepipe-packages'

next:
    text: 'Loading Files'
    link: './loading-files'
---

# 3D Assets/Files

In 3D Rendering, different types of assets are used to create the final scene. These assets can include 3D models, materials, textures, environment maps, and more.

This guide explains the different types of 3D assets used in threepipe, their formats, and how they are used in a 3D scene.

For information on how to load these assets in threepipe programmatically, check the [Loading Files](./loading-files) guide.

::: tip
Most of the files can be loaded in the [Threepipe Editor](https://editor.threepipe.org) and exported to glb format for easy usage across the web.
:::

## 3D Objects/Models

[//]: # (todo image)

3D objects are the core components of a 3D scene. They contain information on the shape/structure of a 3D object along with the surface information on how the object should look.

A 3D Object/Model is not a single entity, but a combination of multiple components like geometry, materials, textures, animations, configuration etc. that together define the appearance and behavior of the object in the 3D scene.

Some examples of 3D objects include:

- Meshes (e.g., a 3D model of a car or a character)
- Lights (e.g., point lights, directional lights, spotlights)
- Cameras (e.g., perspective camera, orthographic camera)
- Lines/Curves (e.g., wireframes, paths)
- Groups (e.g., a collection of multiple 3D objects)
- Points (e.g., particle systems, point clouds)

3D objects can be stored in a variety of file formats, some of the most common ones are:

- **glTF/glb**: glTF (GL Transmission Format) is a popular file format for 3D models and scenes. It is designed for efficient transmission and loading of 3D content. GLB is the binary version of GLTF, which combines all assets into a single file. GLTF/GLB files can contain geometry, materials, textures, animations, and more. [Learn more](https://www.khronos.org/gltf/)
- **OBJ**: OBJ is a simple and widely supported file format for 3D models. It primarily stores geometry data, including vertices, faces, and texture coordinates. OBJ files can be accompanied by MTL files that define materials for the model. [Learn more](https://en.wikipedia.org/wiki/Wavefront_.obj_file)
- **FBX**: FBX (Filmbox) is a proprietary file format developed by Autodesk. It is commonly used in the film and game industries for exchanging 3D assets. FBX files can store complex data, including geometry, materials, animations, and more. [Learn more](https://en.wikipedia.org/wiki/FBX)
- **STL**: STL (Stereolithography) is a file format commonly used for 3D printing. It represents the surface geometry of a 3D object using triangular facets. STL files do not contain color or texture information. [Learn more](https://en.wikipedia.org)
- **3DM**: Rhino 3D Model file format, used by Rhinoceros 3D software. It can store complex geometries, including NURBS surfaces, meshes, and more. [Learn more](https://en.wikipedia.org/wiki/Rhino_3D)
- Many more: Threepipe supports over 50 model formats either built in, or using plugins. Check the [Loading Files](./loading-files) guide for more details.

### glTF

In Threepipe, Three.js and most web based 3d engines, **glTF** is the recommended format for 3D models due to its efficiency, versatility, and wide support. All the three.js and threepipe configuration is supported in glTF format using custom extensions that are provided out of the box with the threepipe viewer.

Most other formats are supported, common ones are built-in, and others can be added using plugins.

When using Threepipe editors, file saved or exported would be in glb format and can be used directly on websites/apps.

`glTF` is a versatile format that can store a wide range of 3D assets not necessarily limited to just models. Any 3D asset described below can be stored and reused in/as a glTF file, including geometries, materials, textures, animations, lights, cameras, and more.

::: warning Rhino 3DM files

Rhino software supports glTF export built-in/through plugins, but they are not stable, it is recommended to export to rhino's official 3DM format, import in threepipe and export to glTF/glb for best results.

:::

## Materials

[//]: # (todo image)

Materials define the appearance of 3D objects, including properties like color, texture, reflectivity, transparency, and more. Materials can be simple or complex, depending on the desired visual effect.

They are self-contained objects that contain information on the surface properties. It can be applied to any 3D object in the scene, irrespective of the geometry or shape of the object. 

Some examples of materials include:

- **Unlit Material**
  - A material that does not respond to lighting and appears flat.
  - These materials don't exist in real life, but are useful for specific visual styles or effects.
  - eg. illustrations, drawings, cartoons, billboards, UI elements, etc.
- **Physical Material** 
  - A material that simulates real-world surface properties using physically based rendering (PBR) techniques.
  - These materials are designed to mimic the way light interacts with surfaces in the real world, resulting in more realistic and visually appealing renderings.
  - eg. metals, plastics, wood, glass, etc.
- **Thick Lines** 
  - A material specifically designed for rendering thick lines in 3D space.
  - These materials are optimized for rendering lines with a specified thickness, allowing for better visibility and aesthetics in certain applications.
  - eg. wireframes, outlines, paths, etc.
- **Custom Shader Material**
  - A material that allows for custom shader code to define its appearance and behavior.
  - These materials provide flexibility and control over the rendering process, enabling developers to create unique visual effects and styles.
  - eg. procedural textures, special effects, non-photorealistic rendering, advanced materials etc.

The default workflow in threepipe is PBR (Physically Based Rendering), and materials are provided out of the box to get you started instantly.

::: details Transparency and Refraction

All materials support transparency, and physical materials support refraction(transmission) as well. There are advanced materials available with plugins that support features like anisotropy, diamond rendering etc.

Since threepipe uses forward plus rendering, opaque, transparent, transmissive objects are rendered separately and could have different performance implications and design consideration. When designing transparent materials, keep in mind that the order of rendering matters and could lead to visual artifacts if not handled properly, hence it's recommended to keep the number of transparent/transmissive objects to a minimum, and test the materials with the final model and scene settings.

:::

Materials are stored in variety of file formats, but there is no common standard for material files. They are usually stored along with the models in formats like glTF, FBX, OBJ/MTL etc. or can be created programmatically using code.

When loading a 3d object file as defined above, the materials are automatically loaded and registered in the viewer. When the file is unloaded/disposed the materials also are disposed automatically.

In threepipe however, its possible to export, import, share and re-use materials using the three.js material format (based on JSON). This allows for easy sharing and re-use of materials across different projects and scenes. The files when saved carry the extension of the format `.*mat`, and be loaded as is in threepipe.

Built in file types:

- **.pmat** - Physical Material
- **.bmat** - Unlit Material
- **.lmat** - Line Material
- **.json** - Any three.js material

Checkout the [Materials guide](./materials) for more details on different materials.

## Textures

[//]: # (todo image)

Textures are images or patterns that are applied to the surface of 3D objects to add detail and realism. They can represent various surface properties, such as color, bumpiness, reflectivity, and more.

Some common types of textures include:
- Diffuse/Albedo Map - Represents the base color of the surface.
- Normal Map - Simulates small surface details by altering the surface normals.
- Roughness Map - Defines how rough or smooth the surface appears.
- Metalness Map - Indicates which parts of the surface are metallic.
- Ambient Occlusion Map - Adds shadows in crevices and corners to enhance depth.
- Emissive Map - Makes parts of the surface appear to emit light.
- Opacity Map - Controls the transparency of the surface.
- Displacement Map - Alters the actual geometry of the surface for more pronounced details.
- Environment Map - Represents the surrounding environment for reflections and lighting.
- Background Image - A texture used as the background of the scene.
- Many more - There are several other types of textures used for specific effects and properties.

Textures are usually stored as image files in formats like JPEG, PNG, TIFF, BMP, MP4, SVG, etc. They can also be stored in specialized formats like DDS, KTX2, EXR, HDR for better performance and quality.
Textures can be created using image editing software, generated procedurally, or captured from real-world surfaces using techniques like photogrammetry.

In addition to the image data, textures can also include metadata such as wrapping mode, filtering options, scaling, centering, cropping and mipmapping settings that affect how the texture is applied to the 3D object.

When loading a 3D object file, the associated textures are usually loaded automatically along with the model and materials. In threepipe, textures can also be loaded separately using various loaders provided by three.js or through plugins.

::: tip Textures vs Images

Textures are containers for image data or basically any kind of multi-dimensional data, which may or may not be images. 
They can have different formats, types, encoding, color spaces, etc. and are optimized for use in 3D rendering.
Videos, SVGs, cube maps, 3D textures, data textures, HTML Canvas are all examples of texture data as well.

:::

Textures can be shared and re-used across different materials and objects in a scene, allowing for efficient use of resources and consistent visual style.

Textures by themselves, are generally not saved as a file, but instead stored inside the material(s) or object they are assigned to. The data of the texture (like image, video data), are generally stored as separate files and referenced in the material or object file as URLs.

::: details File Size and Performance

Textures are usually the largest assets in a 3D scene and can significantly impact the performance and loading times of a web application.
It's important to optimize textures for web use by reducing their resolution, compressing them, and using appropriate file formats.

It is also recommended to use different levels of detail (LODs) for textures(for textures larger than 4K) based on the target devices and screen sizes to ensure optimal performance across a wide range of hardware.

While it is perfectly possible to embed texture data inside the 3D Model file (like in glb), and it is the default, it's generally not recommended for production applications, and instead files should be hosted separately on a CDN and referenced using URLs in the model/material files.
This allows multiple textures to be downloaded in parallel, cached separately, and re-used across different models/materials.

:::

### Environment Maps

[//]: # (todo image)

Environment maps are special types of textures that represent the surrounding environment of a 3D scene. They are used to simulate reflections, lighting, and ambient effects on 3D objects, enhancing their realism and visual appeal.

In threepipe, it is possible to assign environment maps to the entire scene, or to individual objects/materials. The environment maps can be in the form of cube maps, equirectangular images, in HDR, EXR, JPEG, PNG formats.

When assigned to the scene, the environment map is used for image-based lighting (IBL), which provides realistic lighting and reflections based on the surrounding environment. This can significantly enhance the appearance of materials, especially those with reflective or metallic properties.

When assigned to individual objects or materials, the environment map is used for reflections and refractions specific to that object. This allows for more control over how different objects interact with the environment and can create interesting visual effects.

Built in formats for environment maps:
- **.hdr** - Radiance HDR format, commonly used for high dynamic range environment maps.
- **.exr** - OpenEXR format, another popular format for high dynamic range images.
- SDR Image formats - JPEG, PNG, etc can also be used for environment maps, but they are limited to standard dynamic range. For some scenes, it could be worth using SDR images and increasing the Environment Map Intensity to achieve HDR.


## Configuration

[//]: # (todo image)

Configuration data includes various settings and parameters that define how the 3D scene is rendered and interacted with. This can include camera settings, lighting settings, post-processing effects, animation settings, physics settings, and more.

Some examples of configuration data include:

- All viewer settings
- Camera Settings - Field of view, position, rotation, near/far clipping planes, etc.
- Post-processing settings - Settings for SSAO, Bloom, Tone Mapping, Color Grading, etc.
- Editor settings - Workspace layout, theme, grid settings, snapping settings, etc.
- Animation data - Animation speed, looping, blending, etc.
- Many more - There are several other types of configuration data used for specific effects and behaviors.

Configuration files can be downloaded from the threepipe editors, or created programmatically using code.

Types of configurations in threepipe:

- Viewer Config - **.vjson/.json** - The entire viewer state and scene settings including all(or some) plugins settings, environment maps etc can be saved as a single configuration file. This can be used to share and re-use the entire viewer state across different projects and scenes/models.
- Plugin Config - **.json** - Majority of plugins that are configurable in the editor, include a button to download the settings of that plugin as a configuration JSON file, which can be loaded in the viewer to instantly apply the same settings.

All configuration data in threepipe is in JSON or Binary JSON format. (vjson is same as json, but named separately for easy management)

::: tip Viewer Config in glTF

When exporting a glTF file in the threepipe editors, the viewer config is automatically embedded in the glTF file as a custom extension. This allows for easy sharing and re-use of the entire viewer state along with the model in a single file.

When loading a glTF file with embedded viewer config, the viewer automatically detects and applies the settings, recreating the same scene and rendering settings as in the editor.

The viewer config is embedded as JSON if using glTF, and as binary JSON if using glb format.

:::

## Geometries

[//]: # (todo image)

Geometries define the shape and structure of 3D objects. They consist of vertices, edges, and faces that form the mesh of the object.

Some common types of geometries include:

- Box Geometry - A simple cube or rectangular box shape.
- Sphere Geometry - A spherical shape.
- Plane Geometry - A flat, two-dimensional surface.
- Cylinder Geometry - A cylindrical shape.
- Complex Geometries - Custom geometries created using 3D modeling software or programmatically using code.

Geometries are usually stored as part of the 3D model file, along with materials and textures. They can also be created programmatically using code. 
There are no asset files that represent geometry data, and its stored directly in the model file. Procedural geometries like curves, terrains etc are stored as extra data as part of the model file which can be reused to re-generate the geometry if required.

In threepipe, geometries are automatically loaded and registered when a 3D model file is loaded. They can also be created and manipulated using various geometry classes provided by three.js.

Geometries can be shared and re-used across different objects in a scene, allowing for efficient use of resources and consistent visual style.

::: tip Instancing

Instancing is a technique used to efficiently render multiple copies of the same geometry with different transformations (position, rotation, scale) and materials.
This can significantly improve performance when rendering large numbers of identical objects in a scene. Instancing is supported out of the box in glTF/glb format, and is automatically used when loading models with instanced geometries.

When designing 3d models, it's recommended to use instancing for objects that are repeated multiple times in the scene, such as trees, buildings, furniture, etc.
Threepipe supports instancing out of the box, and is automatically used when loading models with instanced geometries. There are several tools and options available in the threepipe editors to create and manage instanced objects, and in some cases, automatically find and instance objects.

:::

## Animation

[//]: # (todo image)

Animations bring 3D objects to life by defining their movement and behavior over time. They can include transformations (position, rotation, scale), material changes, morph targets, skeletal animations, and more.

Some common types of animations include:
- Keyframe Animation - Defines specific keyframes for an object's properties at certain points in time, and interpolates between them.
- Skeletal Animation - Uses a skeleton of bones to animate a character or object, allowing for more complex and realistic movements.
- Morph Target Animation - Allows for smooth transitions between different shapes or expressions of a 3D object.
- Path Animation - Moves an object along a predefined path or curve.
- Procedural Animation - Generates animations programmatically using algorithms or physics simulations.
- Many more - There are several other types of animations used for specific effects and behaviors.

Animations are usually stored as part of the 3D model file, along with geometries, materials, and textures. They can also be created programmatically using code or animation software.

In threepipe, animations are automatically loaded and registered when a 3D model file is loaded. At the moment animations from glTF, fbx files are supported. They can also be created and manipulated using various animation classes provided by three.js, or using one of the many plugins available for specialized use-cases.

Animations can be shared and re-used across different objects in a scene, allowing for efficient use of resources and consistent behavior. They cannot be saved separately as files, but are always part of the 3D model file.
