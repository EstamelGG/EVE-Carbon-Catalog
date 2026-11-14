import { flareFacing, flareProfile, flareSceneDepth } from './flare-profile.js';

// For explicitly encoded gradient assets. Lamp colors are linear emissive inputs.
export const displayDecode = `
vec3 sourceDisplayToLinear(vec3 c) {
  return sRGBTransferEOTF(vec4(c, 1.0)).rgb;
}`;

// Viewer calibration. Narrow authored quads carry the streak around the core.
const flareShape = `
flat out float streakWeight;
float flareElongation(vec2 axes) {
  return 1.0 - min(axes.x, axes.y) / max(max(axes.x, axes.y), 1e-8);
}`;

export const smartFlareVertex = `
out vec2 flareUV; out float offAxis; uniform vec2 size;
${flareShape}
${flareFacing}
void main() {
  vec4 center = modelViewMatrix * vec4(0,0,0,1);
  offAxis = flareOffAxis(center.xyz);
  streakWeight = flareElongation(abs(size));
  center.xy += position.xy * size;
  flareUV = uv;
  gl_Position = projectionMatrix * center;
}`;

// EveChildQuad (carbonengine/trinity f644516) supplies parent and local
// matrices, RGB and brightness per instance. The viewer supplies the same
// view-space quad to individual draws and to Three's instanced geometry.
export function flareVertex({instanced = false, softDepth = false} = {}) {
  return `
out vec2 flareUV; out float offAxis;
${instanced ? 'in vec3 flareCenter, flareAxisX, flareAxisY, flareColor; in float flareScale; out vec3 instanceColor;'
            : 'uniform mat4 localTransform; uniform float parentScale;'}
${softDepth ? 'out float flareViewDepth, flareDepthSpan;' : ''}
${flareShape}
${flareFacing}
void main() {
  vec4 center = modelViewMatrix * vec4(${instanced ? 'flareCenter' : 'vec3(0.0)'}, 1.0);
  vec3 axisX = ${instanced ? 'flareAxisX' : 'localTransform[0].xyz'};
  vec3 axisY = ${instanced ? 'flareAxisY' : 'localTransform[1].xyz'};
  streakWeight = flareElongation(vec2(length(axisX), length(axisY)));
  float scale = ${instanced ? 'flareScale' : 'parentScale'};
  offAxis = flareOffAxis(center.xyz);
  center.xyz += (axisX * position.x + axisY * position.y) * scale;
  flareUV = uv;
  ${instanced ? 'instanceColor = flareColor;' : ''}
  ${softDepth ? 'flareViewDepth = -center.z; flareDepthSpan = sqrt(length(cross(axisX, axisY))) * abs(scale);' : ''}
  gl_Position = projectionMatrix * center;
}`;
}

export const authoredFlareVertex = flareVertex();
export const softFlareVertex = flareVertex({softDepth: true});

export function flareFragment({ softDepth = false, softFlare = false, instanced = false } = {}) {
  return `
in vec2 flareUV; in float offAxis; out vec4 fragColor;
flat in float streakWeight;
${instanced ? 'in vec3 instanceColor;' : 'uniform vec3 lightColor;'}
${flareProfile}
${softDepth ? `in float flareViewDepth,flareDepthSpan;
${flareSceneDepth}` : ''}
void main() {
  float r = min(length(flareUV * 2.0 - 1.0), 1.0);
  float visibility=1.0;
  ${softDepth ? `if (effectHasDepth) {
    float penetration = max(0.0, flareViewDepth - flareSceneDistance());
    visibility = 1.0-smoothstep(0.0,max(0.5*flareDepthSpan,1e-6),penetration);
  }` : ''}
  float radiance = ${softFlare ? 'softFlareProfile(r)' : 'quadFlare(r, streakWeight)'};
  vec3 color = ${instanced ? 'instanceColor' : 'lightColor'} * radiance * offAxis * visibility;
  fragColor = vec4(color, 0);
}`;
}
