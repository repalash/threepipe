import * as THREE from 'threepipe';
import {Sky} from 'three/examples/jsm/objects/Sky.js';
import {BloomPlugin, SSGIPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin, SSVelocityMaterial} from '@threepipe/webgi-plugins';
import {CityStandardMaterial, CityBasicMaterial, CitySpriteMaterial, TSL, prepareCityBuffers, updateCityUniforms} from './tsl-glsl.js';

export const cityThree = {
    ...THREE,
    MeshStandardNodeMaterial: CityStandardMaterial,
    MeshBasicNodeMaterial: CityBasicMaterial,
    SpriteNodeMaterial: CitySpriteMaterial,
    PerspectiveCamera: THREE.PerspectiveCamera0,
    PhysicalLightingModel: class {},
    InterpolationSamplingType: {FLAT: 0},
    InterpolationSamplingMode: {EITHER: 0},
};

export function createViewer(canvas) {
    const query = new URLSearchParams(location.search);
    const displayScale = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(4.2e6 / (innerWidth * innerHeight))));
    const scale = Math.max(0.35, Math.min(2, Number(query.get('scale')) || displayScale));
    const viewer = new THREE.ThreeViewer({
        canvas, msaa: false, rgbm: false, zPrepass: false,
        renderScale: scale, maxRenderScale: scale,
        plugins: [THREE.GBufferPlugin, THREE.SSAAPlugin, VelocityBufferPlugin, TemporalAAPlugin, BloomPlugin],
        dropzone: false,
    });
    viewer.renderEnabled = false;
    viewer.renderManager.stableNoise = true;
    const gi = viewer.addPluginSync(new SSGIPlugin(THREE.HalfFloatType, 1, query.get('gi') !== 'off'));
    gi.pass.autoRadius = false;
    gi.pass.objectRadius = 32;
    gi.pass.rayCount = 4;
    gi.pass.stepCount = 16;
    gi.pass.power = 1;
    // The experimental PR 13 world volume spans a fixed number of probes. It is opt-in for a 40 km city.
    gi.pass.envOcclusion = query.get('envocc') === '1';
    gi.pass.method = query.get('gi') === 'rc' ? 1 : 0;
    const ssr = viewer.addPluginSync(new SSReflectionPlugin(false));
    ssr.enabled = query.get('ssr') !== 'off';
    ssr.pass.intensity = 0.5;
    viewer.cityEffects = {gi, ssr, bloom: viewer.getPlugin(BloomPlugin), taa: viewer.getPlugin(TemporalAAPlugin), velocity: viewer.getPlugin(VelocityBufferPlugin)};
    return viewer;
}

export class LightingSystem {
    constructor(scene, renderer, viewer) {
        this.scene = scene;
        this.renderer = renderer;
        this.viewer = viewer;
        this.activePresetId = '';
        this.sky = new Sky();
        this.sky.scale.setScalar(150000);
        this.sky.material.depthWrite = false;
        this.sky.material.fog = false;
        // Custom shader output must obey the viewer's linear HDR composer contract.
        scene.add(this.sky);
        this.sunLight = new THREE.DirectionalLight2(0xffffff, 5.8);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.normalBias = 0.08;
        this.sunLight.shadow.bias = -0.00005;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 2600;
        this.sunLight.shadow.camera.left = this.sunLight.shadow.camera.bottom = -260;
        this.sunLight.shadow.camera.right = this.sunLight.shadow.camera.top = 260;
        scene.addObject(this.sunLight);
        scene.add(this.sunLight.target);
        this.hemiLight = new THREE.HemisphereLight(0x9abbe6, 0xc88a62, 0.35);
        scene.add(this.hemiLight);
        this.pmremGenerator = new THREE.PMREMGenerator(renderer);
        this.envScene = new THREE.Scene();
        this.envRenderTarget = null;
        this.applyPreset('golden');
    }
    applyPreset(id) {
        const p = window.NYC.TIME_PRESETS[id] || window.NYC.TIME_PRESETS.golden;
        this.activePresetId = p.id;
        this.sunDirection = p.sunDir;
        this.sunLight.color.setHex(p.sunColor);
        this.sunLight.intensity = p.sunIntensity;
        this.hemiLight.color.setHex(p.hemiSky);
        this.hemiLight.groundColor.setHex(p.hemiGround);
        this.hemiLight.intensity = p.hemiIntensity * 0.2;
        this.scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
        const u = this.sky.material.uniforms;
        u.turbidity.value = p.turbidity;
        u.rayleigh.value = p.rayleigh;
        u.mieCoefficient.value = p.mieCoefficient;
        u.mieDirectionalG.value = p.mieDirectionalG;
        u.sunPosition.value.copy(p.sunDir);
        const city = window.NYC.cityUniforms;
        for (const [name, value] of Object.entries({uSunColor: p.sunColor, uSkyTopColor: p.skyTop, uSkyHorizonColor: p.skyHorizon})) city[name].value.setHex(value);
        city.uSkySunDir.value.copy(p.sunDir);
        city.uInteriorGlow.value = p.interiorGlow;
        city.uRoadWetness.value = p.roadWetness;
        city.uCanyonBounce.value = 0; // real SSGI replaces the upstream hand-authored canyon bounce
        this.envScene.add(this.sky);
        const old = this.envRenderTarget;
        this.envRenderTarget = this.pmremGenerator.fromScene(this.envScene, 0.04, 0.1, 200000);
        this.scene.add(this.sky);
        this.scene.environment = this.envRenderTarget.texture;
        this.scene.environmentIntensity = p.envIntensity;
        old?.dispose();
        this.sky.visible = id !== 'midnight';
        this.scene.background = new THREE.Color(p.skyHorizon);
        this.viewer?.setDirty();
        this.viewer?.cityEffects.gi.pass.denoiser.reset();
        this.viewer?.cityEffects.ssr.pass.denoiser.reset();
    }
    update(focus) {
        const extent = Math.max(260, Math.min(900, 260 + focus.y * 0.7));
        const shadow = this.sunLight.shadow.camera;
        shadow.left = shadow.bottom = -extent;
        shadow.right = shadow.top = extent;
        shadow.updateProjectionMatrix();
        const texel = extent * 2 / 2048;
        this.sunLight.target.position.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
        this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this.sunDirection, 1200);
        this.sunLight.target.updateMatrixWorld();
    }
}

