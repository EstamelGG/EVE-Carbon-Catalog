// Finite circular Gaussian on the unit disc, truncated at the sprite edge.
// PBRT 4e, Image Reconstruction::Gaussian Filter. The two widths represent
// compact and broad sources; amplitudes are the viewer's linear HDR gains.
export const flareFacing = `
float flareOffAxis(vec3 viewPosition) {
  float distanceToEye=length(viewPosition);
  if(distanceToEye==0.0)return 0.0;
  float cosine=max(-viewPosition.z/distanceToEye,0.0);
  return cosine*cosine*cosine*cosine;
}`;

export const flareProfile = `
float flareGaussian(float r,float sharpness){
  float edge=exp(-sharpness);
  return max(0.0,(exp(-sharpness*r*r)-edge)/(1.0-edge));
}
float regularFlare(float r) {
  return 12.0*flareGaussian(r,64.0)+2.0*flareGaussian(r,4.0);
}
// Viewer approximation for flarequad.fx, calibrated on two Jita views.
// Use the authored quad aspect for the streak. Round quads carry the core alone.
float quadFlare(float r, float streakWeight) {
  float r2 = r * r;
  float core = (1.0 - r2) / (160.0 * r2 + 0.0009);
  return core + 12.0 * streakWeight * flareGaussian(r, 36.0);
}
float softFlareProfile(float r) {
  return 0.7*flareGaussian(r,4.0);
}`;

// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/packing.glsl.js
export const flareSceneDepth = `
#include <packing>
uniform sampler2D effectSceneDepth;
uniform vec2 effectDepthSize, effectCameraRange;
uniform bool effectHasDepth;
float flareSceneDistance() {
  float depth = texture(effectSceneDepth, gl_FragCoord.xy / effectDepthSize).r;
  return -perspectiveDepthToViewZ(depth, effectCameraRange.x, effectCameraRange.y);
}`;

// Fade the fraction of a camera-facing light quad that has crossed the opaque
// scene. This avoids the straight cut produced by a binary depth test while
// retaining the scene depth rejection for portions wholly behind geometry.
export const softSceneVisibility = `
float softSceneVisibility(float viewDepth, float depthSpan) {
  if (!effectHasDepth) return 1.0;
  float penetration = max(0.0, viewDepth - flareSceneDistance());
  return 1.0 - smoothstep(0.0, max(0.5 * depthSpan, 1e-6), penetration);
}`;
