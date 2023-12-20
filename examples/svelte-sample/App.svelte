<script>
    import {onDestroy, onMount} from 'svelte';

    const {ThreeViewer} = window.threepipe; // umd imported from unpkg in index.html
    // or
    // import {ThreeViewer} from 'threepipe'; // esm imported from npm

    let canvasRef;
    let viewer;

    onMount(() => {
        viewer = new ThreeViewer({canvas: canvasRef});

        // Load an environment map
        const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
        const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
            autoCenter: true,
            autoScale: true,
        });

        Promise.all([envPromise, modelPromise]).then(([env, model]) => {
            console.log('Loaded', model, env, viewer);
        });
    });
    onDestroy(() => viewer.dispose())

</script>

<canvas bind:this={canvasRef} id="three-canvas" style="width: 800px; height: 600px"></canvas>