export function createPostProcessing(viewer) {
    const tone = viewer.getPlugin(THREE.TonemapPlugin);
    const bloom = viewer.cityEffects.bloom;
    // Keep the ACES toe intact; ThreePipe contrast is a post-tone offset,
    // unlike the upstream scene-linear contrast curve.
    const looks = {
        golden: {exposure: 1.04, contrast: 1, saturation: 1.04, bloom: 0.12, threshold: 1.2},
        midday: {exposure: 1, contrast: 1, saturation: 1.02, bloom: 0.09, threshold: 1.35},
        twilight: {exposure: 1.06, contrast: 1, saturation: 1.04, bloom: 0.14, threshold: 1.05},
        midnight: {exposure: 1.04, contrast: 1, saturation: 1.04, bloom: 0.15, threshold: 1},
    };
    return {bloomPass: bloom.pass, applyPreset(id) {
        const p = looks[id] || looks.golden;
        tone.exposure = p.exposure;
        tone.contrast = p.contrast;
        tone.saturation = p.saturation;
        bloom.pass.intensity = p.bloom;
        bloom.pass.threshold = p.threshold;
        viewer.setDirty();
    }};
}

export function attachCity(viewer, camera) {
    camera.setCanvas(viewer.renderManager.webglRenderer.domElement);
    camera.controlsMode = '';
    camera.autoLookAtTarget = false;
    viewer.scene.mainCamera = camera;
    for (const child of [...viewer.scene.children]) {
        if (child !== viewer.scene.modelRoot && child !== camera && !child.isLight) viewer.scene.addObject(child, {autoCenter: false, autoScale: false});
    }
    const cityBuffers = prepareCityBuffers(viewer.scene, () => new SSVelocityMaterial(), viewer.cityEffects.velocity.material);
    viewer.addEventListener('postFrame', cityBuffers.afterFrame);
    const gb = viewer.getPlugin(THREE.GBufferPlugin);
    const pass = gb.pass;
    const pre = pass.preprocessObject;
    const post = pass.postprocessObject;
    pass.preprocessObject = (o) => {
        if (!o.userData.cityGBufferMaterial) return pre(o);
        const material = o.userData.cityGBufferMaterial;
        material.allowOverride = false;
        material.flagUpdaters = gb.material.flagUpdaters;
        o.forcedOverrideMaterial = material;
        return o.material;
    };
    pass.postprocessObject = (o) => { post(o); if (o.userData.cityGBufferMaterial) delete o.forcedOverrideMaterial; };
    // Shadow depth materials must not replace the velocity override.
    const velocityPass = viewer.cityEffects.velocity.pass;
    const velocityPre = velocityPass.preprocessObject;
    velocityPass.preprocessObject = (o) => {
        if (o.userData.cityVelocityMaterial) { o.forcedOverrideMaterial = o.userData.cityVelocityMaterial; return o.material; }
        const shadow = o.customDepthMaterial;
        o.customDepthMaterial = undefined;
        try { return velocityPre(o); } finally { o.customDepthMaterial = shadow; }
    };
    const velocityPost = velocityPass.postprocessObject;
    velocityPass.postprocessObject = o => { velocityPost(o); if (o.userData.cityVelocityMaterial) delete o.forcedOverrideMaterial; };
    setupEffectsUi(viewer);
}

function setupEffectsUi(viewer) {
    const panel = document.getElementById('render-effects');
    for (const [name, plugin] of Object.entries(viewer.cityEffects)) {
        if (name === 'velocity') continue;
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = plugin.enabled;
        input.addEventListener('change', () => { plugin.enabled = input.checked; viewer.setDirty(); });
        label.append(input, document.createTextNode({gi: 'SSGI', ssr: 'SSR', bloom: 'Bloom', taa: 'TAA'}[name]));
        panel.append(label);
    }
}

export {TSL, updateCityUniforms};
