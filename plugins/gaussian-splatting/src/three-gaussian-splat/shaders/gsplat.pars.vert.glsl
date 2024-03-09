// https://github.com/vincent-lecrubier-skydio/react-three-fiber-gaussian-splat
precision mediump float;

#ifndef SHADER_NAME // isRawShaderMaterial
attribute vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
mat3 transpose(mat3 m) { return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]); }
#endif

attribute vec4 color;
attribute vec4 quat;
attribute vec3 scale;
attribute vec3 center;

uniform vec2 focal;
uniform vec2 viewport;
//uniform vec3 sphereCenter;
//uniform vec3 planeNormal;
//uniform float planeDistance;

varying vec4 vColor;
varying vec3 vConic;
varying vec2 vCenter;
varying vec2 vPosition;
//varying float vDistance;
//varying float vPlaneSide;

mat3 compute_cov3d(vec3 scale, vec4 rot) {
    mat3 S = mat3(
    scale.x, 0.0, 0.0,
    0.0, scale.y, 0.0,
    0.0, 0.0, scale.z
    );
    mat3 R = mat3(
    1.0 - 2.0 * (rot.z * rot.z + rot.w * rot.w), 2.0 * (rot.y * rot.z - rot.x * rot.w), 2.0 * (rot.y * rot.w + rot.x * rot.z),
    2.0 * (rot.y * rot.z + rot.x * rot.w), 1.0 - 2.0 * (rot.y * rot.y + rot.w * rot.w), 2.0 * (rot.z * rot.w - rot.x * rot.y),
    2.0 * (rot.y * rot.w - rot.x * rot.z), 2.0 * (rot.z * rot.w + rot.x * rot.y), 1.0 - 2.0 * (rot.y * rot.y + rot.z * rot.z)
    );
    mat3 M = S * R;
    return transpose(M) * M;
}

vec3 compute_cov2d(vec3 center, vec3 scale, vec4 rot){
    mat3 Vrk = compute_cov3d(scale, rot);
    vec4 t = modelViewMatrix * vec4(center, 1.0);
    vec2 lims = 1.3 * 0.5 * viewport / focal;
    t.xy = min(lims, max(-lims, t.xy / t.z)) * t.z;
    mat3 J = mat3(
    focal.x / t.z, 0., -(focal.x * t.x) / (t.z * t.z),
    0., focal.y / t.z, -(focal.y * t.y) / (t.z * t.z),
    0., 0., 0.
    );
    mat3 W = transpose(mat3(modelViewMatrix));
    mat3 T = W * J;
    mat3 cov = transpose(T) * transpose(Vrk) * T;
    return vec3(cov[0][0] + 0.3, cov[0][1], cov[1][1] + 0.3);
}
