import {mergeGeometries, mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {cityThree, TSL, createViewer, LightingSystem, createPostProcessing, attachCity, updateCityUniforms} from './runtime.js'

async function init() {
    Object.assign(window, {NYC: {
        THREE: cityThree, TSL,
        Addons: {mergeGeometries, mergeVertices},
        createViewer, LightingSystem, createPostProcessing, attachCity, updateCityUniforms,
    }})
    // Each upstream module attaches its exports to NYC. Keep the dependency order explicit.
    await import('./js/nyc-geodata.js')
    await import('./js/city-config.js')
    await import('./js/tsl-materials.js')
    await import('./js/trees.js')
    await import('./js/actor-models.js')
    await import('./js/vehicle-lights.js')
    await import('./js/pedestrians.js')
    await import('./js/lighting.js')
    await import('./js/city-grid.js')
    await import('./js/boroughs.js')
    await import('./js/buildings.js')
    await import('./js/landmarks.js')
    await import('./js/street-details.js')
    await import('./js/road-network.js')
    await import('./js/road-paint.js')
    await import('./js/traffic.js')
    await import('./js/controllers.js')
    await import('./js/touch-controls.js')
    await import('./js/cameras.js')
    await import('./js/nyc-map.js')
    await import('./js/scene-culling.js')
    await import('./js/main.js')
}

init().catch(error => {
    console.error(error)
    const status = document.getElementById('loading-status')
    if (status) status.textContent = `Unable to start: ${error.message}. See the browser console.`
    window.showCityRecovery?.()
})
