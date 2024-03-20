vec3 cov2d = compute_cov2d(center, scale, quat);
float det = cov2d.x * cov2d.z - cov2d.y * cov2d.y;
vec3 conic = vec3(cov2d.z, cov2d.y, cov2d.x) / det;
float mid = 0.5 * (cov2d.x + cov2d.z);
float lambda1 = mid + sqrt(max(0.1, mid * mid - det));
float lambda2 = mid - sqrt(max(0.1, mid * mid - det));
vec2 v1 = 7.0 * sqrt(lambda1) * normalize(vec2(cov2d.y, lambda1 - cov2d.x));
vec2 v2 = 7.0 * sqrt(lambda2) * normalize(vec2(-(lambda1 - cov2d.x),cov2d.y));

vColor = color;
vConic = conic;
vCenter = vec2(gl_Position) / gl_Position.w;

vPosition = vec2(vCenter + position.x * (position.y < 0.0 ? v1 : v2) / viewport);
gl_Position = vec4(vPosition, gl_Position.z / gl_Position.w, 1);
