vec2 d = (vCenter - 2.0 * (gl_FragCoord.xy/viewport - vec2(0.5, 0.5))) * viewport * 0.5;

float power = -0.5 * (vConic.x * d.x * d.x + vConic.z * d.y * d.y) + vConic.y * d.x * d.y;

if (power > 0.0) discard;
float alpha = min(0.99, vColor.a * exp(power));
if(alpha < minAlpha) discard;

gl_FragColor = vec4(vColor.rgb, alpha);
//vec2 d = (vCenter - 2.0 * (gl_FragCoord.xy/viewport - vec2(0.5, 0.5))) * viewport * 0.5;
//
//float power = -0.5 * (vConic.x * d.x * d.x + vConic.z * d.y * d.y) + vConic.y * d.x * d.y;
//
//if (power > 0.0) discard;
//float alpha = min(0.99, vColor.a * exp(power));
//if(alpha < minAlpha) discard;
//
//diffuseColor *= vec4(vColor.rgb, alpha);
