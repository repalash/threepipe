// https://github.com/vincent-lecrubier-skydio/react-three-fiber-gaussian-splat
precision mediump float;

varying vec4 vColor;
varying vec3 vConic;
varying vec2 vCenter;

uniform vec2 viewport;
uniform vec2 focal;
uniform float minAlpha;
