// Direction-space triplanar projection, shared by the live sky and linear HDR export.
// General algorithm reference (MIT), not evidence of the first viewer's origin:
// https://github.com/godotengine/godot/blob/4c311cbee68c0b66ff8ebb8b0defdd9979dd2a41/scene/resources/material.cpp#L1318-L1333
// Viewer choices, not recovered client constants: eighth powers give a 2:1 axis
// ratio >99% dominant weight; scale 2 repeats four tiles across [-1, 1].
export const starOverlayGLSL = `
  vec3 sampleStarOverlay(sampler2D starTexture, vec3 ray) {
    vec3 unitRay = normalize(ray);
    vec3 squared = unitRay * unitRay;
    vec3 fourth = squared * squared;
    vec3 weights = fourth * fourth;
    weights /= dot(weights, vec3(1.0));
    vec3 uv = unitRay * 2.0;
    return weights.x * texture2D(starTexture, uv.yz).rgb
         + weights.y * texture2D(starTexture, uv.xz).rgb
         + weights.z * texture2D(starTexture, uv.xy).rgb;
  }
`;
