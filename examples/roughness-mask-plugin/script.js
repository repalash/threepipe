import { _testFinish, _testStart, LoadingScreenPlugin, Mesh, PhysicalMaterial, RepeatWrapping, RoughnessMaskPlugin, SphereGeometry, ThreeViewer, } from 'threepipe';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
/**
 * Pale Pink Carrara Marble, ported from the AMD GPUOpen MaterialX (standard_surface) definition.
 * Source: https://matlib.gpuopen.com/main/materials/all?material=2949ebe0-bbda-4ba8-839e-1b5733adb90b
 * The original .mtlx sits next to this file.
 *
 * The whole nodegraph is:
 *   texcoord(0) * UVScale  ->  uv for the baseColor, normal and mask images
 *   specular_roughness      =  mix(RoughnessMin, RoughnessMax, mask.r)   <- this is RoughnessMaskPlugin
 *
 * Everything else on the standard_surface is at its default (metalness 0, specular 1, IOR 1.5,
 * coat 0, sheen 0), and `coat_normal`/`tangent` just pass through the geometric normal/tangent,
 * so they all map onto a stock PhysicalMaterial.
 */
const UV_SCALE = 2; // <constant name="UVScale">
const ROUGHNESS_MIN = 0.0; // <constant name="RoughnessMin">, the `bg` of the <mix>
const ROUGHNESS_MAX = 0.9150000214576721; // <constant name="RoughnessMax">, the `fg` of the <mix>
const BASE_WEIGHT = 0.8; // standard_surface `base`, which scales base_color
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        plugins: [LoadingScreenPlugin],
    });
    const roughnessMask = viewer.addPluginSync(RoughnessMaskPlugin);
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr');
    const [baseColorMap, normalMap, maskMap] = await Promise.all([
        viewer.load('https://samples.threepipe.org/textures/Pale_Pink_Carrara_Marble_baseColor.png'),
        viewer.load('https://samples.threepipe.org/textures/Pale_Pink_Carrara_Marble_Normal.png'),
        viewer.load('https://samples.threepipe.org/textures/Pale_Pink_Carrara_Marble_Mask.png'),
    ]);
    // the <image> nodes are all periodic and share `texcoord * UVScale`.
    for (const tex of [baseColorMap, normalMap, maskMap]) {
        if (!tex)
            continue;
        tex.wrapS = tex.wrapT = RepeatWrapping;
        tex.repeat.set(UV_SCALE, UV_SCALE);
        tex.needsUpdate = true;
    }
    const material = new PhysicalMaterial({
        map: baseColorMap ?? null,
        // heads up: the 1k/8b Normal.png in this material is a constant (127,127,255), i.e. a flat
        // tangent-space normal. It is bound to stay faithful to the graph, but it perturbs nothing.
        normalMap: normalMap ?? null,
        metalness: 0,
        ior: 1.5,
    });
    material.color.setScalar(BASE_WEIGHT);
    // roughnessFactor = mix(0, 0.915, mask.r). The mask is data, not color, so it is sampled linearly.
    roughnessMask.enableRoughnessMask(material, maskMap, ROUGHNESS_MIN, ROUGHNESS_MAX, 'r');
    viewer.scene.addObject(new Mesh(new SphereGeometry(1, 64, 32), material));
    ui.setupPluginUi(RoughnessMaskPlugin);
    ui.appendChild(roughnessMask.materialExtension.getUiConfig?.(material), { expanded: true });
    ui.appendChild(material.uiConfig);
}
_testStart();
init().finally(_testFinish);
