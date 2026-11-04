
float rnd = (random2(vUv.xy, frameCount)-0.5) * anisotropyNoise * material.roughness;

#if ANISOTROPY_TEX_MODE < 2
#if ANISOTROPY_TEX_MODE == 0 // CONSTANT rotation
float rot = saturate(anisotropyDirection) ;
//vec3 anisotropicT = normalize(mix(tbn[0], tbn[1], rot));
#else // ROTATION map
float rot = (anisotropyDirectionMapTexelToLinear(texture2D(anisotropyDirectionMap, vAnisotropy2MapUv)).r);
#endif
rot = rot * 2. * PI + rnd;
vec2 rot2 = vec2(sin(rot), cos(rot));
// Tangent rotation as in Cycles node_principled_bsdf.osl (Blender Foundation, Apache License 2.0):
// https://github.com/blender/cycles/blob/main/src/kernel/osl/shaders/node_principled_bsdf.osl

#else // DIRECTION map
vec2 rot2 = (anisotropyDirectionMapTexelToLinear(texture2D(anisotropyDirectionMap, vAnisotropy2MapUv)).rg * 2. - 1.) + vec2(rnd, rnd);
rot2 = normalize(rot2);

const float anisoSpecMultiplier = 0.25;

float matSpecAniso = (length(material.specularColor.rgb))*2.*PI;
rot2 = mix(rot2, vec2(sin(matSpecAniso), cos(matSpecAniso)), anisoSpecMultiplier);
rot2 = normalize(rot2);

#endif


vec3 anisotropicT = (tbn[0] * rot2.x + tbn[1] * rot2.y);


// reproject on normal plane
anisotropicT = normalize(anisotropicT - normal * dot(anisotropicT, normal));
vec3 anisotropicB = normalize(cross(normal, anisotropicT));

