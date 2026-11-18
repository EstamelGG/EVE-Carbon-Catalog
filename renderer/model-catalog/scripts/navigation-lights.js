/*! Blink timing adapted from CCP's EveSpaceObjectAttachmentUtils.cpp (© 2024 CCP ehf., MIT). See third-party-notices.txt. */
import {
  AdditiveBlending, GLSL3, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3,
} from 'three';
import { flashPulse } from './attachment-blink.js';
import { flareSceneDepth, softSceneVisibility } from './flare-profile.js';
import { beforeSceneRender } from './effect-resources.js';
import { createEffectDepth } from './effect-depth.js';
import { bindAttachmentBones } from './source-bones.js';

// CCP Trinity (MIT), EveSpaceObjectAttachmentUtils::Blink, used for the sprite's
// accompanying light. The public shader header describes the billboard inputs.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpaceObjectAttachmentUtils.cpp#L9-L41
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EveSpriteSet.fxh
const vertexShader = `
in vec3 center, lightColor;
in vec4 blinkData;
in float falloff;
out vec2 disk;
out vec3 emission;
out float lightViewDepth, lightDepthSpan;
uniform float time, modelScale;

${flashPulse}

float flash(float rate, float phase) {
    float cycle = fract(time * rate + phase);
    // Steady and very slow navigation lights retain the preview's phase level.
    return 0.05 * rate < 0.0001 ? cycle : flashPulse(cycle, rate);
}

void main() {
    float pulse = flash(blinkData.x, blinkData.y);
    vec4 anchor = modelViewMatrix * vec4(center, 1.0);
    // Camera-facing offsets follow THREE's sprite vertex shader. The depth
    // exponent and the extra emission at the flash peak are preview rules.
    // https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderLib/sprite.glsl.js
    float depthMetres = abs(anchor.z) / max(modelScale, 1e-8);
    float diameter = mix(blinkData.z, blinkData.w, pulse) * pow(depthMetres, falloff);
    anchor.xy += position.xy * diameter * modelScale;
    gl_Position = projectionMatrix * anchor;
    disk = uv * 2.0 - 1.0;
    emission = lightColor * (1.0 + pulse);
    lightViewDepth = max(0.0, -anchor.z);
    lightDepthSpan = diameter * modelScale;
}`;

// Independent radial fit to 257 floating-point framebuffer samples of one
// white comparison lamp. Coefficients and pixel-footprint damping are preview
// settings. See docs/source-remediation-29-evidence.json for the measurements.
const fragmentShader = `
in vec2 disk;
in vec3 emission;
in float lightViewDepth, lightDepthSpan;
out vec4 fragColor;
${flareSceneDepth}
${softSceneVisibility}
void main() {
    float radius = length(disk);
    float u = pow(min(radius, 1.0), 0.6);
    float rim = 1.0 - u;
    float profile = 4.5 * rim * rim * (1.0 - 0.46 * u + 0.08 * u * u);
    float resolved = max(0.0, 1.0 - fwidth(radius));
    float strength = profile * resolved * softSceneVisibility(lightViewDepth, lightDepthSpan);
    fragColor = vec4(emission * strength, 0.5 * strength);
}`;

function bindCenters(mesh, root, model, document, sprites) {
  const attached = new Map();
  sprites.forEach(({boneIndex, position}, index) => {
    if (boneIndex < 0) return;
    if (!attached.has(boneIndex)) attached.set(boneIndex, []);
    attached.get(boneIndex).push({index, position});
  });
  // Out-of-range indices retain the center in hull space (as3 has index 34 on a nine-joint mesh).
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpriteSet.cpp#L194-L211
  const update = bindAttachmentBones(root, model, document, attached);
  if (!update) return;
  const centers = mesh.geometry.getAttribute('center'), point = new Vector3();
  mesh.onBeforeRender = () => {
    update((points, transform) => {
      for (const {index, position} of points) {
        point.fromArray(position).applyMatrix4(transform);
        centers.setXYZ(index, point.x, point.y, point.z);
      }
    });
    centers.needsUpdate = true;
  };
}

export function installNavigationLights(root, model, document, sprites, resources, clock, modelScale = model.scale.x, {scene} = {}) {
  if (!sprites.length) return;
  const quad = resources.own(new PlaneGeometry());
  const geometry = resources.own(new InstancedBufferGeometry());
  geometry.index = quad.index;
  geometry.attributes = { ...quad.attributes };
  function attribute(name, size, values) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(sprites.flatMap(values)), size));
  }
  attribute('center', 3, s => s.position);
  attribute('lightColor', 3, s => s.color.slice(0, 3));
  attribute('blinkData', 4, s => [s.blinkRate, s.blinkPhase, s.minScale, s.maxScale]);
  attribute('falloff', 1, s => s.falloff);
  geometry.instanceCount = sprites.length;

  const material = resources.own(new ShaderMaterial({
    glslVersion: GLSL3, vertexShader, fragmentShader,
    uniforms: {
      time: clock, modelScale: { value: modelScale },
      effectSceneDepth: { value: null }, effectHasDepth: { value: false },
      effectDepthSize: { value: new Vector2(1, 1) },
      effectCameraRange: { value: new Vector2(0.1, 100) },
    },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
  }));
  material.forceSinglePass = true;
  material.userData.eveBloomEmission = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = 'EVE navigation lights';
  mesh.frustumCulled = false;
  root.add(mesh);
  bindCenters(mesh, root, model, document, sprites);
  const depth = scene ? createEffectDepth(scene, [material]) : null;
  const unsubscribe = depth && beforeSceneRender(scene, (camera, renderer) => {
    if (root.visible && root.parent) depth.render(renderer, camera);
  });
  return () => {
    unsubscribe?.();
    depth?.dispose();
    mesh.removeFromParent();
  };
}
