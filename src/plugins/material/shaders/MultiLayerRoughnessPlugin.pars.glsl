// MultiLayerRoughnessPlugin - multi-lobe specular ("reflection tail-off")
// Injected into lights_physical_pars_fragment before RE_Direct_Physical.
#if defined( MLR_LAYER_COUNT ) && MLR_LAYER_COUNT > 0

#define MLR_MAX_LAYERS 4

#ifndef D_mlrLayers
#define D_mlrLayers
// x = effective weight (precomputed on CPU from blend mode), y = roughness, z = baseInfluence, w = unused
uniform vec4 mlrLayers[ MLR_MAX_LAYERS ];
// effective weight of the base specular lobe (precomputed on CPU from blend mode)
uniform float mlrBaseWeight;
#endif

// per-layer IBL radiance, accumulated in lights_fragment_maps, consumed in RE_IndirectSpecular_Physical
vec3 mlrRadiances[ MLR_MAX_LAYERS ] = vec3[ MLR_MAX_LAYERS ]( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );

float mlrLayerRoughness( const in vec4 layer, const in float baseRoughness ) {
	// 0.0525 = min roughness clamp used by three.js for PhysicalMaterial
	return clamp( layer.y + baseRoughness * layer.z, 0.0525, 1.0 );
}

#endif
