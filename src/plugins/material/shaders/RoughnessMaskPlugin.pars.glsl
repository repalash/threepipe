#if defined(ROUGHNESS_MASK_ENABLED) && ROUGHNESS_MASK_ENABLED > 0

uniform sampler2D roughnessMaskMap;
uniform float roughnessMaskMin;
uniform float roughnessMaskMax;
varying vec2 vRoughnessMaskUv;

#endif
