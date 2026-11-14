import { flareFacing, flareProfile, flareSceneDepth } from './flare-profile.js';

// ColorOutter is the authored resource field. Section 47 of the remediation
// log records the radial color and intersection samples used for this model.
export const twoColorFlareVertex = `
out vec2 flareUV;
out float flareAngle, flareDepth, flareSoftness;
${flareFacing}
void main() {
  vec4 point = modelViewMatrix * vec4(position.xy, 0, 1);
  flareUV = uv;
  flareAngle = 0.25 * flareOffAxis(point.xyz);
  flareDepth = -point.z;
  flareSoftness = 0.5 * length(modelMatrix[2].xyz);
  gl_Position = projectionMatrix * point;
}`;

export const twoColorFlareFragment = `
in vec2 flareUV;
in float flareAngle, flareDepth, flareSoftness;
uniform vec4 ColorInner, ColorOutter;
out vec4 fragColor;
${flareProfile}
${flareSceneDepth}
void main() {
  float radius = min(length(2.0 * flareUV - 1.0), 1.0);
  float gain = regularFlare(radius);
  float visibility = 1.0;
  if (effectHasDepth) {
    float clearance = flareSceneDistance() - flareDepth;
    visibility = clamp(clearance / max(flareSoftness, 1e-8), 0.0, 1.0);
  }
  vec4 tint = mix(ColorInner, ColorOutter, radius * sqrt(2.0));
  fragColor = tint * (gain * gain * flareAngle * visibility);
  fragColor.rgb = max(fragColor.rgb, vec3(0));
}`;
