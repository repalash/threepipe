<template>
  <canvas id="three-canvas" style="width: 800px; height: 600px" ref="canvasRef"></canvas>
</template>

<script>
import {LoadingScreenPlugin, ThreeViewer} from "threepipe";
import {onBeforeUnmount, onMounted, ref} from "vue"

export default {
  setup() {

    const canvasRef = ref(null);

    onMounted(() => {
      const viewer = new ThreeViewer({
        canvas: canvasRef.value,
        plugins: [LoadingScreenPlugin],
      });

      // Load an environment map
      const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
      const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
      });

      Promise.all([envPromise, modelPromise]).then(([env, model]) => {
        console.log('Loaded', model, env, viewer);
      });

      onBeforeUnmount(() => {
        viewer.dispose();
      });
    });

    return {canvasRef};
  },
};
</script>
