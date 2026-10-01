<!-- Live viewer of package/webgi-plugins (ported from the webgi.dev home page). -->
<!-- The viewer code is public/scripts/webgi-showcase.js; it reacts to the page sections and their EffectToggle switches. -->
<script setup>
import {onBeforeUnmount, onMounted, ref} from 'vue'
import {loadScript, loadThreepipeWebgi} from '../load-scripts.js'

const canvas = ref(null)
let dispose = null
let unmounted = false

onMounted(async () => {
    await loadThreepipeWebgi()
    await loadScript('/scripts/webgi-showcase.js', 'module')
    if (unmounted || !window.setupWebgiShowcase) return
    dispose = window.setupWebgiShowcase(canvas.value)
})

onBeforeUnmount(() => {
    unmounted = true
    if (dispose) dispose()
    dispose = null
})
</script>

<template>
  <div class="webgi-showcase">
    <canvas ref="canvas"></canvas>
  </div>
</template>
