// Three.js uses rotated view-plane offsets for camera-facing sprites.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderLib/sprite.glsl.js
// Cocos shows how a billboard axis can include 3D velocity scaled by exposure.
// https://github.com/cocos/cocos-engine/blob/d84d668450b628db22a6e96c089bea5151ace657/editor/assets/chunks/builtin/internal/particle-common.chunk#L32-L43
// Our free-rotation variant keeps the billboard's orientation and displaces each
// corner by its signed distance along the projected motion. Stage 55 records the inputs.
export const particleAttributes = `
attribute vec3 particleCenter, particleVelocity;
attribute vec2 particleSize;
attribute vec4 particleTint, particleOffset;
attribute float particleAngle, particleTile, particleStretch, particleAge;
varying vec4 gateTint, gateOffset;
varying float gateTile, gateAge;
`;

export const projectParticle = `
vec4 mvPosition = modelViewMatrix * vec4(particleCenter, 1.0);
vec2 up = vec2(sin(particleAngle), cos(particleAngle));
vec2 right = vec2(up.y, -up.x);
vec2 corner = (right * position.x + up * position.y) * particleSize;
float billboardScale = length(modelMatrix[0].xyz);
corner *= billboardScale;
mvPosition.xy += corner;

vec3 eyeVelocity = mat3(modelViewMatrix) * particleVelocity;
vec2 motionAxis = (projectionMatrix * vec4(eyeVelocity, 0.0)).xy;
float axisLength = length(motionAxis);
if (axisLength > 0.0 && particleStretch != 0.0) {
    float distanceAlongMotion = dot(corner, motionAxis / axisLength);
    mvPosition.xyz += (distanceAlongMotion * particleStretch) * eyeVelocity;
}
gl_Position = projectionMatrix * mvPosition;
gateTint = particleTint;
gateOffset = particleOffset;
gateAge = particleAge;
gateTile = particleTile;
`;

export const particleVertex = `${particleAttributes.replaceAll('attribute ', 'in ').replaceAll('varying ', 'out ')}
out vec2 gateUV;
#ifdef EVE_GPU_FOG
out vec3 fogViewPosition;
#endif
out vec3 gatePosition;
out float facing;
#ifdef EVE_CLOUD_DEPTH
out float effectDepth, cloudScale, cloudSize;
#endif
void main() {
    gateUV = uv;
    gatePosition = position;
    facing = 1.0;
    ${projectParticle}
#ifdef EVE_GPU_FOG
    fogViewPosition=mvPosition.xyz;
#endif
#ifdef EVE_CLOUD_DEPTH
    effectDepth = -mvPosition.z;
    cloudScale = max(0.000001, billboardScale);
    cloudSize = particleSize.x * billboardScale;
#endif
}`;

// EffectInfo labels UseWorldScale as the emitter's X scale. A missing control
// retains the historical default size in parent units. The ramp is our linear
// interpretation of “Velocity Stretch Suppress” over normalized particle age.
const firstChannel = (value, fallback) => Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;

export function spriteScaleControls(parameters, localX, worldX) {
  const useScale = firstChannel(parameters.UseWorldScale);
  const stretch = firstChannel(parameters.VelocityStretch, 0);
  return {
    sizeScale: useScale === 0 ? 1 : localX,
    fullStretch: useScale > 0 ? (worldX > 0 ? stretch / worldX : 0) : stretch,
    suppression: firstChannel(parameters.SpriteFactors2, 1),
  };
}
