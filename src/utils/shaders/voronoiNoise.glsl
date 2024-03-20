#ifndef VORONOI_HELPER
#define VORONOI_HELPER

float voronoi_distance(vec2 a, vec2 b, float metric) {
    return distance(a, b);
}

// Blender port of the original voronoise function
float voronoi_f1_2d(in vec2 coord, in float randomness, in float flakeClamp, in float flakeRadius, inout vec3 outColor) {
    vec2 cellPosition = floor(coord);
    vec2 localPosition = coord - cellPosition;

    float minDistance = 8.0;
    vec2 targetOffset, targetPosition;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 cellOffset = vec2(i, j);
            vec2 pointPosition = cellOffset + hash3(cellPosition + cellOffset).xy * randomness;
            float distanceToPoint = voronoi_distance(pointPosition, localPosition, 1.);
            if (distanceToPoint < minDistance) {
                targetOffset = cellOffset;
                minDistance = distanceToPoint;
                targetPosition = pointPosition;
            }
        }
    }
    float outDistance = minDistance;
    float dist = step(flakeRadius, outDistance);
    outColor = hash3(cellPosition + hash3(cellPosition + targetOffset).xy * randomness + targetOffset);
    vec3 outColor1 = minDistance < flakeRadius ? outColor : vec3(0.5, 0.5, 1.);
    outDistance = mix(dist, minDistance, flakeClamp);
    outColor = mix(outColor1, outColor, flakeClamp);
    return outDistance;
}

#endif
