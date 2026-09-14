import { _testFinish, _testStart, BaseGroundPlugin, BoxGeometry, Color, CylinderGeometry, GBufferPlugin, GeometryGeneratorPlugin, LoadingScreenPlugin, Mesh, MultiLayerRoughnessPlugin, PhysicalMaterial, PickingPlugin, PlaneGeometry, SphereGeometry, SSAAPlugin, SSAOPlugin, ThreeViewer, TorusGeometry, VignettePlugin, } from 'threepipe';
import { FontLibrary, GeometryGeneratorExtrasPlugin } from '@threepipe/plugin-geometry-generator';
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane';
import { AnisotropyPlugin, BloomPlugin, SSReflectionPlugin, TemporalAAPlugin } from '@threepipe/webgi-plugins';
// "Reflection tail-off" on real-world metals - an elevator lobby at night, like the elevator reference
// in the video this plugin is based on. The brushed elevator doors show a sharp core reflection with an
// anisotropic falloff on top (MultiLayerRoughness + Anisotropy), the brass bin shows the same on a
// colored metal (where faking the effect with clearcoat would tint incorrectly), and the neon sign
// reflects in the doors and the polished floor through screen-space reflections.
//
// Note: SSR reads the base roughness from the GBuffer, so the neon reflections are spread by the base
// lobe only - the tail-off layers show in the environment reflections on the metals.
async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas'),
        msaa: true,
        rgbm: true,
        maxHDRIntensity: 8,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, GBufferPlugin, SSAAPlugin, SSAOPlugin, TemporalAAPlugin, BloomPlugin, PickingPlugin],
    });
    viewer.renderManager.stableNoise = true;
    const mlr = viewer.addPluginSync(MultiLayerRoughnessPlugin);
    const anisotropy = viewer.addPluginSync(AnisotropyPlugin);
    const ssrefl = viewer.addPluginSync(new SSReflectionPlugin(true));
    const ground = viewer.addPluginSync(BaseGroundPlugin);
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin);
    viewer.addPluginSync(GeometryGeneratorExtrasPlugin);
    viewer.addPluginSync(new VignettePlugin());
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    await FontLibrary.Init;
    viewer.scene.backgroundColor = new Color(0x050607);
    // dark industrial environment (Poly Haven, CC0) - the bright window acts as a studio softbox
    await viewer.setEnvironmentMap('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/peppermint_powerplant_2_1k.hdr');
    viewer.scene.envMapIntensity = 1;
    viewer.scene.environmentRotation.y = 3; // turn the window towards the doors
    const add = async (mesh, name, x, y, z) => {
        mesh.name = name;
        mesh.position.set(x, y, z);
        await viewer.addSceneObject(mesh);
        return mesh;
    };
    // ── Room ──
    const wallMaterial = new PhysicalMaterial({ name: 'Wall', color: '#16181b', roughness: 0.95, metalness: 0 });
    await add(new Mesh(new PlaneGeometry(9, 3.4), wallMaterial), 'Back Wall', 0, 1.7, -1.5);
    const rightWall = new Mesh(new PlaneGeometry(9, 3.4), wallMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    await add(rightWall, 'Right Wall', 2.7, 1.7, 1);
    // polished dark stone floor - SSR reflects the neon, doors and bin
    ground.size = 16;
    ground.tonemapGround = false;
    ground.material.color.set(0x0c0d0f);
    ground.material.roughness = 0.1;
    ground.material.metalness = 0.35;
    ground.material.userData.separateEnvMapIntensity = true;
    ground.material.envMapIntensity = 0.06;
    // ── Elevator doors - brushed steel, vertical brushing ──
    // sharp base + anisotropic tail-off: the core reflection stays crisp while a vertical smear glows around it
    const doorLayers = [
        { weight: 0.3, roughness: 0.3, baseInfluence: 0 },
        { weight: 0.1, roughness: 0.62, baseInfluence: 0 },
    ];
    for (const [i, x] of [-0.55, 0.55].entries()) {
        const material = new PhysicalMaterial({ name: `Door ${i + 1}`, color: '#eef0f2', metalness: 1, roughness: 0.06 });
        material.userData.separateEnvMapIntensity = true;
        material.envMapIntensity = 1.6;
        MultiLayerRoughnessPlugin.AddMultiLayerRoughness(material, { layers: doorLayers });
        const door = await add(new Mesh(new BoxGeometry(1.05, 2.25, 0.05), material), `Door ${i + 1}`, x, 1.125, -1.42);
        anisotropy.enableAnisotropy(door.material, null, 1.35, 0.25, 'CONSTANT');
        door.material.userData._anisotropyDirection = Math.PI / 2; // vertical brushing
    }
    // door frame - darker satin steel
    const frameMaterial = new PhysicalMaterial({ name: 'Door Frame', color: '#878c92', metalness: 1, roughness: 0.24 });
    MultiLayerRoughnessPlugin.AddMultiLayerRoughness(frameMaterial, { layers: [{ weight: 0.2, roughness: 0.55, baseInfluence: 0 }] });
    await add(new Mesh(new BoxGeometry(2.66, 0.16, 0.1), frameMaterial), 'Door Lintel', 0, 2.33, -1.44);
    for (const [i, x] of [-1.25, 1.25].entries())
        await add(new Mesh(new BoxGeometry(0.16, 2.41, 0.1), frameMaterial), `Door Jamb ${i + 1}`, x, 1.205, -1.44);
    // call panel with glowing buttons
    const panelMaterial = new PhysicalMaterial({ name: 'Call Panel', color: '#dfe2e5', metalness: 1, roughness: 0.12 });
    MultiLayerRoughnessPlugin.AddMultiLayerRoughness(panelMaterial, { layers: [{ weight: 0.3, roughness: 0.4, baseInfluence: 0 }] });
    await add(new Mesh(new BoxGeometry(0.16, 0.46, 0.03), panelMaterial), 'Call Panel', 1.55, 1.28, -1.47);
    const buttonMaterial = new PhysicalMaterial({ name: 'Call Button', color: '#000000', metalness: 0, roughness: 0.3 });
    buttonMaterial.emissive.set(0x66d9ff);
    buttonMaterial.emissiveIntensity = 3;
    for (const [i, y] of [1.37, 1.19].entries())
        await add(new Mesh(new SphereGeometry(0.025, 32, 32), buttonMaterial), `Call Button ${i + 1}`, 1.55, y, -1.45);
    // ── Brass bin - colored brushed metal (clearcoat can't fake tail-off on colored metal) ──
    const binMaterial = new PhysicalMaterial({ name: 'Brass Bin', color: '#c9a25e', metalness: 1, roughness: 0.12 });
    binMaterial.userData.separateEnvMapIntensity = true;
    binMaterial.envMapIntensity = 1.4;
    MultiLayerRoughnessPlugin.AddMultiLayerRoughness(binMaterial, { layers: [
            { weight: 0.32, roughness: 0.38, baseInfluence: 0 },
            { weight: 0.12, roughness: 0.75, baseInfluence: 0 },
        ] });
    const bin = await add(new Mesh(new CylinderGeometry(0.27, 0.24, 0.8, 96, 1), binMaterial), 'Brass Bin', -1.85, 0.4, 0.4);
    anisotropy.enableAnisotropy(bin.material, null, 1.5, 0.3, 'CONSTANT'); // horizontal (spun) brushing
    const rimMaterial = new PhysicalMaterial({ name: 'Bin Rim', color: '#8c7340', metalness: 1, roughness: 0.3 });
    await add(new Mesh(new TorusGeometry(0.26, 0.018, 24, 100), rimMaterial), 'Bin Rim', -1.85, 0.8, 0.4)
        .then(rim => rim.rotation.x = Math.PI / 2);
    // ── Neon sign on the side wall - reflects across the doors and the floor via SSR ──
    const neon = generator.generateObject('text', {
        text: 'TAIL OFF', size: 0.3, depth: 0.05,
        alignX: 0.5, alignY: 0.5,
        curveSegments: 10,
        bevelEnabled: false,
    });
    neon.name = 'Neon Sign';
    neon.position.set(0, 2.75, -1.46); // above the elevator, like a floor indicator
    const neonMat = neon.material;
    neonMat.color.set(0x000000);
    neonMat.emissive.set(0xff2244);
    neonMat.emissiveIntensity = 6;
    neonMat.roughness = 0.4;
    neonMat.metalness = 0;
    viewer.scene.addObject(neon);
    // red neon tube on the back wall above the bin - reflects in the floor and the brass
    const tubeMaterial = new PhysicalMaterial({ name: 'Neon Tube', color: '#000000', metalness: 0, roughness: 0.4 });
    tubeMaterial.emissive.set(0xff2244);
    tubeMaterial.emissiveIntensity = 8;
    await add(new Mesh(new CylinderGeometry(0.018, 0.018, 1.6, 32, 1), tubeMaterial), 'Neon Tube', -2.25, 1.5, -1.47);
    // cyan light strip along the wall base
    const stripMaterial = new PhysicalMaterial({ name: 'Light Strip', color: '#000000', metalness: 0, roughness: 0.4 });
    stripMaterial.emissive.set(0x22ccff);
    stripMaterial.emissiveIntensity = 2.5;
    await add(new Mesh(new BoxGeometry(0.02, 0.03, 7), stripMaterial), 'Light Strip', 2.68, 0.03, 1);
    const camera = viewer.scene.mainCamera;
    camera.position.set(-1.6, 1.35, 2.85);
    camera.target.set(0.3, 1.25, -1.1);
    camera.setDirty?.();
    ui.setupPluginUi(mlr);
    ui.setupPluginUi(anisotropy);
    ui.setupPluginUi(ssrefl);
    ui.setupPluginUi(BloomPlugin);
    ui.setupPluginUi(PickingPlugin);
    ui.setupPluginUi(BaseGroundPlugin);
    window.viewer = viewer; // for debugging in console
}
_testStart();
init().finally(_testFinish);
