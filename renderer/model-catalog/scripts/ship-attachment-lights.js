import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Vector2 } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import { bindAttachmentBones } from './source-bones.js';
import { spotlightCone, spotlightLenses } from './spotlight-geometry.js';
import { flareSceneDepth, softSceneVisibility } from './flare-profile.js';
import { createEffectDepth } from './effect-depth.js';

// The public shader interface specifies colors, placement, sizes and propulsion gain.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EveSpotlightSet.fxh
// The pixel programs are unpublished in that tree. Angular responses below are
// viewer approximations measured on rendered lights (source-remediation-32-evidence.json).
const commonVertex = `
  uniform float boosterGain, intensity;
  in float gainInfluence;
  out vec2 sampleUV;
  out vec3 radiance;
  float energy() { return intensity * mix(1.0, boosterGain, gainInfluence); }
`;

const beamVertex = commonVertex + `
  in vec3 coneColor;
  void main() {
    mat4 lamp = modelViewMatrix * instanceMatrix;
    vec4 corner = lamp * vec4(position, 1.0);
    // Weight each ribbon by its authored transverse axis. Our white-card
    // measurements distinguish this direction from a deformed surface normal.
    vec3 transverse = normalize(mat3(lamp) * normal);
    float weight = abs(dot(transverse, normalize(corner.xyz)));
    radiance = coneColor * (energy() * weight);
    sampleUV = uv;
    gl_Position = projectionMatrix * corner;
  }
`;

// View-space billboard expansion follows Three's sprite shader.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderLib/sprite.glsl.js
const lensVertex = commonVertex + `
  uniform float modelScale;
  in vec3 spriteScale, spriteColor, flareColor;
  in float lensRole;
  out float lensViewDepth, lensDepthSpan;
  void main() {
    mat4 lamp = modelViewMatrix * instanceMatrix;
    vec4 center = lamp[3];
    float cosine = dot(normalize(lamp[2].xyz), normalize(-center.xyz));
    // The disk retained 150 pixels for a 1000-pixel frontal diameter.
    float diskWidth = max(0.15, cosine) * spriteScale.x;
    vec2 streakSize = max(0.0, cosine) * spriteScale.yz;
    vec2 size = mix(vec2(diskWidth), streakSize, lensRole);
    center.xy += position.xy * size * modelScale;
    lensViewDepth = max(0.0, -center.z);
    lensDepthSpan = length(size) * modelScale;
    radiance = mix(spriteColor, flareColor, lensRole) * energy();
    sampleUV = vec2(uv.x, 1.0 - uv.y);
    gl_Position = projectionMatrix * center;
  }
`;

const fragment = `
  uniform sampler2D textureMap;
  in vec2 sampleUV;
  in vec3 radiance;
  out vec4 fragColor;
  void main() {
    fragColor = vec4(radiance * texture(textureMap, sampleUV).rgb, 0.0);
  }
`;

const lensFragment = `
  uniform sampler2D textureMap;
  in vec2 sampleUV;
  in vec3 radiance;
  in float lensViewDepth, lensDepthSpan;
  out vec4 fragColor;
  ${flareSceneDepth}
  ${softSceneVisibility}
  void main() {
    float visibility = softSceneVisibility(lensViewDepth, lensDepthSpan);
    fragColor = vec4(radiance * texture(textureMap, sampleUV).rgb * visibility, 0.0);
  }
`;

function vec3Attribute(items, name) {
  return new InstancedBufferAttribute(new Float32Array(items.flatMap(item => item[name].slice(0, 3))), 3);
}

export async function installAttachmentLights(root, sets, resources, modelScale, {scene, model, document, boosterGain = {value:1}} = {}) {
  const groups = (sets || []).filter(set => set.items.length);
  const maps = await Promise.all(groups.map(set => Promise.all([resources.texture(set.coneMap), resources.texture(set.glowMap)])));
  const batches = [], attached = new Map(), softPasses = [];
  for (const [setIndex, {items, intensity, zOffset, skinned}] of groups.entries()) {
    const beam = resources.own(spotlightCone(zOffset)), lenses = resources.own(spotlightLenses());
    const influence = new InstancedBufferAttribute(Float32Array.from(items, item => Number(item.boosterGainInfluence || 0)), 1);
    beam.setAttribute('gainInfluence', influence);
    lenses.setAttribute('gainInfluence', influence);
    beam.setAttribute('coneColor', vec3Attribute(items, 'coneColor'));
    // CCP's public WebGL builder assigns spriteScale.x to the disk and yz to the flare.
    // https://github.com/ccpgames/ccpwgl/blob/c31632d0fb7d9f0be19a5eb5452e5d5f74a914c5/src/eve/item/EveSpotlightSet.js#L235-L296
    for (const name of ['spriteColor','flareColor','spriteScale']) lenses.setAttribute(name, vec3Attribute(items, name));

    // Match Trinity's two additive batches. Both passes use the same per-lamp matrices.
    const meshes = [beam, lenses].map((geometry, i) => {
      const soft = i === 1;
      const material = resources.additiveMaterial(soft ? lensVertex : beamVertex, soft ? lensFragment : fragment, {
        boosterGain, intensity:{value:intensity}, modelScale:{value:modelScale}, textureMap:{value:maps[setIndex][i]},
        ...(soft ? {
          effectSceneDepth:{value:null}, effectHasDepth:{value:false},
          effectDepthSize:{value:new Vector2(1,1)}, effectCameraRange:{value:new Vector2(0.1,100)},
        } : {}),
      });
      if (soft) {
        material.depthTest = false;
        material.forceSinglePass = true;
        softPasses.push(material);
      }
      const mesh = new InstancedMesh(geometry, material, items.length);
      mesh.name = i === 0 ? 'EVE spotlight beams' : 'EVE spotlight lenses';
      mesh.frustumCulled = false;
      return mesh;
    });
    const [beamMesh, lensMesh] = meshes;
    lensMesh.instanceMatrix = beamMesh.instanceMatrix;
    if (skinned) beamMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (const [index, item] of items.entries()) {
      const rest = new Matrix4().fromArray(item.transform.flat());
      beamMesh.setMatrixAt(index, rest);
      if (skinned && item.boneIndex >= 0) {
        if (!attached.has(item.boneIndex)) attached.set(item.boneIndex, []);
        attached.get(item.boneIndex).push({beamMesh, index, rest});
      }
    }
    root.add(...meshes);
    batches.push(...meshes);
  }
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpotlightSet.cpp#L204-L269
  const update = bindAttachmentBones(root, model, document, attached);
  const pose = new Matrix4(), changed = new Set();
  const unsubscribe = update && beforeSceneRender(scene, () => {
    if (!root.visible || !root.parent) return;
    update((items, boneTransform) => {
      for (const {beamMesh, index, rest} of items) {
        beamMesh.setMatrixAt(index, pose.multiplyMatrices(boneTransform, rest));
        changed.add(beamMesh.instanceMatrix);
      }
    });
    for (const buffer of changed) buffer.needsUpdate = true;
    changed.clear();
  });
  const depth = scene && softPasses.length ? createEffectDepth(scene, softPasses) : null;
  const unsubscribeDepth = depth && beforeSceneRender(scene, (camera, renderer) => {
    if (root.visible && root.parent) depth.render(renderer, camera);
  });
  return () => {
    unsubscribe?.();
    unsubscribeDepth?.();
    depth?.dispose();
    for (const mesh of batches) {
      mesh.removeFromParent();
      mesh.dispose();
    }
  };
}
