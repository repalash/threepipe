
#ifdef HDRi_GROUND_PROJ
// assuming vectors are all normalized
float intersectPlane1(const in vec3 r0, const in vec3 rd, const in vec3 n, const in vec3 p0)
{
    float t = dot(p0 - r0, n) / (dot(n, rd)+1e-6);
    return t < 0. ? 1000. : t;
}
// slightly modified version
float intersectSphere1(in vec3 ro, in vec3 rd, in vec3 sph, in float rad) {
    vec3 oc = ro - sph;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - rad*rad;
    float t = b*b - c;
    return t < 0.0 ? t : -b + sqrt(t);
}

#define PI_HALF 1.5707963267948966
uniform float worldRadius;
uniform float tripodHeight;
uniform vec3 originPosition;

vec3 hdriProject(){
    vec3 p = normalize( vWorldDirection );
    vec3 camPos = cameraPosition;
    camPos.y -= tripodHeight;
    float t = intersectSphere1(camPos, p, originPosition, worldRadius);
    if(t>0.0) {
        float t2 = intersectPlane1(camPos, p, vec3(0,-1,0), originPosition + vec3(0.0, -tripodHeight, 0.0));
        p = (camPos + min(t, t2)*p)/worldRadius;
        /*
        if(t2 < t && tripodHeight < 0.001){
            // float h = dot(p.xz, p.xz);
            //vertical
            // p.y = sqrt(1.-h);

            //sterographic // https://math.stackexchange.com/questions/1729012/mapping-the-unit-disc-to-the-hemisphere
            // p.x = p.x/(h+1.0);
            // p.z = p.z/(h+1.0);
            // p.y = (h-1.0)/(h+1.0);

            // polar
            float phi = atan(p.z, p.x);
            float p1 = 0.4; // lens projection fix // experimental for hdrihaven
            float l = length(p.xz);
            p1 = (1.-p1*l)/(1.-p1);
            float theta = sin(l*PI_HALF)*PI_HALF; // cancel out projection, map [0,1] to [0, PI/2]

            p.x = sin(theta)*cos(phi)*p1;
            p.y = -cos(theta);
            p.z = sin(theta)*sin(phi)*p1;
        }
        */
    }
    else p = vec3(0.0, 1.0, 0.0);
    return p;
}
#endif
